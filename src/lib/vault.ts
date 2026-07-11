// Client helper para persistir conversas/imagens/arquivos no disco do chefe.
// Só funciona quando o Octopus roda localmente (rota /api/local-vault
// grava em ~/octopus-data). Em cloud a chamada falha silenciosamente.

let available: boolean | null = null;

async function isAvailable() {
  if (available !== null) return available;
  try {
    const r = await fetch("/api/local-vault", { method: "GET" });
    available = r.ok;
  } catch {
    available = false;
  }
  return available;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced: salva a conversa (JSON) em ~/octopus-data/chats/<id>.json */
export function saveChatToVault(id: string, conversation: unknown, delayMs = 800) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(async () => {
    timers.delete(id);
    if (!(await isAvailable())) return;
    await fetch("/api/local-vault", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "chat",
        id,
        content: JSON.stringify(conversation, null, 2),
      }),
    }).catch(() => {});
  }, delayMs);
  timers.set(id, t);
}

/** Salva imagem/arquivo (dataURL base64) em ~/octopus-data/{images|files}/ */
export async function saveBlobToVault(
  kind: "image" | "file",
  id: string,
  name: string,
  dataUrl: string,
) {
  if (!(await isAvailable())) return null;
  const r = await fetch("/api/local-vault", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, id, name, dataUrl }),
  });
  return r.ok ? ((await r.json()) as { path: string }).path : null;
}
