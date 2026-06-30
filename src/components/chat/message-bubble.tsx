import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, User, Package, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/storage";
import { Markdown } from "./markdown";
import { extractCodeBlocks, zipMarkdownProject } from "@/lib/download";

export function MessageBubble({
  message,
  rate = 5.4,
  onPreviewHtml,
}: {
  message: Message;
  rate?: number;
  onPreviewHtml?: (html: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const blocks = !isUser ? extractCodeBlocks(message.content) : [];
  const codeFileCount = blocks.filter((b) =>
    ["html", "css", "js", "javascript", "ts", "typescript", "jsx", "tsx", "json"].includes(b.lang),
  ).length;
  const showZip = codeFileCount >= 2;

  const hasMeta =
    !isUser &&
    (typeof message.costUSD === "number" ||
      (message.inputTokens ?? 0) > 0 ||
      (message.edits && message.edits.length > 0));

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
          {hasMeta && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="Detalhes da mensagem"
                    className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-white/[0.06] transition"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 p-3 space-y-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Custos
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <Stat label="USD" value={`$ ${(message.costUSD ?? 0).toFixed(5)}`} />
                    <Stat label="BRL" value={`R$ ${((message.costUSD ?? 0) * rate).toFixed(4)}`} />
                    <Stat label="Tokens in" value={`${message.inputTokens ?? 0}`} />
                    <Stat label="Tokens out" value={`${message.outputTokens ?? 0}`} />
                  </div>
                  {message.edits && message.edits.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground pt-1">
                        Edições ({message.edits.length})
                      </div>
                      <div className="max-h-44 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
                        {message.edits.map((e, i) => {
                          const Icon =
                            e.tool === "delete" ? Trash2 : e.tool === "edit" ? Pencil : Plus;
                          const color =
                            e.ok === false
                              ? "text-destructive"
                              : e.tool === "delete"
                                ? "text-red-400"
                                : e.tool === "edit"
                                  ? "text-amber-400"
                                  : "text-emerald-400";
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground"
                            >
                              <Icon className={cn("h-3 w-3 shrink-0", color)} />
                              <span className="truncate">{e.path}</span>
                              {e.line ? (
                                <span className="ml-auto text-[10px] text-muted-foreground/70">
                                  L{e.line}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {message.content ? (
          isUser ? (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground/95">
              {message.content}
            </div>
          ) : (
            <Markdown content={message.content} onPreviewHtml={onPreviewHtml} />
          )
        ) : (
          <span className="inline-flex gap-1.5 items-center py-1">
            <Dot /> <Dot delay={0.15} /> <Dot delay={0.3} />
          </span>
        )}
        {!isUser && message.content && (
          <div className="mt-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              onClick={copy}
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
            {showZip && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => zipMarkdownProject(message.content)}
                className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5"
              >
                <Package className="h-3 w-3" /> Baixar .zip
              </Button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      <div className="font-mono text-[11px] text-foreground/90 truncate">{value}</div>
    </div>
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
