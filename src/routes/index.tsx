import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Phone, PhoneCall, PenLine, Code2, Lightbulb, BookOpen, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CallModal } from "@/components/chat/call-modal";
import { FreeCallModal } from "@/components/chat/free-call-modal";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { Composer, type ComposerHandle } from "@/components/chat/composer";
import { CostBar } from "@/components/chat/cost-bar";
import { MessageBubble } from "@/components/chat/message-bubble";
import { HtmlPreview } from "@/components/chat/html-preview";
import { ModelSelector } from "@/components/chat/model-selector";
import { NewChatPicker } from "@/components/chat/new-chat-picker";
import { BuilderView } from "@/components/chat/builder-view";
import { AgentView } from "@/components/chat/agent-view";
import { EmbeddedBrowser } from "@/components/chat/embedded-browser";
import { ImageQueuePanel } from "@/components/chat/image-queue-panel";
import { detectImagePrompt, enqueueImage } from "@/lib/image-queue";
import { closeReservedExternalTabIfUnused, openInAppBrowser, reserveExternalTab } from "@/lib/browser-bus";
import { ThemeToggle } from "@/components/theme-toggle";
import { IntelligenceButton, IntelligencePanel } from "@/components/chat/intelligence-panel";
import { MemoryButton, MemoryPanel } from "@/components/chat/memory-panel";
import { autoCaptureFromUser, buildMemoryAddon } from "@/lib/memory";
import { detectIntent, logTurn, patchTurn } from "@/lib/metrics";
import { resolveModel } from "@/lib/router";
import { findSimilar, saveEntry } from "@/lib/semantic-cache";
import { pickVariant } from "@/lib/ab-prompts";
import {
  loadConversations,
  logCost,
  newConversation,
  saveConversations,
  type AgentStep,
  type Conversation,
  type ConversationKind,
  type Message,
} from "@/lib/storage";
import { costUSD, DEFAULT_MODEL, getModel } from "@/lib/models";
import { saveChatToVault } from "@/lib/vault";

export const Route = createFileRoute("/")({ component: ChatPage });

export type BuilderActivity = {
  id: string;
  tool: "write" | "edit" | "delete";
  path: string;
  ok?: boolean;
  error?: string;
  isNew?: boolean;
  old?: string;
  new?: string;
  line?: number;
  preview?: string;
  size?: number;
  ts: number;
};

// (no external popups — agent navigation happens in the in-app EmbeddedBrowser)


