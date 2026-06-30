import { createFileRoute } from "@tanstack/react-router";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 200) : "";
}

function extractHeadings(html: string) {
  const out: string[] = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 20) {
    const t = stripHtml(m[2]);
    if (t) out.push(t.slice(0, 120));
  }
  return out;
}

function extractFields(html: string) {
  const out: { tag: string; name?: string; id?: string; type?: string; placeholder?: string; label?: string }[] = [];
  const re = /<(input|textarea|select|button)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 30) {
    const attrs = m[2];
    const get = (n: string) => attrs.match(new RegExp(`${n}=["']([^"']+)["']`, "i"))?.[1];
    out.push({
      tag: m[1].toLowerCase(),
      name: get("name"),
      id: get("id"),
      type: get("type"),
      placeholder: get("placeholder"),
      label: get("aria-label"),
    });
  }
  return out;
}

export const Route = createFileRoute("/api/read-page")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { url } = (await request.json()) as { url?: string };
          if (!url) return new Response("url obrigatória", { status: 400 });
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (compatible; Octopus/1.0; +https://lovable.dev)",
              "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            },
          });
          if (!res.ok) return new Response(`fetch ${res.status}`, { status: 502 });
          const html = (await res.text()).slice(0, 400_000);
          const title = extractTitle(html);
          const headings = extractHeadings(html);
          const fields = extractFields(html);
          const text = stripHtml(html).slice(0, 4000);
          return Response.json({ url, title, headings, fields, text });
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
  },
});
