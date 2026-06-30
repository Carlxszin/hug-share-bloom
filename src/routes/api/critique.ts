import { createFileRoute } from "@tanstack/react-router";

// Self-critique: cheap model rates the quality of the assistant response (0..1).
// Non-blocking — called in background after each turn to populate metrics.selfScore.

type Body = { userPrompt: string; assistantReply: string };

export const Route = createFileRoute("/api/critique")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return new Response(JSON.stringify({ score: 0.5 }), { status: 200 });
        const { userPrompt, assistantReply } = (await request.json()) as Body;
        if (!userPrompt || !assistantReply) {
          return new Response(JSON.stringify({ score: 0.5 }), { status: 200 });
        }

        try {
          const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-5-nano",
              messages: [
                {
                  role: "system",
                  content:
                    "Você é um juiz crítico. Avalie de 0.0 a 1.0 o quão bem a RESPOSTA atende ao PEDIDO. Considere: correção, completude, clareza, ausência de alucinação. Responda APENAS JSON: {\"score\":0.0,\"reason\":\"...\"}.",
                },
                {
                  role: "user",
                  content: `PEDIDO:\n${userPrompt.slice(0, 2000)}\n\nRESPOSTA:\n${assistantReply.slice(0, 4000)}`,
                },
              ],
              response_format: { type: "json_object" },
              max_completion_tokens: 80,
            }),
          });
          if (!upstream.ok) return new Response(JSON.stringify({ score: 0.5 }), { status: 200 });
          const data = await upstream.json();
          const raw = data.choices?.[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(raw);
          const score = typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 0.5;
          return new Response(JSON.stringify({ score, reason: parsed.reason ?? "" }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ score: 0.5 }), { status: 200 });
        }
      },
    },
  },
});
