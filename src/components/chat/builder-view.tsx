import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Eye,
  FileCode,
  Download,
  ExternalLink,
  Code2,
  Pencil,
  Plus,
  Trash2,
  AlertCircle,
  Loader2,
  FileText,
} from "lucide-react";
import hljs from "highlight.js";
import { Button } from "@/components/ui/button";
import JSZip from "jszip";
import { downloadBlob, downloadText, downloadBuilderLog } from "@/lib/download";
import { cn } from "@/lib/utils";
import type { BuilderActivity } from "@/routes/index";
import type { Message } from "@/lib/storage";

function bundleForPreview(files: Record<string, string>): string {
  const html = files["index.html"];
  if (!html) {
    const first = Object.entries(files).find(([p]) => p.endsWith(".html"));
    if (!first) {
      return `<!doctype html><html><body style="font-family:system-ui;padding:40px;color:#888;background:#0a0a0a">
<h2 style="color:#fff">Workspace vazio</h2>
<p>Peça ao Octopus Builder para criar um <code>index.html</code> para começar.</p>
</body></html>`;
    }
    return first[1];
  }
  let out = html;
  out = out.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (match, href) => {
    const css = files[href];
    return css ? `<style>\n${css}\n</style>` : match;
  });
  out = out.replace(
    /<script([^>]*)src=["']([^"']+\.js)["']([^>]*)><\/script>/gi,
    (match, pre, src, post) => {
      const js = files[src];
      return js ? `<script${pre}${post}>\n${js}\n</script>` : match;
    },
  );
  return out;
}

