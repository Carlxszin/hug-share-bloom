import { createFileRoute } from "@tanstack/react-router";

// Tries the local Whisper bridge (http://localhost:7677) first — offline, free.
// Falls back to OpenAI Whisper when the bridge is not running.
async function tryLocalWhisper(file: Blob, lang: string | null): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("file", file, "audio.webm");
    if (lang) form.append("language", lang);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch("http://localhost:7677/transcribe", {
      method: "POST",
      body: form,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { text?: string };
    return j.text ?? "";
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!(file instanceof Blob)) {
          return new Response("Arquivo de áudio ausente", { status: 400 });
        }
        const langRaw = incoming.get("language");
        const lang = typeof langRaw === "string" && langRaw ? langRaw : null;

        // 1) Local Whisper bridge (free, offline)
        const local = await tryLocalWhisper(file, lang);
        if (local !== null) {
          return Response.json({ text: local, provider: "local-whisper" });
        }

        // 2) OpenAI fallback
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response(
            "Whisper local não está rodando e OPENAI_API_KEY não está configurada.",
            { status: 500 },
          );
        }

        const upstreamForm = new FormData();
        upstreamForm.append("file", file, "audio.webm");
        upstreamForm.append("model", "whisper-1");
        if (lang) upstreamForm.append("language", lang);

        const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: upstreamForm,
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          return new Response(text || "Falha na transcrição", { status: upstream.status });
        }

        const data = (await upstream.json()) as { text?: string };
        return Response.json({ text: data.text ?? "", provider: "openai" });
      },
    },
  },
});
