import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_SYSTEM } from "@/lib/persona";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type Body = { model: string; messages: ChatMessage[]; systemAddon?: string };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response("OPENAI_API_KEY ausente no servidor", { status: 500 });
        }
        const body = (await request.json()) as Body;
        if (!body?.model || !Array.isArray(body.messages)) {
          return new Response("Requisição inválida", { status: 400 });
        }

        // Guard: never forward the sentinel "auto" to OpenAI — fall back to a real model.
        const KNOWN = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"]);
        const safeModel = KNOWN.has(body.model) ? body.model : "gpt-5-mini";

        const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: safeModel,
            messages: [
              { role: "system", content: PERSONA_SYSTEM + (body.systemAddon ? " " + body.systemAddon : "") },
              ...body.messages.filter((m) => m.role !== "system"),
            ],
            stream: true,
            stream_options: { include_usage: true },
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text();
          return new Response(text || "Falha na OpenAI", { status: upstream.status });
        }

        // Pass through SSE stream as text/event-stream
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