export function BuilderView({
  files,
  messages = [],
  conversationTitle = "octopus-builder",
  onPreviewExternal,
  activity = [],
  focusFile = null,
  streaming = false,
}: {
  files: Record<string, string>;
  messages?: Message[];
  conversationTitle?: string;
  onPreviewExternal?: (html: string) => void;
  activity?: BuilderActivity[];
  focusFile?: string | null;
  streaming?: boolean;
}) {
  const paths = Object.keys(files).sort((a, b) => {
    if (a === "index.html") return -1;
    if (b === "index.html") return 1;
    return a.localeCompare(b);
  });
  const [tab, setTab] = useState<"preview" | string>("preview");
  const [showActivity, setShowActivity] = useState(true);
  const previewHtml = useMemo(() => bundleForPreview(files), [files]);
  const empty = paths.length === 0;

  useEffect(() => {
    if (streaming && focusFile && files[focusFile] !== undefined) {
      setTab(focusFile);
    }
  }, [focusFile, streaming, files]);

  useEffect(() => {
    if (!streaming && activity.length > 0) {
      const t = setTimeout(() => setTab("preview"), 600);
      return () => clearTimeout(t);
    }
  }, [streaming, activity.length]);

  const activeFile = tab !== "preview" ? files[tab] : null;
  const activeLang = tab !== "preview" ? tab.split(".").pop() : null;

  const downloadZip = async () => {
    const zip = new JSZip();
    for (const [p, c] of Object.entries(files)) zip.file(p, c);
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "octopus-site.zip");
  };

  const hasLog = messages.some((m) => m.edits && m.edits.length > 0);

  return (
    <div className="flex flex-col h-full bg-background/30 relative">
      <div className="flex items-center justify-between px-4 h-11 border-b border-white/5 bg-background/40 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          <TabBtn
            active={tab === "preview"}
            onClick={() => setTab("preview")}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Preview"
          />
          {paths.map((p) => {
            const edited = activity.some((a) => a.path === p && a.ok !== false);
            return (
              <TabBtn
                key={p}
                active={tab === p}
                onClick={() => setTab(p)}
                icon={<FileCode className="h-3.5 w-3.5" />}
                label={p}
                pulse={streaming && focusFile === p}
                dot={edited}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-1 shrink-0 pl-2">
          {activity.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowActivity((v) => !v)}
              className="h-7 text-xs gap-1.5"
            >
              {streaming && <Loader2 className="h-3 w-3 animate-spin" />}
              {showActivity ? "Ocultar" : "Mostrar"} edições ({activity.length})
            </Button>
          )}
          {hasLog && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => downloadBuilderLog(messages, conversationTitle || "octopus-builder")}
              className="h-7 text-xs gap-1.5"
              title="Baixar log completo de edições"
            >
              <FileText className="h-3 w-3" /> Log
            </Button>
          )}
          {tab === "preview" && !empty && onPreviewExternal && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onPreviewExternal(previewHtml)}
              className="h-7 text-xs gap-1.5"
            >
              <ExternalLink className="h-3 w-3" /> Expandir
            </Button>
          )}
          {!empty && (
            <Button
              size="sm"
              variant="ghost"
              onClick={downloadZip}
              className="h-7 text-xs gap-1.5"
            >
              <Download className="h-3 w-3" /> .zip
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {empty ? (
          <EmptyBuilder />
        ) : tab === "preview" ? (
          <motion.iframe
            key={previewHtml.length + ":" + paths.length}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            title="Preview"
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            srcDoc={previewHtml}
            className="absolute inset-0 w-full h-full bg-white"
          />
        ) : activeFile != null ? (
          <FileViewer
            path={tab}
            content={activeFile}
            ext={activeLang ?? "txt"}
            activity={activity.filter((a) => a.path === tab)}
          />
        ) : null}

        <AnimatePresence>
          {showActivity && activity.length > 0 && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-3 right-3 bottom-3 w-[340px] rounded-xl border border-white/10 bg-background/85 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 h-9 border-b border-white/5 text-[11px] uppercase tracking-wider text-muted-foreground">
                {streaming ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <Pencil className="h-3 w-3 text-primary" />
                )}
                Processo de edição
              </div>
              <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1.5">
                <AnimatePresence initial={false}>
                  {activity.map((a) => (
                    <ActivityRow key={a.id} a={a} />
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ActivityRow({ a }: { a: BuilderActivity }) {
  const Icon = a.tool === "delete" ? Trash2 : a.tool === "edit" ? Pencil : Plus;
  const color =
    a.ok === false
      ? "text-destructive"
      : a.tool === "delete"
        ? "text-red-400"
        : a.tool === "edit"
          ? "text-amber-400"
          : "text-emerald-400";
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2 text-[12px]"
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn("h-3 w-3 shrink-0", color)} />
        <span className="font-mono truncate flex-1">{a.path}</span>
        {a.tool === "edit" && a.line != null && a.ok !== false && (
          <span className="text-[10px] font-mono text-amber-300/80 bg-amber-500/10 border border-amber-500/20 rounded px-1">
            L{a.line}
          </span>
        )}
        {a.ok === false && (
          <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle className="h-3 w-3" /> {a.error}
          </span>
        )}
        {a.size != null && (
          <span className="text-[10px] text-muted-foreground/70">{a.size}c</span>
        )}
      </div>
      {a.tool === "edit" && a.ok !== false && a.old && a.new && (
        <div className="mt-1.5 space-y-0.5">
          <DiffBlock kind="del" text={a.old} startLine={a.line} />
          <DiffBlock kind="add" text={a.new} startLine={a.line} />
        </div>
      )}
      {a.tool === "write" && a.preview && (
        <pre className="mt-1.5 text-[10.5px] font-mono text-muted-foreground/80 max-h-16 overflow-hidden whitespace-pre-wrap break-all">
          {a.preview}
          {a.size && a.preview.length < a.size ? "…" : ""}
        </pre>
      )}
    </motion.div>
  );
}

function DiffBlock({
  kind,
  text,
  startLine,
}: {
  kind: "add" | "del";
  text: string;
  startLine?: number;
}) {
  const lines = text.split("\n");
  const max = 6;
  const shown = lines.slice(0, max);
  return (
    <div
      className={cn(
        "text-[10.5px] font-mono rounded border whitespace-pre-wrap break-all overflow-hidden",
        kind === "add"
          ? "bg-emerald-500/10 text-emerald-200 border-emerald-500/20"
          : "bg-red-500/10 text-red-200 border-red-500/20",
      )}
    >
      {shown.map((l, i) => (
        <div key={i} className="flex gap-2 px-1.5 py-0.5">
          {startLine != null && (
            <span className="opacity-50 select-none w-6 text-right shrink-0">
              {startLine + i}
            </span>
          )}
          <span className="opacity-60 select-none shrink-0">{kind === "add" ? "+" : "−"}</span>
          <span className="flex-1 break-all">{l || " "}</span>
        </div>
      ))}
      {lines.length > max && (
        <div className="px-1.5 py-0.5 opacity-50">… +{lines.length - max} linhas</div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
  pulse,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  pulse?: boolean;
  dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 px-3 h-7 rounded-md text-xs transition whitespace-nowrap",
        active
          ? "bg-primary/15 text-primary border border-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04] border border-transparent",
      )}
    >
      {icon}
      <span className="font-mono">{label}</span>
      {dot && !pulse && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
      {pulse && (
        <motion.span
          className="h-1.5 w-1.5 rounded-full bg-primary"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.9, 1.2, 0.9] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      )}
    </button>
  );
}

const HLJS_LANG: Record<string, string> = {
  html: "xml",
  htm: "xml",
  svg: "xml",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  md: "markdown",
  yml: "yaml",
  sh: "bash",
};

function highlightCode(content: string, ext: string): string {
  const lang = HLJS_LANG[ext] ?? ext;
  try {
    if (hljs.getLanguage(lang)) {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    }
  } catch {
    /* fall through */
  }
  return escapeHtml(content);
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

function FileViewer({
  path,
  content,
  ext,
  activity,
}: {
  path: string;
  content: string;
  ext: string;
  activity: BuilderActivity[];
}) {
  const lastEdit = [...activity].reverse().find((a) => a.tool === "edit" && a.ok !== false);
  const html = useMemo(() => highlightCode(content, ext), [content, ext]);
  const totalLines = useMemo(() => content.split("\n").length, [content]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {path} · {totalLines} linhas · {content.length} chars
          {lastEdit && lastEdit.line && (
            <span className="ml-2 text-amber-400 normal-case">
              · editado na linha {lastEdit.line}
            </span>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => downloadText(content, path)}
          className="h-6 text-[10px] gap-1"
        >
          <Download className="h-3 w-3" /> baixar
        </Button>
      </div>
      <div className="flex-1 m-0 overflow-auto text-[12.5px] leading-relaxed font-mono bg-[#0d1117]">
        <pre className="m-0 p-0 flex">
          <code
            aria-hidden
            className="select-none text-right pr-3 pl-3 py-4 text-zinc-600 border-r border-white/5 shrink-0"
          >
            {Array.from({ length: totalLines }, (_, i) => (
              <div
                key={i}
                className={cn(
                  "leading-relaxed",
                  lastEdit && lastEdit.line === i + 1 && "text-amber-400 font-semibold",
                )}
              >
                {i + 1}
              </div>
            ))}
          </code>
          <code
            className={`hljs language-${ext} flex-1 p-4 text-zinc-200`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    </div>
  );
}

function EmptyBuilder() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
      <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary mb-4">
        <Code2 className="h-6 w-6" />
      </div>
      <h3 className="text-base font-medium tracking-tight">Workspace pronto</h3>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-xs">
        Descreva o site que quer criar no chat ao lado. O Octopus vai gerar e editar os arquivos
        aqui em tempo real.
      </p>
    </div>
  );
}
