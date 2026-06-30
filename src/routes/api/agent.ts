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
  /** Hard USD cap per task. Default 0.10 (~R$ 0,50). */
  maxUsd?: number;
};

type LinkResult = { title: string; url: string; snippet?: string };

const MAX_STEPS = 12;
const MAX_FETCHES = 8;
const DEFAULT_MAX_USD = 0.1;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the web via DuckDuckGo. Returns up to 8 results (title, url, snippet).",
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
        "Fetch a URL and return its visible text (max ~6000 chars). Results are cached within this task — re-calling the same URL is free and instant.",
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
      name: "extract_structured",
      description:
        "Fetch a URL and extract structured JSON matching the provided fields. Use this instead of fetch_page when you know exactly which fields you need — saves tokens. Example fields: ['title','price','description'].",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          fields: { type: "array", items: { type: "string" } },
        },
        required: ["url", "fields"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "compare_pages",
      description:
        "Fetch multiple URLs in parallel and return a short summary of each. Use to compare products/articles quickly.",
      parameters: {
        type: "object",
        properties: {
          urls: { type: "array", items: { type: "string" }, maxItems: 5 },
        },
        required: ["urls"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "calculate",
      description:
        "Evaluate a numeric expression safely (e.g. '(1299*0.9)+150'). Use for any math instead of computing yourself.",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "screenshot",
      description: "Capture a screenshot of a public URL (thum.io).",
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
        "Open a URL in a new browser tab on the user's machine. Use when the user asks you to 'abrir', 'mostrar', 'tocar' (música → YouTube), or navegar até um site. Always prefer this over only describing a link.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full https URL to open." },
          reason: { type: "string" },
        },
        required: ["url"],
      },
    },
  },
];

const SYSTEM = `Você é Octopus Agent — um executor autônomo de tarefas web. O usuário é o chefe.

Ferramentas: web_search, fetch_page (com cache), extract_structured, compare_pages, calculate, screenshot, open_url.
Princípios:
- AJA, não só descreva. Se o chefe pede algo da web, USE web_search/fetch_page imediatamente.
- Se o pedido envolve abrir, mostrar, tocar, navegar, ouvir música, ver vídeo → SEMPRE chame open_url com a URL apropriada (YouTube para músicas/vídeos, site oficial, etc).
- Pedidos nativos viram equivalentes web: "abre o Chrome" → google.com; "toca X no Spotify" → https://open.spotify.com/search/X; música/clipe → https://www.youtube.com/results?search_query=...
- Reaproveite páginas já lidas (cache, custo zero).
- Prefira extract_structured/compare_pages a múltiplos fetch_page.
- Use calculate para qualquer conta.
- Cite as URLs usadas no final.
- Responda em Português (Brasil), conciso, com bullets.`;

const MEDIA_ACTION_RE =
  /\b(toca|toque|coloca|coloque|bota|bote|reproduz|reproduza|abre|abra|abrir|mostra|mostre)\b/i;
const MEDIA_TARGET_RE = /\b(m[uú]sica|som|faixa|v[ií]deo|clipe|youtube|yt|can[cç][aã]o)\b/i;
const GENERIC_OPEN_VIDEO_RE = /\b(abre|abra|abrir|mostra|mostre)\b.*\b(v[ií]deo|clipe|isso|ele)\b/i;


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

