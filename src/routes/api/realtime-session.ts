import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_SYSTEM_VOICE } from "@/lib/persona";

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
                  transcription: null,
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
              max_output_tokens: 200,
              tools: [
                {
                  type: "function",
                  name: "web_search",
                  description:
                    "Pesquisa rápida na web (DuckDuckGo). Use sempre que o chefe pedir informação atual, preço, notícia ou algo que você não sabe com certeza.",
                  parameters: {
                    type: "object",
                    properties: { query: { type: "string", description: "termos de busca em pt-BR" } },
                    required: ["query"],
                  },
                },
                {
                  type: "function",
                  name: "open_url",
                  description:
                    "Abre uma URL em nova aba do navegador do chefe AGORA. Use quando pedir abrir/tocar/colocar/mostrar/ir em algo (site, música, vídeo, app). Para músicas/vídeos use https://www.youtube.com/results?search_query=NOME. Confirme em 1 frase curta.",
                  parameters: {
                    type: "object",
                    properties: {
                      url: { type: "string", description: "URL completa (https://...)" },
                      reason: { type: "string", description: "motivo curto" },
                    },
                    required: ["url"],
                  },
                },
              ],
              tool_choice: "auto",
              instructions:
                body.instructions ??
                `${PERSONA_SYSTEM_VOICE}\n\nVocê tem ferramentas em tempo real: web_search(query) e open_url(url). Quando o chefe pedir abrir/tocar/colocar/mostrar/ir em algo, CHAME open_url IMEDIATAMENTE — nunca diga que não pode. Para apps nativos use a versão web (google.com, web.whatsapp.com, youtube.com). Para música/vídeo use https://www.youtube.com/results?search_query=NOME. Confirme em 1 frase ("Pronto, chefe.").`,
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
