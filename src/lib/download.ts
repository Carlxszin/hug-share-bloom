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

/** Build a markdown log of every Builder edit across the conversation. */
export function buildBuilderLog(messages: Message[], title = "Builder"): string {
  const lines: string[] = [];
  lines.push(`# Log de edições — ${title}`);
  lines.push(`Gerado em: ${new Date().toLocaleString()}`);
  lines.push("");
  let turn = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || !m.edits || m.edits.length === 0) continue;
    turn++;
    const when = new Date(m.createdAt).toLocaleString();
    lines.push(`## Turno ${turn} — ${when}`);
    if (typeof m.costUSD === "number") {
      lines.push(`Custo: US$ ${m.costUSD.toFixed(5)}  ·  in ${m.inputTokens ?? 0} / out ${m.outputTokens ?? 0} tokens`);
    }
    if (m.content) {
      lines.push("");
      lines.push(`> ${m.content.replace(/\n/g, "\n> ")}`);
    }
    lines.push("");
    for (const e of m.edits) {
      if (e.tool === "write") {
        lines.push(`### ${e.isNew ? "CREATE" : "REWRITE"} \`${e.path}\` (${e.size ?? 0} chars)`);
        if (e.preview) {
          lines.push("```");
          lines.push(e.preview);
          lines.push("```");
        }
      } else if (e.tool === "delete") {
        lines.push(`### DELETE \`${e.path}\``);
      } else if (e.tool === "edit") {
        const head = e.ok === false
          ? `### EDIT (falhou) \`${e.path}\` — ${e.error ?? ""}`
          : `### EDIT \`${e.path}\`${e.line ? ` (linha ${e.line})` : ""}`;
        lines.push(head);
        if (e.ok !== false && e.old && e.new) {
          lines.push("```diff");
          for (const l of e.old.split("\n")) lines.push(`- ${l}`);
          for (const l of e.new.split("\n")) lines.push(`+ ${l}`);
          lines.push("```");
        }
      }
      lines.push("");
    }
  }
  if (turn === 0) lines.push("_Nenhuma edição registrada nesta conversa ainda._");
  return lines.join("\n");
}

export function downloadBuilderLog(messages: Message[], title = "octopus-builder") {
  const md = buildBuilderLog(messages, title);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadText(md, `${title}-log-${stamp}.md`, "text/markdown");
}
