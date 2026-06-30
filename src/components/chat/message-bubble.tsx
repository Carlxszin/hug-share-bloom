import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/storage";

export function MessageBubble({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="group flex gap-4 px-6 py-6"
    >
      <div
        className={cn(
          "h-8 w-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-semibold",
          isUser
            ? "bg-white/[0.06] border border-white/10 text-foreground"
            : "bg-primary text-primary-foreground glow-primary",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : "O"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
            {isUser ? "Você" : "Octopus"}
          </span>
          {!isUser && message.model && (
            <span className="text-[10px] font-mono text-muted-foreground/60">
              · {message.model}
            </span>
          )}
        </div>
        <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/95">
          {message.content || (
            <span className="inline-flex gap-1.5 items-center py-1">
              <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
            </span>
          )}
        </div>
        {!isUser && message.content && (
          <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <motion.span
      className="h-1.5 w-1.5 rounded-full bg-primary/70 inline-block"
      animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
      transition={{ duration: 1, repeat: Infinity, delay }}
    />
  );
}