function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const composerRef = useRef<ComposerHandle>(null);
  const prefill = useCallback((v: string) => composerRef.current?.setValue(v), []);
  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState(5.4);
  const [callOpen, setCallOpen] = useState(false);
  const [freeCallOpen, setFreeCallOpen] = useState(false);
  const [callPickerOpen, setCallPickerOpen] = useState(false);
  const [newChatPickerOpen, setNewChatPickerOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [iqOpen, setIqOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [activity, setActivity] = useState<BuilderActivity[]>([]);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // bootstrap from localStorage (idempotent)
  useEffect(() => {
    const list = loadConversations();
    if (list.length === 0) {
      const c = newConversation();
      setConversations([c]);
      setActiveId(c.id);
      saveConversations([c]);
    } else {
      setConversations(list);
      setActiveId(list[0].id);
    }
  }, []);

  useEffect(() => {
    fetch("/api/fx")
      .then((r) => r.json())
      .then((d) => typeof d.rate === "number" && setRate(d.rate))
      .catch(() => {});
  }, []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, loading]);

  const updateConversation = useCallback(
    (id: string, patch: (c: Conversation) => Conversation) => {
      setConversations((prev) => {
        const next = prev.map((c) => (c.id === id ? patch(c) : c));
        saveConversations(next);
        const updated = next.find((c) => c.id === id);
        if (updated) saveChatToVault(id, updated);
        return next;
      });
    },
    [],
  );

  const onNew = () => setNewChatPickerOpen(true);

  const handlePick = (kind: ConversationKind, model: string) => {
    const c = newConversation(model, kind);
    const next = [c, ...conversations];
    setConversations(next);
    setActiveId(c.id);
    saveConversations(next);
    setNewChatPickerOpen(false);
  };

  const onDelete = (id: string) => {
    const next = conversations.filter((c) => c.id !== id);
    let nextActive = activeId;
    if (id === activeId) {
      if (next.length === 0) {
        const c = newConversation();
        next.push(c);
        nextActive = c.id;
      } else {
        nextActive = next[0].id;
      }
    }
    setConversations(next);
    setActiveId(nextActive);
    saveConversations(next);
  };

  const onRename = (id: string, title: string) => {
    updateConversation(id, (c) => ({ ...c, title, updatedAt: Date.now() }));
  };

  const onStop = () => abortRef.current?.abort();

  const onSubmit = async (text: string) => {
    if (!active || !text.trim() || loading) return;
    if (active.kind === "builder") return onSubmitBuilder(text);
    if (active.kind === "agent") return onSubmitAgent(text);
    text = text.trim();

    // Image-generation shortcut: enqueue + lightweight ack, no model call.
    const imagePrompt = detectImagePrompt(text);
    if (imagePrompt) {
      enqueueImage(imagePrompt);
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      const ackMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Pode deixar, chefe — já coloquei na fila: **${imagePrompt}**. Enquanto eu desenho aí no canto, manda mais o que precisar. 🎨`,
        model: active.model,
        createdAt: Date.now(),
      };
      const isFirstUserMessage = active.messages.length === 0;
      updateConversation(active.id, (c) => ({
        ...c,
        title: isFirstUserMessage ? text.slice(0, 48) : c.title,
        messages: [...c.messages, userMsg, ackMsg],
        updatedAt: Date.now(),
      }));
      return;
    }

    // Only reserve an external tab if the prompt clearly hints navigation.
    if (/\b(abr[ei]r?|tocar?|p[õo]e|p[õo]r|mostr[ae]r?|coloca|navega[rd]?o?|http[s]?:\/\/)/i.test(text)) {
      reserveExternalTab();
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const intent = detectIntent(text);
    const { id: routedModel, decision } = resolveModel(active.model, intent);

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      model: routedModel,
      createdAt: Date.now(),
    };

    const baseMessages = [...active.messages, userMsg];
    const isFirstUserMessage = active.messages.length === 0;

    updateConversation(active.id, (c) => ({
      ...c,
      title: isFirstUserMessage ? text.slice(0, 48) : c.title,
      messages: [...baseMessages, assistantMsg],
      updatedAt: Date.now(),
    }));

    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const t0 = performance.now();

    // Semantic cache check — only for short standalone prompts (no chat history reuse).
    let cacheEmbedding: number[] | null = null;
    if (active.messages.length === 0 && text.length < 400) {
      try {
        const { hit, queryEmbedding } = await findSimilar(text);
        cacheEmbedding = queryEmbedding;
        if (hit) {
          updateConversation(active.id, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: hit.entry.reply, costUSD: 0, model: hit.entry.model }
                : m,
            ),
            updatedAt: Date.now(),
          }));
          logTurn({
            intent,
            model: hit.entry.model,
            mode: "paid",
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: Math.round(performance.now() - t0),
            costUSD: 0,
            costBRL: 0,
            toolCalls: [],
            retryCount: 0,
            truncated: false,
            cacheHit: true,
          });
          setLoading(false);
          return;
        }
      } catch {
        /* cache miss path */
      }
    }


    const variant = pickVariant(intent);
    try {
      // Auto-captura fatos/preferências ditos pelo chefe.
      try { autoCaptureFromUser(text); } catch { /* noop */ }
      const memoryAddon = buildMemoryAddon(text);
      const combinedAddon = [variant.suffix, memoryAddon].filter(Boolean).join("\n\n");
      const isLocal = routedModel.startsWith("local/");
      // Modo Local: o browser fala DIRETO com o Ollama do PC do chefe.
      // Não passa pelo servidor porque a Cloudflare não enxerga localhost:11434.
      let res: Response;
      if (isLocal) {
        const shortModel = routedModel.slice("local/".length);
        const ollamaModel = shortModel.includes(":") ? shortModel : `${shortModel}:8b`;
        try {
          res = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: ollamaModel,
              messages: [
                { role: "system", content: combinedAddon || "Você é o Octopus. Sempre chame o usuário de 'chefe'." },
                ...baseMessages.map((m) => ({ role: m.role, content: m.content })),
              ],
              stream: true,
            }),
            signal: controller.signal,
          });
        } catch {
          throw new Error(
            "Ollama offline ou bloqueado por CORS. No PowerShell rode:\n" +
            '  setx OLLAMA_ORIGINS "*"\n' +
            "depois feche e reabra o `ollama serve`.",
          );
        }
      } else {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: routedModel,
            messages: baseMessages.map((m) => ({ role: m.role, content: m.content })),
            systemAddon: combinedAddon,
          }),
          signal: controller.signal,
        });
      }

      if (!res.ok || !res.body) {
        const err = await res.text();
        updateConversation(active.id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `⚠️ Erro: ${err || res.status}` }
              : m,
          ),
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assembled = "";
      let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          // Ollama direto = NDJSON puro; OpenAI/proxy = SSE "data: {...}"
          const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta =
              json.choices?.[0]?.delta?.content ?? json.message?.content ?? "";
            if (typeof delta === "string" && delta) {
              assembled += delta;
              updateConversation(active.id, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: assembled } : m,
                ),
              }));
            }
            if (json.usage) usage = json.usage;
            if (json.done && (json.prompt_eval_count || json.eval_count)) {
              usage = {
                prompt_tokens: json.prompt_eval_count ?? 0,
                completion_tokens: json.eval_count ?? 0,
              };
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }

      const inTok = usage?.prompt_tokens ?? 0;
      const outTok = usage?.completion_tokens ?? 0;
      const cost = costUSD(getModel(routedModel), inTok, outTok);
      updateConversation(active.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, inputTokens: inTok, outputTokens: outTok, costUSD: cost.total }
            : m,
        ),
        updatedAt: Date.now(),
      }));
      logCost({ usd: cost.total, inputTokens: inTok, outputTokens: outTok });
      const turnId = logTurn({
        intent,
        model: routedModel,
        mode: "paid",
        tokensIn: inTok,
        tokensOut: outTok,
        latencyMs: Math.round(performance.now() - t0),
        costUSD: cost.total,
        costBRL: cost.total * rate,
        toolCalls: [],
        retryCount: 0,
        truncated: false,
        variant: variant.id,
      });
      // Background self-critique (non-blocking) — populates IQ score.
      if (assembled) {
        void fetch("/api/critique", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userPrompt: text, assistantReply: assembled }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data && typeof data.score === "number") {
              patchTurn(turnId, { selfScore: data.score });
            }
          })
          .catch(() => {});
      // Save to semantic cache for future reuse (only first-turn short prompts).
      if (assembled && isFirstUserMessage && text.length < 400) {
        (async () => {
          const emb = cacheEmbedding ?? (await (await import("@/lib/semantic-cache")).embedText(text));
          if (emb) saveEntry(text, emb, assembled, routedModel);
        })().catch(() => {});
      }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateConversation(active.id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: `⚠️ ${(err as Error).message}` }
              : m,
          ),
        }));
      }
    } finally {
      closeReservedExternalTabIfUnused();
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onSubmitBuilder = async (text: string) => {
    if (!active || !text.trim() || loading) return;
    text = text.trim();

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Pensando e editando arquivos…",
      model: active.model,
      createdAt: Date.now(),
    };
    const baseMessages = [...active.messages, userMsg];
    const isFirst = active.messages.length === 0;
    updateConversation(active.id, (c) => ({
      ...c,
      title: isFirst ? text.slice(0, 48) : c.title,
      messages: [...baseMessages, assistantMsg],
      updatedAt: Date.now(),
    }));

    setLoading(true);
    setActivity([]);
    setFocusFile(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const tBuilder0 = performance.now();
    try {
      const res = await fetch("/api/builder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: active.model,
          messages: baseMessages.map((m) => ({ role: m.role, content: m.content })),
          files: active.files ?? {},
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        updateConversation(active.id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `⚠️ Erro: ${err || res.status}` } : m,
          ),
        }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const fileChanges: { path: string; action: "write" | "edit" | "delete" }[] = [];
      const turnEdits: import("@/lib/storage").FileEdit[] = [];
      let finalMsg = "";
      let usage = { inputTokens: 0, outputTokens: 0, usd: 0 };
      let latestFiles: Record<string, string> = active.files ?? {};

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "action") {
            const a: BuilderActivity = {
              id: crypto.randomUUID(),
              tool: ev.tool as BuilderActivity["tool"],
              path: ev.path as string,
              ok: ev.ok as boolean | undefined,
              error: ev.error as string | undefined,
              isNew: ev.isNew as boolean | undefined,
              old: ev.old as string | undefined,
              new: ev.new as string | undefined,
              line: ev.line as number | undefined,
              preview: ev.preview as string | undefined,
              size: ev.size as number | undefined,
              ts: Date.now(),
            };
            setActivity((prev) => [...prev, a]);
            setFocusFile(a.path);
            turnEdits.push({
              tool: a.tool,
              path: a.path,
              ok: a.ok,
              error: a.error,
              isNew: a.isNew,
              old: a.old,
              new: a.new,
              line: a.line,
              preview: a.preview,
              size: a.size,
              ts: a.ts,
            });
            if (a.ok !== false) fileChanges.push({ path: a.path, action: a.tool });
          } else if (ev.type === "files") {
            latestFiles = ev.files as Record<string, string>;
            updateConversation(active.id, (c) => ({ ...c, files: latestFiles }));
          } else if (ev.type === "done") {
            finalMsg = (ev.message as string) || "Atualizei o workspace.";
            usage = ev.usage as typeof usage;
            latestFiles = (ev.files as Record<string, string>) ?? latestFiles;
          } else if (ev.type === "error") {
            finalMsg = `⚠️ ${ev.message as string}`;
          }
        }
      }

      updateConversation(active.id, (c) => ({
        ...c,
        files: latestFiles,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: finalMsg || "Atualizei o workspace.",
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                costUSD: usage.usd,
                fileChanges,
                edits: turnEdits,
              }
            : m,
        ),
        updatedAt: Date.now(),
      }));
      logCost({
        usd: usage.usd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      logTurn({
        intent: "builder",
        model: active.model,
        mode: "paid",
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        latencyMs: Math.round(performance.now() - tBuilder0),
        costUSD: usage.usd,
        costBRL: usage.usd * rate,
        toolCalls: (fileChanges ?? []).map(() => ({ name: "write_file", ok: true })),
        retryCount: 0,
        truncated: false,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateConversation(active.id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `⚠️ ${(err as Error).message}` } : m,
          ),
        }));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onSubmitAgent = async (text: string) => {
    if (!active || !text.trim() || loading) return;
    text = text.trim();
    reserveExternalTab();

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "Planejando…",
      model: active.model,
      createdAt: Date.now(),
    };
    const baseMessages = [...active.messages, userMsg];
    const isFirst = active.messages.length === 0;
    // Agent navigation happens in the in-app EmbeddedBrowser (no popups).
    updateConversation(active.id, (c) => ({
      ...c,
      title: isFirst ? text.slice(0, 48) : c.title,
      messages: [...baseMessages, assistantMsg],
      updatedAt: Date.now(),
    }));

    setLoading(true);
    setAgentSteps([]);
    const turnSteps: AgentStep[] = [];
    const controller = new AbortController();
    abortRef.current = controller;
    let openedSomething = false;
    const tAgent0 = performance.now();

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: active.model,
          messages: baseMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        updateConversation(active.id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `⚠️ Erro: ${err || res.status}` } : m,
          ),
        }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalMsg = "";
      let usage = { inputTokens: 0, outputTokens: 0, usd: 0 };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "action") {
            const step: AgentStep = {
              id: crypto.randomUUID(),
              tool: ev.tool as AgentStep["tool"],
              input: (ev.input as Record<string, unknown>) ?? {},
              ok: ev.ok as boolean | undefined,
              error: ev.error as string | undefined,
              result: ev.result as string | undefined,
              screenshotUrl: ev.screenshotUrl as string | undefined,
              openedUrl: ev.openedUrl as string | undefined,
              links: ev.links as AgentStep["links"],
              plan: ev.plan as string[] | undefined,
              cached: ev.cached as boolean | undefined,
              ts: Date.now(),
            };
            if (step.openedUrl) {
              openedSomething = true;
              openInAppBrowser(step.openedUrl);
            }
            turnSteps.push(step);
            setAgentSteps((prev) => [...prev, step]);
          } else if (ev.type === "done") {
            finalMsg = (ev.message as string) || "Tarefa concluída.";
            usage = ev.usage as typeof usage;
          } else if (ev.type === "error") {
            finalMsg = `⚠️ ${ev.message as string}`;
          }
        }
      }
      updateConversation(active.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: finalMsg || "Tarefa concluída.",
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                costUSD: usage.usd,
                agentSteps: turnSteps,
              }
            : m,
        ),
        updatedAt: Date.now(),
      }));
      logCost({
        usd: usage.usd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      logTurn({
        intent: "agent",
        model: active.model,
        mode: "paid",
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        latencyMs: Math.round(performance.now() - tAgent0),
        costUSD: usage.usd,
        costBRL: usage.usd * rate,
        toolCalls: turnSteps.map((s) => ({ name: s.tool, ok: s.ok !== false })),
        retryCount: 0,
        truncated: false,
      });
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateConversation(active.id, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: `⚠️ ${(err as Error).message}` } : m,
          ),
        }));
      }
    } finally {
      if (!openedSomething) closeReservedExternalTabIfUnused();
      setLoading(false);
      abortRef.current = null;
    }
  };

  if (!active) {
    return <div className="min-h-screen flex items-center justify-center">Carregando…</div>;
  }

  const isBuilder = active.kind === "builder";
  const isAgent = active.kind === "agent";

  return (
    <div className="h-screen flex bg-background text-foreground">
      <ChatSidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={onNew}
        onDelete={onDelete}
        onRename={onRename}
      />
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[520px] w-[520px] rounded-full bg-primary/[0.07] blur-[140px] ambient-glow" />
        </div>
        <ImageQueuePanel className="top-20" />

        <header className="relative h-16 flex items-center justify-between px-6 md:px-8 gap-4 border-b border-white/5 bg-background/90 z-10">
          <div className="flex items-center gap-2 min-w-0">
            {isBuilder && (
              <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary font-semibold bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1">
                <Sparkles className="h-3 w-3" /> Builder
              </span>
            )}
            {isAgent && (
              <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-success font-semibold bg-success/10 border border-success/20 rounded-full px-2.5 py-1">
                <Sparkles className="h-3 w-3" /> Agente
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector
              value={active.model}
              onChange={(model) =>
                updateConversation(active.id, (c) => ({ ...c, model }))
              }
            />
            <div className="h-6 w-px bg-white/10 mx-1" />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCallPickerOpen(true)}
              aria-label="Ligar"
              className="h-8 w-8 rounded-full hover:bg-white/[0.06]"
            >
              <Phone className="h-4 w-4" />
            </Button>
            <MemoryButton onClick={() => setMemoryOpen(true)} />
            <IntelligenceButton onClick={() => setIqOpen(true)} />
            <ThemeToggle />
          </div>
        </header>

        <CostBar conversation={active} rate={rate} />

        {isBuilder ? (
          <div className="relative flex-1 min-h-0 flex z-10">
            <div className="flex flex-col w-[44%] min-w-[340px] max-w-[560px] border-r border-white/5">
              <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
                {active.messages.length === 0 ? (
                  <BuilderEmpty onPick={setInput} />
                ) : (
                  <div className="max-w-2xl mx-auto px-2">
                    {active.messages.map((m) => (
                      <MessageBubble key={m.id} message={m} rate={rate} onPreviewHtml={setPreviewHtml} />
                    ))}
                  </div>
                )}
              </div>
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={onSubmit}
                onStop={onStop}
                loading={loading}
                onCall={() => setCallPickerOpen(true)}
              />
            </div>
            <div className="flex-1 min-w-0">
              <BuilderView
                files={active.files ?? {}}
                messages={active.messages}
                conversationTitle={active.title}
                onPreviewExternal={setPreviewHtml}
                activity={activity}
                focusFile={focusFile}
                streaming={loading}
              />

            </div>
          </div>
        ) : isAgent ? (
          <div className="relative flex-1 min-h-0 flex flex-col lg:flex-row z-10">
            <div className="flex flex-col flex-1 min-w-0 lg:border-r border-white/5 min-h-0">
              <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
                {active.messages.length === 0 ? (
                  <AgentEmpty onPick={setInput} />
                ) : (
                  <div className="max-w-3xl mx-auto">
                    {active.messages.map((m) => (
                      <MessageBubble key={m.id} message={m} rate={rate} onPreviewHtml={setPreviewHtml} />
                    ))}
                  </div>
                )}
              </div>
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={onSubmit}
                onStop={onStop}
                loading={loading}
                onCall={() => setCallPickerOpen(true)}
              />
            </div>
            <div className="w-full lg:w-[44%] lg:min-w-[360px] lg:max-w-[560px] flex flex-col gap-2 p-2 border-t lg:border-t-0 border-white/5 min-h-0">
              <div className="lg:max-h-[45%] overflow-hidden">
                <AgentView steps={agentSteps} streaming={loading} />
              </div>
              <EmbeddedBrowser className="flex-1 min-h-[320px]" />
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="relative flex-1 overflow-y-auto scrollbar-thin z-10">
              {active.messages.length === 0 ? (
                <EmptyState onPick={setInput} />
              ) : (
                <div className="max-w-3xl mx-auto">
                  {active.messages.map((m) => (
                    <MessageBubble key={m.id} message={m} rate={rate} onPreviewHtml={setPreviewHtml} />
                  ))}
                </div>
              )}
            </div>

            <div className="relative z-10">
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={onSubmit}
                onStop={onStop}
                loading={loading}
                onCall={() => setCallPickerOpen(true)}
              />
            </div>
          </>
        )}
      </main>
      <CallModal open={callOpen} onClose={() => setCallOpen(false)} rate={rate} voice="alloy" />
      <FreeCallModal open={freeCallOpen} onClose={() => setFreeCallOpen(false)} />
      <CallPicker
        open={callPickerOpen}
        onClose={() => setCallPickerOpen(false)}
        onFree={() => {
          setCallPickerOpen(false);
          setFreeCallOpen(true);
        }}
        onPaid={() => {
          setCallPickerOpen(false);
          setCallOpen(true);
        }}
      />
      <NewChatPicker
        open={newChatPickerOpen}
        onClose={() => setNewChatPickerOpen(false)}
        onPick={handlePick}
      />
      <HtmlPreview html={previewHtml} onClose={() => setPreviewHtml(null)} />
      <IntelligencePanel open={iqOpen} onClose={() => setIqOpen(false)} />
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />
    </div>
  );
}

function CallPicker({
  open,
  onClose,
  onFree,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  onFree: () => void;
  onPaid: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-background/95 backdrop-blur-xl p-6 shadow-2xl"
      >
        <h3 className="text-lg font-medium tracking-tight">Escolha o modelo</h3>
        <p className="text-sm text-muted-foreground mt-1">Qual modo de chamada usar?</p>
        <div className="mt-5 grid gap-3">
          <button
            onClick={onFree}
            className="text-left p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-success/40 transition"
          >
            <div className="flex items-center gap-2 text-success font-medium">
              <PhoneCall className="h-4 w-4" /> Grátis
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Web Speech (navegador) + Gemini via gateway. Sem custo.
            </p>
          </button>
          <button
            onClick={onPaid}
            className="text-left p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-primary/40 transition"
          >
            <div className="flex items-center gap-2 text-primary font-medium">
              <Phone className="h-4 w-4" /> Pago
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              OpenAI Realtime (gpt-realtime-mini). Latência menor, custo em BRL.
            </p>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function BuilderEmpty({ onPick }: { onPick: (v: string) => void }) {
  const ideas = [
    "Landing page para uma cafeteria artesanal com hero, menu e contato",
    "Portfólio minimalista de fotógrafo com galeria em grid",
    "Página de produto SaaS com hero, recursos, preços e FAQ",
    "Site one-page para evento de tech com countdown e CTA",
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-md w-full space-y-6">
        <div className="space-y-2">
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600 }}
          >
            O que vamos construir?
          </motion.h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Descreva o site. O Octopus cria os arquivos e edita em pequenos diffs.
          </p>
        </div>
        <div className="grid gap-2 text-left">
          {ideas.map((t, i) => (
            <motion.button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              whileHover={{ x: 2 }}
              className="p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-primary/30 transition text-xs text-foreground/90"
            >
              {t}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (v: string) => void }) {
  const suggestions = [
    { icon: PenLine, title: "Escrita criativa", text: "Escreva um e-mail formal pedindo aumento" },
    { icon: Code2, title: "Código & debug", text: "Resuma os princípios SOLID com exemplos" },
    { icon: Lightbulb, title: "Brainstorm", text: "Gere ideias de nomes para uma startup de café" },
    { icon: BookOpen, title: "Explicar simples", text: "Explique computação quântica como se eu tivesse 10 anos" },
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-3xl w-full space-y-10">
        <div className="space-y-3">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-5xl md:text-6xl tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600 }}
          >
            O que está em mente?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="text-base text-muted-foreground max-w-md mx-auto leading-relaxed font-light"
          >
            Octopus está pronto para pesquisar, escrever e criar — com custos em USD e BRL ao vivo.
          </motion.p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto text-left">
          {suggestions.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.button
                key={s.text}
                type="button"
                onClick={() => onPick(s.text)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.985 }}
                className="group p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 backdrop-blur-md transition-all space-y-3"
              >
                <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 group-hover:bg-primary/15 transition-transform duration-300">
                  <Icon className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-medium text-foreground">{s.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.text}</p>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgentEmpty({ onPick }: { onPick: (v: string) => void }) {
  const ideas = [
    "Pesquise os 3 notebooks mais vendidos abaixo de R$ 4000 e me dê uma tabela comparativa",
    "Resuma as 5 principais notícias de tecnologia de hoje no Brasil",
    "Abra o site exemplo.com e tire um screenshot da home",
    "Compare os preços do iPhone 15 em 3 lojas brasileiras",
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="max-w-md w-full space-y-6">
        <div className="space-y-2">
          <motion.h2
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600 }}
          >
            Qual tarefa devo executar?
          </motion.h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            O Agente pesquisa na web, lê páginas e captura screenshots de forma autônoma.
          </p>
        </div>
        <div className="grid gap-2 text-left">
          {ideas.map((t, i) => (
            <motion.button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              whileHover={{ x: 2 }}
              className="p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-success/30 transition text-xs text-foreground/90"
            >
              {t}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
