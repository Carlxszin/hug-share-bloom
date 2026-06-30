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
        "Pesquisa rápida na web (DuckDuckGo). Use sempre que o usuário pedir uma informação atual, preço, notícia, ou algo que você não saiba com certeza. Retorna até 6 resultados (título, url, snippet).",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "termos de busca em português" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_url",
      description:
        "Abre uma URL em uma nova aba do navegador do usuário, em tempo real. Use quando o usuário pedir para 'abrir', 'ir para', 'mostrar', 'navegar para' um site, ou quando faz sentido visualizar uma página descoberta na pesquisa. Sempre confirme o que está abrindo na sua resposta de voz.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL completa (https://...)" },
          reason: { type: "string", description: "motivo curto, ex: 'site oficial'" },
        },
        required: ["url"],
      },
    },
  },
];

const SYSTEM_TOOLS = `${PERSONA_SYSTEM_VOICE}

Você está em uma CHAMADA DE VOZ. Suas respostas devem ter no máximo 1-2 frases curtas e naturais (vão ser faladas em voz alta).

Você possui ferramentas em tempo real:
- web_search(query): pesquisa na web. Use SEMPRE que precisar de informação atual ou específica.
- open_url(url, reason): abre uma página no navegador do chefe AGORA, em uma nova aba.

Quando o chefe pedir para "abrir", "ir em", "mostrar" um site (ex.: "abre o YouTube", "vai no Google"), use open_url imediatamente. Não diga que não pode — VOCÊ PODE abrir páginas web em novas abas.
Se o chefe pedir um app nativo (ex.: "abre o Chrome", "abre o WhatsApp"), abra a versão web equivalente (https://www.google.com, https://web.whatsapp.com, etc.) e avise.
Sempre confirme em voz o que está fazendo, ex.: "Pronto, chefe, abri o YouTube pra você."`;

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
    throw new Error(t || `Gateway ${res.status}`);
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
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
  },
});
