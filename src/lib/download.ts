import JSZip from "jszip";
import type { Message } from "./storage";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(content: string, filename: string, mime = "text/plain") {
  downloadBlob(new Blob([content], { type: mime }), filename);
}

export type CodeBlock = { lang: string; code: string };

/** Extract fenced code blocks from a markdown string. */
export function extractCodeBlocks(md: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    blocks.push({ lang: (m[1] || "").toLowerCase(), code: m[2] });
  }
  return blocks;
}

/** Build a zip of all html/css/js blocks (+ markdown source as README.md). */
export async function zipMarkdownProject(md: string, baseName = "octopus-project") {
  const zip = new JSZip();
  const blocks = extractCodeBlocks(md);
  const counters: Record<string, number> = {};
  const extMap: Record<string, string> = {
    html: "html",
    css: "css",
    js: "js",
    javascript: "js",
    ts: "ts",
    typescript: "ts",
    jsx: "jsx",
    tsx: "tsx",
    json: "json",
    md: "md",
  };
  for (const b of blocks) {
    const ext = extMap[b.lang] ?? (b.lang || "txt");
    counters[ext] = (counters[ext] ?? 0) + 1;
    const n = counters[ext];
    const name =
      ext === "html" && n === 1
        ? "index.html"
        : `file${n}.${ext}`;
    zip.file(name, b.code);
  }
  zip.file("README.md", md);
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, `${baseName}.zip`);
}
