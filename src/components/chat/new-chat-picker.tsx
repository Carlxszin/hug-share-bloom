import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Code2, Sparkles, Zap, Brain, Bot, HardDrive } from "lucide-react";
import { MODELS } from "@/lib/models";

const BUILDER_MODELS = ["gpt-5", "gpt-4o"];

export function NewChatPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: "chat" | "builder" | "agent", model: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-background/95 backdrop-blur-xl p-6 shadow-2xl"
          >
            <h3 className="text-lg font-medium tracking-tight">Para que será esse chat?</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Escolha o modo — você pode trocar de conversa quando quiser.
            </p>

            <div className="mt-5 grid gap-3">
              <button
                onClick={() => onPick("chat", "gpt-5-mini")}
                className="text-left p-4 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-primary/30 transition group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">Perguntas & conversa</div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pesquisa, escrita, dúvidas, brainstorm — usa{" "}
                      <span className="font-mono text-foreground/80">gpt-5-mini</span>.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => onPick("agent", "gpt-4o-mini")}
                className="text-left p-4 rounded-xl border border-success/20 bg-gradient-to-br from-success/[0.05] to-transparent hover:border-success/40 transition group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-success/10 border border-success/20 flex items-center justify-center text-success">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      Agente Executor
                      <span className="text-[9px] uppercase tracking-wider bg-success/15 text-success px-1.5 py-0.5 rounded-full font-semibold">
                        novo
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Pesquisa na web, lê páginas e tira screenshots — autônomo, ~R$ 0,01/tarefa.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => onPick("chat", "local/llama3.1")}
                className="text-left p-4 rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.05] to-transparent hover:border-emerald-500/40 transition group"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      Local (100% grátis)
                      <span className="text-[9px] uppercase tracking-wider bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">
                        offline
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Roda no seu PC via Ollama —{" "}
                      <span className="font-mono text-foreground/80">llama3.1</span>, sem custo, sem internet.
                    </p>
                  </div>
                </div>
              </button>

              <div className="p-4 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center glow-primary">
                    <Code2 className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      Criação de Sites
                      <Sparkles className="h-3 w-3 text-primary" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Workspace multi-arquivo + edição cirúrgica + preview ao vivo.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {BUILDER_MODELS.map((id) => {
                    const m = MODELS.find((x) => x.id === id);
                    if (!m) return null;
                    const recommended = id === "gpt-5";
                    return (
                      <button
                        key={id}
                        onClick={() => onPick("builder", id)}
                        className="relative text-left p-3 rounded-lg border border-white/10 bg-background/40 hover:bg-white/[0.05] hover:border-primary/40 transition"
                      >
                        {recommended && (
                          <span className="absolute -top-2 right-2 text-[9px] uppercase tracking-wider bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full font-semibold">
                            top
                          </span>
                        )}
                        <div className="font-medium text-xs">{m.label}</div>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-0.5">
                            <Brain className="h-2.5 w-2.5" /> {m.reasoning}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Zap className="h-2.5 w-2.5" /> {m.speed}
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground/80 mt-1">
                          ${m.inputPer1M}/${m.outputPer1M} per 1M
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
