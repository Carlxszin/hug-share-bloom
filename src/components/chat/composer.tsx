import { useEffect, useRef } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  loading: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading) ref.current?.focus();
  }, [loading]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  return (
    <div className="border-t bg-background p-3">
      <div className="relative max-w-3xl mx-auto rounded-2xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring transition">
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!loading && value.trim()) onSubmit();
            }
          }}
          placeholder="Pergunte qualquer coisa…  (Enter para enviar, Shift+Enter para nova linha)"
          rows={1}
          className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 pr-14 max-h-[200px]"
        />
        <div className="absolute right-2 bottom-2">
          {loading ? (
            <Button size="icon" variant="destructive" onClick={onStop} aria-label="Parar">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSubmit}
              disabled={!value.trim()}
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center mt-2">
        IA pode cometer erros. Confira informações importantes.
      </p>
    </div>
  );
}
