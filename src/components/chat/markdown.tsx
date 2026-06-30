import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, Eye, Download } from "lucide-react";
import "highlight.js/styles/github-dark.css";
import { downloadText } from "@/lib/download";

export function Markdown({
  content,
  onPreviewHtml,
}: {
  content: string;
  onPreviewHtml?: (html: string) => void;
}) {
  return (
    <div className="markdown text-[15px] leading-relaxed text-foreground/95 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-1">{children}</ol>,
          h1: ({ children }) => <h1 className="mt-4 mb-2 text-2xl font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-xl font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-lg font-semibold">{children}</h3>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="px-3 py-2 text-left font-medium bg-white/5">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 border-t border-white/5">{children}</td>,
          code: ({ className, children, ...props }) => {
            // Inline code (no language class)
            const isBlock = /language-/.test(className || "");
            if (!isBlock) {
              return (
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-[0.85em] font-mono">
                  {children}
                </code>
              );
            }
            const match = /language-([\w-]+)/.exec(className || "");
            const lang = (match?.[1] || "").toLowerCase();
            const raw = extractText(children);
            return (
              <CodeBlock lang={lang} raw={raw} onPreviewHtml={onPreviewHtml}>
                <code className={className} {...props}>
                  {children}
                </code>
              </CodeBlock>
            );
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    // @ts-expect-error - children may be undefined
    return extractText(node.props.children);
  }
  return "";
}

function CodeBlock({
  lang,
  raw,
  children,
  onPreviewHtml,
}: {
  lang: string;
  raw: string;
  children: ReactNode;
  onPreviewHtml?: (html: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const looksLikeHtml = /<\s*(!doctype html|html|body|div|section|main|head)[\s>]/i.test(raw);
  const isHtml = lang === "html" || lang === "htm" || (!lang && looksLikeHtml);
  const extMap: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    html: "html",
  };
  const ext = extMap[lang] ?? (lang || (looksLikeHtml ? "html" : "txt"));
  const copy = async () => {
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="my-3 rounded-xl border border-white/10 bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 bg-white/[0.02]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {lang || "code"}
        </span>
        <div className="flex items-center gap-0.5">
          {isHtml && onPreviewHtml && (
            <button
              onClick={() => onPreviewHtml(raw)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
            >
              <Eye className="h-3 w-3" /> Visualizar
            </button>
          )}
          <button
            onClick={() => downloadText(raw, `snippet.${ext}`)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
          >
            <Download className="h-3 w-3" /> .{ext}
          </button>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      </div>
      <pre className="m-0 p-4 overflow-x-auto text-[13px] leading-relaxed">{children}</pre>
    </div>
  );
}
