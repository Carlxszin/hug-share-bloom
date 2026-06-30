import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, User, Sparkles } from "lucide-react";
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
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "group flex gap-3 px-4 py-5",
        isUser ? "" : "bg-muted/30",
      )}
    >
      <div
        className={cn(
          "h-8 w-8 shrink-0 rounded-md flex items-center justify-center shadow-sm",
          isUser
            ? "bg-secondary"
            : "bg-gradient-to-br from-primary to-primary/70 text-primary-foreground",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground">
            {isUser ? "Você" : (message.model ?? "Aurora")}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {message.content || (
            <span className="inline-flex gap-1">
              <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
            </span>
          )}
        </div>
        {!isUser && message.content && (
          <div className="mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="sm" onClick={copy} className="h-7 gap-1.5 text-xs">
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
      className="h-1.5 w-1.5 rounded-full bg-muted-foreground inline-block"
      animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
      transition={{ duration: 1, repeat: Infinity, delay }}
    />
  );
}
