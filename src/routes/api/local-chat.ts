import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_SYSTEM_VOICE } from "@/lib/persona";

type Body = {
  model?: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
};

// Proxies to a local Ollama server (http://localhost:11434). Streams NDJSON
// from Ollama and re-emits as text/plain chunks the client can accumulate.
export const Route = createFileRoute("/api/local-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        const model = body.model || "llama3.1:8b";
        const messages = [
          { role: "system" as const, content: PERSONA_SYSTEM_VOICE },
          ...body.messages.filter((m) => m.role !== "system"),
        ];

        let upstream: Response;
        try {
          upstream = await fetch("http://localhost:11434/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages, stream: true }),
          });
        } catch {
          return new Response(
            "Ollama não está rodando. Instale https://ollama.com e rode `ollama serve`.",
            { status: 503 },
          );
        }

        if (!upstream.ok || !upstream.body) {
          return new Response(await upstream.text(), { status: upstream.status });
        }

        const stream = new ReadableStream({
          async start(controller) {
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            let buf = "";
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() ?? "";
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const j = JSON.parse(line) as {
                      message?: { content?: string };
                      done?: boolean;
                    };
                    const chunk = j.message?.content ?? "";
                    if (chunk) controller.enqueue(encoder.encode(chunk));
                  } catch {
                    /* skip malformed line */
                  }
                }
              }
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
