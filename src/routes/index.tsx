import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Phone, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CallModal } from "@/components/chat/call-modal";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { Composer } from "@/components/chat/composer";
import { CostBar } from "@/components/chat/cost-bar";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ModelSelector } from "@/components/chat/model-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
  loadConversations,
  logCost,
  newConversation,
  saveConversations,
  type Conversation,
  type Message,
} from "@/lib/storage";
import { costUSD, DEFAULT_MODEL, getModel } from "@/lib/models";

export const Route = createFileRoute("/")({ component: ChatPage });

function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [rate, setRate] = useState(5.4);
  const [callOpen, setCallOpen] = useState(false);
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
        return next;
      });
    },
    [],
  );

  const onNew = () => {
    const c = newConversation(active?.model ?? DEFAULT_MODEL);
    const next = [c, ...conversations];
    setConversations(next);
    setActiveId(c.id);
    saveConversations(next);
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

  const onSubmit = async () => {
    if (!active || !input.trim() || loading) return;
    const text = input.trim();
    setInput("");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      model: active.model,
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

    try {
      const res = await fetch("/api/chat", {
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
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (typeof delta === "string") {
              assembled += delta;
              updateConversation(active.id, (c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: assembled } : m,
                ),
              }));
            }
            if (json.usage) usage = json.usage;
          } catch {
            /* ignore parse errors */
          }
        }
      }

      const inTok = usage?.prompt_tokens ?? 0;
      const outTok = usage?.completion_tokens ?? 0;
      updateConversation(active.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, inputTokens: inTok, outputTokens: outTok }
            : m,
        ),
        updatedAt: Date.now(),
      }));
      const cost = costUSD(getModel(active.model), inTok, outTok);
      logCost({ usd: cost.total, inputTokens: inTok, outputTokens: outTok });
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
      setLoading(false);
      abortRef.current = null;
    }
  };

  if (!active) {
    return <div className="min-h-screen flex items-center justify-center">Carregando…</div>;
  }

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
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b flex items-center justify-between px-4 gap-2">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <h1 className="font-semibold tracking-tight">Aurora Chat</h1>
            <Badge variant="outline" className="ml-2 gap-1 text-[10px]">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> API online
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <ModelSelector
              value={active.model}
              onChange={(model) =>
                updateConversation(active.id, (c) => ({ ...c, model }))
              }
            />
            <ThemeToggle />
          </div>
        </header>

        <CostBar conversation={active} rate={rate} />

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {active.messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-w-3xl mx-auto">
              {active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
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
        />
      </main>
    </div>
  );
}

function EmptyState() {
  const suggestions = [
    "Explique computação quântica como se eu tivesse 10 anos",
    "Escreva um e-mail formal pedindo aumento",
    "Gere ideias de nomes para uma startup de café",
    "Resuma os princípios SOLID com exemplos",
  ];
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="h-12 w-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center mb-4">
        <Sparkles className="h-6 w-6" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight">Como posso ajudar hoje?</h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-md">
        Converse com modelos GPT-5 e acompanhe o custo em USD e Real em tempo real.
      </p>
      <div className="grid sm:grid-cols-2 gap-2 mt-8 max-w-xl w-full">
        {suggestions.map((s) => (
          <div
            key={s}
            className="text-left text-sm border rounded-xl p-3 hover:bg-muted/50 transition cursor-default"
          >
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}
