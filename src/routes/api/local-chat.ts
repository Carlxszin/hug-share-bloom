import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_SYSTEM_VOICE } from "@/lib/persona";

type Body = {
  model?: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  systemAddon?: string;
};

// Proxies to a local Ollama server (http://localhost:11434) and emits
// SSE in the same OpenAI-compatible shape the client already parses
// for /api/chat: `data: {"choices":[{"delta":{"content":"..."}}]}`
// followed by `data: {"usage":{...}}` and `data: [DONE]`.
export const Route = createFileRoute("/api/local-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as Body;
        const raw = body.model || "llama3.1";
        // Map short aliases → real Ollama tags.
        const model = raw.includes(":") ? raw : `${raw}:8b`;

        const system = [PERSONA_SYSTEM_VOICE, body.systemAddon].filter(Boolean).join("\n\n");
        const messages = [
          { role: "system" as const, content: system },
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
            let promptTokens = 0;
            let completionTokens = 0;
            const emit = (obj: unknown) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
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
                      prompt_eval_count?: number;
                      eval_count?: number;
                    };
                    const chunk = j.message?.content ?? "";
                    if (chunk) emit({ choices: [{ delta: { content: chunk } }] });
                    if (j.done) {
                      promptTokens = j.prompt_eval_count ?? 0;
                      completionTokens = j.eval_count ?? 0;
                    }
                  } catch {
                    /* skip malformed line */
                  }
                }
              }
              emit({ usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
