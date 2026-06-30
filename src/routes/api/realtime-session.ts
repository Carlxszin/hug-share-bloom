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
                    threshold: 0.7,
                    prefix_padding_ms: 150,
                    silence_duration_ms: 300,
                    create_response: true,
                    interrupt_response: true,
                  },
                },
              },
              // Resposta ultra-curta por turno (economia máxima).
              max_output_tokens: 150,
              instructions:
                body.instructions ??
                "Você é Aurora, assistente brasileira. SEJA EXTREMAMENTE BREVE: responda em 1 frase curta (máx 15 palavras) em português. Nunca faça introduções nem repita a pergunta. Vá direto ao ponto. Só expanda se pedirem 'me explique mais'.",
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
