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
                    threshold: 0.8,
                    prefix_padding_ms: 100,
                    silence_duration_ms: 200,
                    create_response: true,
                    interrupt_response: true,
                  },
                },
              },
              max_output_tokens: 90,
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
                    "Abre uma URL no navegador embutido do chefe AGORA. Use quando pedir abrir/tocar/colocar/mostrar/ir em algo. Para músicas/vídeos prefira chamar find_video PRIMEIRO e usar a URL retornada. Confirme em 1 frase curta.",
                  parameters: {
                    type: "object",
                    properties: {
                      url: { type: "string", description: "URL completa (https://...)" },
                      reason: { type: "string", description: "motivo curto" },
                    },
                    required: ["url"],
                  },
                },
                {
                  type: "function",
                  name: "read_page",
                  description:
                    "Lê o conteúdo de uma página web e devolve título, headings, texto resumido e CAMPOS de formulário (input/textarea/select com name, id, type, placeholder, aria-label). Use sempre que precisar entender o que tem numa página, achar onde clicar/preencher, ou responder com base em conteúdo real.",
                  parameters: {
                    type: "object",
                    properties: { url: { type: "string" } },
                    required: ["url"],
                  },
                },
                {
                  type: "function",
                  name: "find_video",
                  description:
                    "Busca vídeos no YouTube e devolve os top resultados com id, título, canal e URL pronta para tocar. Use quando o chefe pedir vídeo, música ou clipe. Depois chame open_url com a URL do vídeo escolhido.",
                  parameters: {
                    type: "object",
                    properties: { query: { type: "string" } },
                    required: ["query"],
                  },
                },
              ],
              tool_choice: "auto",
              instructions:
                body.instructions ??
                `${PERSONA_SYSTEM_VOICE}\n\nREGRA DE ECONOMIA (obrigatória):\n- Responda em UMA frase curta, máx 15 palavras.\n- Nunca repita o que o chefe disse.\n- Sem introduções, sem "claro", sem despedidas longas.\n- Se for executar ferramenta, fale só "Já vou, chefe." e execute.\n\nFerramentas: web_search, find_video, read_page, open_url.\nFluxo: música/vídeo → find_video → open_url. Site → open_url direto.`,
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
