import { Plus, MessageSquare, Trash2, Pencil, Check, X, Code2 } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/storage";

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
}: {
  conversations: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="w-72 shrink-0 hidden md:flex flex-col h-full border-r border-white/5 bg-sidebar/60 backdrop-blur-2xl">
      <div className="px-5 pt-6 pb-3 flex items-center gap-3">
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 240, damping: 18 }}
          className="h-8 w-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center glow-primary"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </motion.div>
        <span className="font-semibold tracking-tight text-base">Octopus</span>
      </div>

      <div className="px-4 pt-2 pb-3">
        <button
          onClick={onNew}
          className="group w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/15 transition-all text-sm"
        >
          <span className="flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" /> Nova conversa
          </span>
          <span className="text-[10px] text-muted-foreground group-hover:text-foreground/80 font-mono">⌘N</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-1">
        <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground/80 mb-3 px-2">
          Recentes
        </div>
        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground px-2 py-3">Nenhuma conversa ainda.</p>
        )}
        {sorted.map((c, i) => {
          const active = activeId === c.id;
          return (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.025, duration: 0.25 }}
              onClick={() => onSelect(c.id)}
              className={cn(
                "group relative rounded-lg px-3 py-2 text-sm cursor-pointer transition-all flex items-center gap-2 border",
                active
                  ? "bg-primary/10 text-primary border-primary/25"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {editing === c.id ? (
                <>
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(c.id, draft.trim() || c.title);
                        setEditing(null);
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="h-7 text-xs bg-background/60"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRename(c.id, draft.trim() || c.title);
                      setEditing(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 truncate">{c.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(c.id);
                      setDraft(c.title);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition"
                    aria-label="Renomear"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Excluir esta conversa?")) onDelete(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition"
                    aria-label="Excluir"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="p-4 border-t border-white/5">
        <div className="text-[10px] text-muted-foreground/70 px-1">
          Histórico salvo neste navegador
        </div>
      </div>
    </aside>
  );
}
