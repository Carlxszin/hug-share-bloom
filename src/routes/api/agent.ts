import { createFileRoute } from "@tanstack/react-router";
import { getModel, costUSD } from "@/lib/models";

type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
};

type Body = {
  model: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web via DuckDuckGo. Returns up to 8 results with title, URL and snippet. Use this to discover relevant pages.",
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
      name: "fetch_page",
      description:
        "Fetch a URL and return its visible text (HTML stripped, truncated to ~6000 chars). Use to read article/page content.",
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
      name: "screenshot",
      description:
        "Take a screenshot of a public URL (via thum.io free service) and return its image URL to show the user.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
];

const SYSTEM = `You are Octopus Agent — an autonomous web task executor.

You have tools to search the web, fetch pages and capture screenshots. Plan briefly, then call tools in a loop until the user's task is done. Prefer multiple short tool calls over giant ones. Always cite the URLs you used. Reply in Portuguese (Brasil) unless the user writes in another language. At the end, give a clear, concise answer with bullet points and the source links.`;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function ddgSearch(query: string) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; OctopusAgent/1.0; +https://lovable.dev)",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const results: { title: string; url: string; snippet?: string }[] = [];
  const re =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && results.length < 8) {
    let rawUrl = m[1];
    // DDG wraps with /l/?uddg=
    const uddg = rawUrl.match(/uddg=([^&]+)/);
    if (uddg) rawUrl = decodeURIComponent(uddg[1]);
    results.push({
      url: rawUrl,
      title: stripHtml(m[2]).slice(0, 200),
      snippet: stripHtml(m[3]).slice(0, 280),
    });
  }
  return results;
}

async function fetchPage(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; OctopusAgent/1.0; +https://lovable.dev)",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text") && !ct.includes("html") && !ct.includes("json")) {
    return `(binary content, ${ct})`;
  }
  const body = await res.text();
  const text = ct.includes("html") ? stripHtml(body) : body;
  return text.slice(0, 6000);
}

function screenshotUrl(url: string) {
  // thum.io free, no key required
  const clean = url.replace(/^https?:\/\//, "");
  return `https://image.thum.io/get/width/1024/crop/768/https://${clean}`;
}

async function runOpenAI(apiKey: string, model: string, messages: ChatMessage[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: true,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t}`);
  }
  return res.json() as Promise<{
    choices: Array<{
      message: {
        role: "assistant";
        content: string | null;
        tool_calls?: ChatMessage["tool_calls"];
      };
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>;
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return new Response("OPENAI_API_KEY ausente", { status: 500 });

        const body = (await request.json()) as Body;
        if (!body?.model || !Array.isArray(body.messages)) {
          return new Response("Bad request", { status: 400 });
        }

        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM },
          ...body.messages.map((m) => ({ role: m.role, content: m.content })),
        ];

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            let totalIn = 0;
            let totalOut = 0;
            try {
              for (let step = 0; step < 10; step++) {
                send({ type: "step", step });
                const data = await runOpenAI(apiKey, body.model, messages);
                totalIn += data.usage?.prompt_tokens ?? 0;
                totalOut += data.usage?.completion_tokens ?? 0;
                const msg = data.choices[0].message;
                messages.push({
                  role: "assistant",
                  content: msg.content,
                  tool_calls: msg.tool_calls,
                });

                if (!msg.tool_calls || msg.tool_calls.length === 0) {
                  const cost = costUSD(getModel(body.model), totalIn, totalOut);
                  send({
                    type: "done",
                    message: msg.content ?? "",
                    usage: { inputTokens: totalIn, outputTokens: totalOut, usd: cost.total },
                  });
                  controller.close();
                  return;
                }

                for (const call of msg.tool_calls) {
                  let toolResult = "";
                  let event: Record<string, unknown> = {};
                  try {
                    const args = JSON.parse(call.function.arguments);
                    if (call.function.name === "web_search") {
                      const links = await ddgSearch(String(args.query));
                      toolResult = JSON.stringify(links);
                      event = {
                        type: "action",
                        tool: "web_search",
                        input: args,
                        ok: true,
                        result: `${links.length} resultados`,
                        links,
                      };
                    } else if (call.function.name === "fetch_page") {
                      const text = await fetchPage(String(args.url));
                      toolResult = text;
                      event = {
                        type: "action",
                        tool: "fetch_page",
                        input: args,
                        ok: true,
                        result: `${text.length} chars extraídos`,
                      };
                    } else if (call.function.name === "screenshot") {
                      const sUrl = screenshotUrl(String(args.url));
                      toolResult = `Screenshot disponível em ${sUrl}`;
                      event = {
                        type: "action",
                        tool: "screenshot",
                        input: args,
                        ok: true,
                        screenshotUrl: sUrl,
                        result: "captura gerada",
                      };
                    } else {
                      toolResult = `error: unknown tool ${call.function.name}`;
                      event = {
                        type: "action",
                        tool: call.function.name,
                        input: {},
                        ok: false,
                        error: "unknown tool",
                      };
                    }
                  } catch (e) {
                    toolResult = `error: ${(e as Error).message}`;
                    event = {
                      type: "action",
                      tool: call.function.name,
                      input: {},
                      ok: false,
                      error: (e as Error).message,
                    };
                  }
                  send(event);
                  messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: toolResult.slice(0, 8000),
                  });
                }
              }
              const cost = costUSD(getModel(body.model), totalIn, totalOut);
              send({
                type: "done",
                message: "(limite de passos atingido)",
                usage: { inputTokens: totalIn, outputTokens: totalOut, usd: cost.total },
              });
            } catch (e) {
              send({ type: "error", message: (e as Error).message });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache",
          },
        });
      },
    },
  },
});