function decodeText(value: string): string {
  try {
    return stripHtml(JSON.parse(`"${value}"`));
  } catch {
    return stripHtml(value.replace(/\\u0026/g, "&").replace(/\\"/g, '"'));
  }
}

function cleanMediaQuery(text: string): string {
  return text
    .replace(/\b(octopus|chefe|por favor|pfv|please)\b/gi, " ")
    .replace(/\b(toca|toque|coloca|coloque|bota|bote|reproduz|reproduza|abre|abra|abrir|mostra|mostre|procura|procure|pesquisa|pesquise)\b/gi, " ")
    .replace(/\b(a|o|um|uma|essa|esse|isso|ele|ela|v[ií]deo|clipe|m[uú]sica|som|faixa|youtube|yt|pra mim|para mim|agora)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMediaRequest(text: string): boolean {
  return MEDIA_ACTION_RE.test(text) && (MEDIA_TARGET_RE.test(text) || /\b(toca|toque|coloca|coloque|bota|bote|reproduz|reproduza)\b/i.test(text));
}

function resolveMediaQuery(messages: Body["messages"]): string | null {
  const userMessages = messages.filter((m) => m.role === "user" && m.content.trim());
  const latest = userMessages.at(-1)?.content ?? "";
  const latestQuery = cleanMediaQuery(latest);

  if (isMediaRequest(latest) && latestQuery.length >= 3 && !GENERIC_OPEN_VIDEO_RE.test(latest)) {
    return latestQuery;
  }

  if (GENERIC_OPEN_VIDEO_RE.test(latest) || /\b(abre|abra|abrir)\b/i.test(latest)) {
    for (let i = userMessages.length - 2; i >= 0; i--) {
      const previous = userMessages[i].content;
      const previousQuery = cleanMediaQuery(previous);
      if (isMediaRequest(previous) && previousQuery.length >= 3) return previousQuery;
    }
  }

  return null;
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

async function youtubeSearch(query: string): Promise<LinkResult[]> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`YouTube ${res.status}`);
  const html = await res.text();
  const results: LinkResult[] = [];
  const seen = new Set<string>();
  const re = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null && results.length < 6) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const chunk = html.slice(match.index, match.index + 5000);
    const titleMatch = chunk.match(/"title":\{"runs":\[\{"text":"([\s\S]*?)"\}\]/) ??
      chunk.match(/"title":\{"simpleText":"([\s\S]*?)"\}/);
    const channelMatch = chunk.match(/"ownerText":\{"runs":\[\{"text":"([\s\S]*?)"/) ??
      chunk.match(/"shortBylineText":\{"runs":\[\{"text":"([\s\S]*?)"/);
    const title = titleMatch ? decodeText(titleMatch[1]) : `Vídeo do YouTube ${id}`;
    const channel = channelMatch ? decodeText(channelMatch[1]) : "YouTube";

    results.push({
      title,
      url: `https://www.youtube.com/watch?v=${id}`,
      snippet: channel,
    });
  }

  if (results.length > 0) return results;
  return ddgSearch(`site:youtube.com/watch ${query}`);
}

function ndjsonResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

async function fetchPageRaw(url: string): Promise<string> {
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
  const clean = url.replace(/^https?:\/\//, "");
  return `https://image.thum.io/get/width/1024/crop/768/https://${clean}`;
}

/** Safe arithmetic evaluator: digits, ops, parens, decimal, spaces. */
function safeCalc(expr: string): number {
  if (!/^[\d+\-*/().,\s%]+$/.test(expr)) throw new Error("Expressão inválida");
  const clean = expr.replace(/,/g, ".").replace(/%/g, "/100");
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${clean})`)();
  if (typeof v !== "number" || !isFinite(v)) throw new Error("Resultado inválido");
  return v;
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
        const maxUsd = body.maxUsd ?? DEFAULT_MAX_USD;

        const directMediaQuery = resolveMediaQuery(body.messages);
        if (directMediaQuery) {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              const send = (obj: unknown) =>
                controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
              try {
                send({ type: "limits", maxUsd, maxSteps: MAX_STEPS, maxFetches: MAX_FETCHES });
                const links = await youtubeSearch(directMediaQuery);
                send({
                  type: "action",
                  tool: "web_search",
                  input: { query: `YouTube ${directMediaQuery}` },
                  ok: true,
                  result: `${links.length} vídeos encontrados`,
                  links,
                });

                const best = links[0] ?? {
                  title: `Busca no YouTube: ${directMediaQuery}`,
                  url: `https://www.youtube.com/results?search_query=${encodeURIComponent(directMediaQuery)}`,
                  snippet: "Resultados do YouTube",
                };

                send({
                  type: "action",
                  tool: "open_url",
                  input: { url: best.url, reason: best.title },
                  ok: true,
                  openedUrl: best.url,
                  result: best.title,
                });
                send({
                  type: "done",
                  message: `Pronto, chefe — abri no YouTube: ${best.title}\n${best.url}`,
                  usage: { inputTokens: 0, outputTokens: 0, usd: 0 },
                });
              } catch (e) {
                send({ type: "error", message: (e as Error).message });
              } finally {
                controller.close();
              }
            },
          });

          return ndjsonResponse(stream);
        }

        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM },
          ...body.messages.map((m) => ({ role: m.role, content: m.content })),
        ];

        // Per-task memory: URL -> extracted text
        const pageCache = new Map<string, string>();
        let fetchCount = 0;

        const getPage = async (url: string) => {
          const cached = pageCache.get(url);
          if (cached !== undefined) return { text: cached, cached: true };
          if (fetchCount >= MAX_FETCHES) {
            throw new Error(`Limite de ${MAX_FETCHES} downloads por tarefa atingido`);
          }
          fetchCount++;
          const text = await fetchPageRaw(url);
          pageCache.set(url, text);
          return { text, cached: false };
        };

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) =>
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            let totalIn = 0;
            let totalOut = 0;
            try {
              send({ type: "limits", maxUsd, maxSteps: MAX_STEPS, maxFetches: MAX_FETCHES });

              for (let step = 0; step < MAX_STEPS; step++) {
                // Cost cap check
                const running = costUSD(getModel(body.model), totalIn, totalOut).total;
                if (running >= maxUsd) {
                  send({
                    type: "done",
                    message: `(limite de custo atingido: $${running.toFixed(4)} ≥ $${maxUsd.toFixed(4)})`,
                    usage: { inputTokens: totalIn, outputTokens: totalOut, usd: running },
                  });
                  controller.close();
                  return;
                }

                send({ type: "step", step, usd: running });
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
                    usage: {
                      inputTokens: totalIn,
                      outputTokens: totalOut,
                      usd: cost.total,
                    },
                  });
                  controller.close();
                  return;
                }

                for (const call of msg.tool_calls) {
                  let toolResult = "";
                  let event: Record<string, unknown> = {};
                  try {
                    const args = JSON.parse(call.function.arguments);
                    const name = call.function.name;

                    if (name === "web_search") {
                      const links = await ddgSearch(String(args.query));
                      toolResult = JSON.stringify(links);
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        result: `${links.length} resultados`,
                        links,
                      };
                    } else if (name === "fetch_page") {
                      const { text, cached } = await getPage(String(args.url));
                      toolResult = text;
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        cached,
                        result: cached
                          ? `cache (${text.length} chars)`
                          : `${text.length} chars extraídos`,
                      };
                    } else if (name === "extract_structured") {
                      const { text, cached } = await getPage(String(args.url));
                      const fields = Array.isArray(args.fields) ? args.fields : [];
                      toolResult = JSON.stringify({
                        url: args.url,
                        fields,
                        page_text: text,
                        instructions:
                          "Extraia os campos solicitados a partir de page_text e devolva como JSON.",
                      });
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        cached,
                        result: `campos: ${fields.join(", ")}`,
                      };
                    } else if (name === "compare_pages") {
                      const urls = (args.urls as string[]).slice(0, 5);
                      const settled = await Promise.allSettled(urls.map(getPage));
                      const summary = urls.map((u, i) => {
                        const r = settled[i];
                        if (r.status === "fulfilled") {
                          return {
                            url: u,
                            cached: r.value.cached,
                            text: r.value.text.slice(0, 1500),
                          };
                        }
                        return { url: u, error: String(r.reason) };
                      });
                      toolResult = JSON.stringify(summary);
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        result: `${urls.length} páginas comparadas`,
                      };
                    } else if (name === "calculate") {
                      const v = safeCalc(String(args.expression));
                      toolResult = String(v);
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        result: `= ${v}`,
                      };
                    } else if (name === "screenshot") {
                      const sUrl = screenshotUrl(String(args.url));
                      toolResult = `Screenshot disponível em ${sUrl}`;
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        screenshotUrl: sUrl,
                        result: "captura gerada",
                      };
                    } else if (name === "open_url") {
                      const u = String(args.url);
                      toolResult = `Aba aberta: ${u}`;
                      event = {
                        type: "action",
                        tool: name,
                        input: args,
                        ok: true,
                        openedUrl: u,
                        result: args.reason ? String(args.reason) : "aba aberta",
                      };
                    } else {
                      toolResult = `error: unknown tool ${name}`;
                      event = {
                        type: "action",
                        tool: name,
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
                usage: {
                  inputTokens: totalIn,
                  outputTokens: totalOut,
                  usd: cost.total,
                },
              });
            } catch (e) {
              send({ type: "error", message: (e as Error).message });
            } finally {
              controller.close();
            }
          },
        });

        return ndjsonResponse(stream);
      },
    },
  },
});
