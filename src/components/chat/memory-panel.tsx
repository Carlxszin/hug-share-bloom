import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, X, Pin, PinOff, Trash2, Plus, Pencil, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  addMemory,
  clearMemories,
  deleteMemory,
  loadMemories,
  updateMemory,
  type Memory,
} from "@/lib/memory";

export function MemoryButton({ onClick }: { onClick: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => setCount(loadMemories().length);
    read();
    window.addEventListener("octopus:memories", read);
    return () => window.removeEventListener("octopus:memories", read);
  }, []);
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onClick}
      aria-label="Memórias"
      className="relative h-8 w-8 rounded-full hover:bg-white/[0.06]"
    >
      <Brain className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 text-[9px] font-bold tabular-nums bg-primary text-primary-foreground rounded-full px-1 leading-tight">
          {count}
        </span>
      )}
    </Button>
  );
}

export function MemoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const reload = () => setItems(loadMemories());
  useEffect(() => {
    if (!open) return;
    reload();
    const on = () => reload();
    window.addEventListener("octopus:memories", on);
    return () => window.removeEventListener("octopus:memories", on);
  }, [open]);

  const commitAdd = () => {
    const t = draft.trim();
    if (!t) return;
    addMemory(t, "note");
    setDraft("");
    reload();
  };

  const commitEdit = (id: string) => {
    const t = editingText.trim();
    if (t) updateMemory(id, { text: t });
    setEditingId(null);
    setEditingText("");
    reload();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-white/10 z-50 flex flex-col"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Memórias do chefe</h2>
                <span className="text-xs text-muted-foreground">({items.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    if (confirm("Apagar TODAS as memórias?")) {
                      clearMemories();
                      reload();
                    }
                  }}
                  disabled={!items.length}
                >
                  <Trash2 className="h-3 w-3" /> Tudo
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </header>

            <div className="px-4 py-3 border-b border-white/10 flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitAdd()}
                placeholder="Adicionar memória (ex: prefiro respostas curtas)"
                className="flex-1 h-8 px-2 rounded-md bg-background/60 border border-white/10 text-xs outline-none focus:border-primary/50"
              />
              <Button size="sm" className="h-8 gap-1" onClick={commitAdd} disabled={!draft.trim()}>
                <Plus className="h-3 w-3" /> Salvar
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-1.5">
              {items.length === 0 && (
                <p className="text-xs text-muted-foreground italic px-2 py-6 text-center">
                  Sem memórias ainda. Fale coisas como "meu nome é...", "prefiro..." ou
                  adicione manualmente.
                </p>
              )}
              {items.map((m) => (
                <div
                  key={m.id}
                  className="group flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] border border-transparent hover:border-white/5"
                >
                  <button
                    onClick={() => {
                      updateMemory(m.id, { pinned: !m.pinned });
                      reload();
                    }}
                    className={`mt-0.5 p-1 rounded hover:bg-white/10 ${m.pinned ? "text-primary" : "text-muted-foreground"}`}
                    aria-label="Fixar"
                  >
                    {m.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    {editingId === m.id ? (
                      <input
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(m.id);
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditingText("");
                          }
                        }}
                        className="w-full h-6 px-1 rounded bg-background/60 border border-primary/40 text-xs outline-none"
                      />
                    ) : (
                      <p className="text-xs leading-snug break-words">{m.text}</p>
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {m.kind}
                    </span>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition flex gap-0.5">
                    {editingId === m.id ? (
                      <button
                        onClick={() => commitEdit(m.id)}
                        className="p-1 rounded hover:bg-white/10 text-primary"
                        aria-label="Salvar"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingId(m.id);
                          setEditingText(m.text);
                        }}
                        className="p-1 rounded hover:bg-white/10 text-muted-foreground"
                        aria-label="Editar"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={() => {
                        deleteMemory(m.id);
                        reload();
                      }}
                      className="p-1 rounded hover:bg-white/10 text-destructive"
                      aria-label="Apagar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
