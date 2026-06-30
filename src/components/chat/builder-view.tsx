import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Eye, FileCode, Download, ExternalLink, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import JSZip from "jszip";
import { downloadBlob, downloadText } from "@/lib/download";
import { cn } from "@/lib/utils";

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
  // Inline <link rel="stylesheet" href="...css">
  out = out.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (match, href) => {
    const css = files[href];
    return css ? `<style>\n${css}\n</style>` : match;
  });
  // Inline <script src="...js">
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
  onPreviewExternal,
}: {
  files: Record<string, string>;
  onPreviewExternal?: (html: string) => void;
}) {
  const paths = Object.keys(files).sort((a, b) => {
    if (a === "index.html") return -1;
    if (b === "index.html") return 1;
    return a.localeCompare(b);
  });
  const [tab, setTab] = useState<"preview" | string>("preview");
  const previewHtml = useMemo(() => bundleForPreview(files), [files]);
  const empty = paths.length === 0;

  const activeFile = tab !== "preview" ? files[tab] : null;
  const activeLang = tab !== "preview" ? tab.split(".").pop() : null;

  const downloadZip = async () => {
    const zip = new JSZip();
    for (const [p, c] of Object.entries(files)) zip.file(p, c);
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "octopus-site.zip");
  };

  return (
    <div className="flex flex-col h-full bg-background/30">
      <div className="flex items-center justify-between px-4 h-11 border-b border-white/5 bg-background/40 backdrop-blur-xl shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
          <TabBtn
            active={tab === "preview"}
            onClick={() => setTab("preview")}
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Preview"
          />
          {paths.map((p) => (
            <TabBtn
              key={p}
              active={tab === p}
              onClick={() => setTab(p)}
              icon={<FileCode className="h-3.5 w-3.5" />}
              label={p}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0 pl-2">
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
          <FileViewer path={tab} content={activeFile} ext={activeLang ?? "txt"} />
        ) : null}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 h-7 rounded-md text-xs transition whitespace-nowrap",
        active
          ? "bg-primary/15 text-primary border border-primary/30"
          : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04] border border-transparent",
      )}
    >
      {icon}
      <span className="font-mono">{label}</span>
    </button>
  );
}

function FileViewer({ path, content, ext }: { path: string; content: string; ext: string }) {
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {path} · {content.length} chars
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
      <pre className="flex-1 m-0 p-4 overflow-auto text-[12.5px] leading-relaxed font-mono bg-[#0d1117] text-zinc-200">
        <code className={`language-${ext}`}>{content}</code>
      </pre>
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
