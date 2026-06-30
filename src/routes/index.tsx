import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Phone, PhoneCall, PenLine, Code2, Lightbulb, BookOpen } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CallModal } from "@/components/chat/call-modal";
import { FreeCallModal } from "@/components/chat/free-call-modal";
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
  const [freeCallOpen, setFreeCallOpen] = useState(false);
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
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[520px] w-[520px] rounded-full bg-primary/[0.07] blur-[140px] ambient-glow" />
        </div>

        <header className="relative h-16 flex items-center justify-between px-6 md:px-8 gap-2 border-b border-white/5 bg-background/40 backdrop-blur-xl z-10">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 240, damping: 18 }}
              className="md:hidden h-8 w-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center glow-primary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </motion.div>
            <Badge
              variant="outline"
              className="gap-1.5 rounded-full border-white/10 bg-white/[0.04] backdrop-blur-md text-[10px] px-2.5 py-1 font-medium text-muted-foreground"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              API online
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFreeCallOpen(true)}
              className="gap-1.5 rounded-full border-success/40 bg-success/5 text-success hover:bg-success/10 hover:text-success"
            >
              <PhoneCall className="h-3.5 w-3.5" /> Grátis
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCallOpen(true)}
              className="gap-1.5 rounded-full border-white/10 bg-white/[0.04] hover:bg-white/[0.08]"
            >
              <Phone className="h-3.5 w-3.5" /> Ligar
            </Button>
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

        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scrollbar-thin z-10">
          {active.messages.length === 0 ? (
            <EmptyState onPick={setInput} />
          ) : (
            <div className="max-w-3xl mx-auto">
              {active.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
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
          />
        </div>
      </main>
      <CallModal open={callOpen} onClose={() => setCallOpen(false)} rate={rate} voice="alloy" />
      <FreeCallModal open={freeCallOpen} onClose={() => setFreeCallOpen(false)} />
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
