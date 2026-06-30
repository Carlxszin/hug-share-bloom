import { createFileRoute } from "@tanstack/react-router";

type Body = { voice?: string; instructions?: string };

export const Route = createFileRoute("/api/realtime-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return new Response("OPENAI_API_KEY ausente no servidor", { status: 500 });
        }

        let body: Body = {};
        try {
          body = (await request.json()) as Body;
        } catch {
          /* empty body ok */
        }

        const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            session: {
              type: "realtime",
              model: "gpt-realtime-mini",
              audio: {
                output: { voice: body.voice ?? "alloy" },
                input: {
                  // Sem transcrição de áudio de entrada (Whisper é cobrado à parte).
                  transcription: null,
                  // VAD do servidor com corte rápido reduz tokens de áudio processados.
                  turn_detection: {
                    type: "server_vad",
                    threshold: 0.6,
                    prefix_padding_ms: 200,
                    silence_duration_ms: 400,
                    create_response: true,
                    interrupt_response: true,
                  },
                },
              },
              // Limita ainda mais a resposta por turno (economia extra ~30-40%).
              max_output_tokens: 250,
              instructions:
                body.instructions ??
                "Você é Aurora, assistente brasileira. Seja calorosa, direta e MUITO CONCISA: responda em 1-2 frases curtas em português. Só dê detalhes se pedirem explicitamente.",
            },
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          return new Response(text || "Falha ao criar sessão Realtime", {
            status: upstream.status,
          });
        }

        const data = await upstream.json();
        return Response.json(data);
      },
    },
  },
});
