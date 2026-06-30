import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response("OPENAI_API_KEY ausente no servidor", { status: 500 });
        }

        const incoming = await request.formData();
        const file = incoming.get("file");
        if (!(file instanceof Blob)) {
          return new Response("Arquivo de áudio ausente", { status: 400 });
        }

        const upstreamForm = new FormData();
        upstreamForm.append("file", file, "audio.webm");
        upstreamForm.append("model", "whisper-1");
        const lang = incoming.get("language");
        if (typeof lang === "string" && lang) upstreamForm.append("language", lang);

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
        return Response.json({ text: data.text ?? "" });
      },
    },
  },
});
