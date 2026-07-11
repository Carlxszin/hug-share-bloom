import { createFileRoute } from "@tanstack/react-router";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";

// Cofre local no disco do chefe. Persiste conversas, imagens e arquivos
// em `~/octopus-data` (ou OCTOPUS_VAULT_DIR). Só existe quando o Octopus
// roda localmente — em cloud isso é ignorado (o cliente engole o erro).

function vaultRoot() {
  return process.env.OCTOPUS_VAULT_DIR || join(homedir(), "octopus-data");
}

async function ensureDir(p: string) {
  if (!existsSync(p)) await mkdir(p, { recursive: true });
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export const Route = createFileRoute("/api/local-vault")({
  server: {
    handlers: {
      // GET ?list=chats | ?read=chats/<id>.json
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const list = url.searchParams.get("list");
        const read = url.searchParams.get("read");
        const root = vaultRoot();
        try {
          if (list) {
            const dir = join(root, safeName(list));
            if (!existsSync(dir)) return Response.json({ items: [] });
            const items = await readdir(dir);
            return Response.json({ items });
          }
          if (read) {
            const full = join(root, read.split("/").map(safeName).join("/"));
            const buf = await readFile(full);
            return new Response(buf);
          }
          return Response.json({ root });
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
      // POST { kind: 'chat'|'image'|'file', id, name?, content?, dataUrl? }
      POST: async ({ request }) => {
        const root = vaultRoot();
        try {
          await ensureDir(root);
          const body = (await request.json()) as {
            kind: "chat" | "image" | "file";
            id: string;
            name?: string;
            content?: string;
            dataUrl?: string;
          };

          if (body.kind === "chat") {
            const dir = join(root, "chats");
            await ensureDir(dir);
            const file = join(dir, `${safeName(body.id)}.json`);
            await writeFile(file, body.content ?? "", "utf8");
            return Response.json({ ok: true, path: file });
          }

          if (body.kind === "image" || body.kind === "file") {
            const dir = join(root, body.kind === "image" ? "images" : "files");
            await ensureDir(dir);
            const raw = body.dataUrl ?? "";
            const m = raw.match(/^data:([^;]+);base64,(.*)$/);
            if (!m) return new Response("dataUrl inválido", { status: 400 });
            const ext = extname(body.name ?? "") || `.${m[1].split("/")[1] || "bin"}`;
            const file = join(dir, `${safeName(body.id)}${ext}`);
            await writeFile(file, Buffer.from(m[2], "base64"));
            return Response.json({ ok: true, path: file });
          }

          return new Response("kind inválido", { status: 400 });
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
  },
});
