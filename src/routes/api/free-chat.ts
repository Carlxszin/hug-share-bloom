import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_SYSTEM_VOICE } from "@/lib/persona";

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
type Body = { messages: { role: "user" | "assistant" | "system"; content: string }[] };

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Pesquisa rápida na web (DuckDuckGo). Use para informação atual, preço, notícia.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_video",
      description:
        "Busca vídeos no YouTube e devolve top resultados (id, título, canal, url). Use SEMPRE para pedidos de vídeo/música/clipe.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_page",
      description:
        "Lê uma página: título, headings, texto resumido, e CAMPOS de formulário. Use para entender uma página antes de agir.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_url",
      description:
        "Abre uma URL no navegador embutido do chefe AGORA. Para vídeo/música, chame find_video PRIMEIRO e use a url do resultado.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          reason: { type: "string" },
        },
        required: ["url"],
      },
    },
  },
];

const SYSTEM_TOOLS = `${PERSONA_SYSTEM_VOICE}

Você está em uma CHAMADA DE VOZ. Respostas no máximo 1-2 frases curtas.

Ferramentas:
- web_search(query): pesquisa.
- find_video(query): busca vídeos no YouTube → SEMPRE use para pedidos de música/vídeo.
- read_page(url): lê página + campos (para entender onde está cada coisa).
- open_url(url): abre página no navegador embutido do chefe.

Fluxo: para vídeo → find_video → open_url do vídeo escolhido. Para sites → open_url. Confirme em 1 frase. Nunca diga que não pode.`;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function ddgSearch(query: string) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; OctopusVoice/1.0; +https://lovable.dev)",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`DDG ${res.status}`);
  const html = await res.text();
  const results: { title: string; url: string; snippet?: string }[] = [];
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 6) {
    let rawUrl = m[1];
    const uddg = rawUrl.match(/uddg=([^&]+)/);
    if (uddg) rawUrl = decodeURIComponent(uddg[1]);
    results.push({
      url: rawUrl,
      title: stripHtml(m[2]).slice(0, 160),
      snippet: stripHtml(m[3]).slice(0, 220),
    });
  }
  return results;
}

class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function callGateway(apiKey: string, messages: Msg[]) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new GatewayError(res.status, t || `Gateway ${res.status}`);
  }
  return res.json() as Promise<{
    choices: Array<{
      message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] };
    }>;
  }>;
}

export const Route = createFileRoute("/api/free-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("LOVABLE_API_KEY ausente no servidor", { status: 500 });

        const body = (await request.json()) as Body;
        const messages: Msg[] = [
          { role: "system", content: SYSTEM_TOOLS },
          ...body.messages
            .filter((m) => m.role !== "system")
            .map((m) => ({ role: m.role, content: m.content })),
        ];

        const opens: { url: string; reason?: string }[] = [];
        const searches: { query: string; count: number }[] = [];

        try {
          for (let step = 0; step < 4; step++) {
            const data = await callGateway(apiKey, messages);
            const msg = data.choices[0]?.message;
            if (!msg) break;
            messages.push({
              role: "assistant",
              content: msg.content ?? "",
              tool_calls: msg.tool_calls,
            });

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
              return Response.json({ reply: msg.content ?? "", opens, searches });
            }

            for (const call of msg.tool_calls) {
              let result = "";
              try {
                const args = JSON.parse(call.function.arguments || "{}");
                if (call.function.name === "web_search") {
                  const links = await ddgSearch(String(args.query));
                  searches.push({ query: String(args.query), count: links.length });
                  result = JSON.stringify(links);
                } else if (call.function.name === "open_url") {
                  const url = String(args.url);
                  opens.push({ url, reason: args.reason });
                  result = `ok: aberto ${url}`;
                } else {
                  result = `error: tool desconhecida ${call.function.name}`;
                }
              } catch (e) {
                result = `error: ${(e as Error).message}`;
              }
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: result.slice(0, 6000),
              });
            }
          }
          return Response.json({
            reply: "Desculpa, chefe, demorou demais. Pode repetir?",
            opens,
            searches,
          });
        } catch (e) {
          const err = e as GatewayError;
          const status = err.status ?? 500;
          if (status === 429 || status === 402 || status >= 500) {
            const reason =
              status === 402
                ? "Os créditos grátis acabaram, chefe. Adicione créditos ou use o modo pago (OpenAI)."
                : status === 429
                ? "A API grátis está sobrecarregada agora, chefe. Tente em 1 minuto ou troque para o modo pago (OpenAI)."
                : "A API grátis está instável, chefe. Tente novamente ou use o modo pago.";
            return Response.json(
              { reply: reason, opens, searches, fallback: true, code: status },
              { status: 200 },
            );
          }
          return new Response(err.message, { status });
        }
      },
    },
  },
});
