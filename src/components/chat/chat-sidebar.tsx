import { Plus, MessageSquare, Trash2, Pencil, Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
    <aside className="w-72 shrink-0 border-r bg-sidebar text-sidebar-foreground flex flex-col h-full">
      <div className="p-3 border-b">
        <Button onClick={onNew} className="w-full justify-start gap-2" variant="default">
          <Plus className="h-4 w-4" /> Nova conversa
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
        {sorted.length === 0 && (
          <p className="text-xs text-muted-foreground p-3">Nenhuma conversa ainda.</p>
        )}
        {sorted.map((c) => (
          <div
            key={c.id}
            className={cn(
              "group rounded-md px-2 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2",
              activeId === c.id
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/50",
            )}
            onClick={() => onSelect(c.id)}
          >
            <MessageSquare className="h-4 w-4 shrink-0 opacity-70" />
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
                  className="h-7 text-xs"
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
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  aria-label="Renomear"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Excluir esta conversa?")) onDelete(c.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label="Excluir"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="p-3 border-t text-[10px] text-muted-foreground">
        Histórico salvo neste navegador
      </div>
    </aside>
  );
}
