import { createFileRoute } from "@tanstack/react-router";

type Video = { id: string; title: string; channel?: string; url: string };

async function youtubeSearch(query: string): Promise<Video[]> {
  const res = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=pt-BR`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Octopus/1.0; +https://lovable.dev)",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
    },
  );
  if (!res.ok) throw new Error(`YT ${res.status}`);
  const html = await res.text();
  // Parse ytInitialData JSON blob
  const m = html.match(/var ytInitialData = (\{[\s\S]+?\});<\/script>/);
  const out: Video[] = [];
  const seen = new Set<string>();
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const stack: unknown[] = [data];
      while (stack.length && out.length < 5) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        const obj = node as Record<string, unknown>;
        if (typeof obj.videoId === "string" && obj.title) {
          const id = obj.videoId;
          const title =
            (obj.title as { runs?: { text: string }[]; simpleText?: string })?.runs?.[0]?.text ??
            (obj.title as { simpleText?: string })?.simpleText;
          const channel = (obj.ownerText as { runs?: { text: string }[] })?.runs?.[0]?.text;
          if (id && title && !seen.has(id)) {
            seen.add(id);
            out.push({ id, title, channel, url: `https://www.youtube.com/watch?v=${id}` });
          }
        }
        for (const k in obj) stack.push(obj[k]);
      }
    } catch {
      /* ignore */
    }
  }
  if (out.length === 0) {
    // Regex fallback
    const re = /"videoId":"([\w-]{11})"[\s\S]{0,200}?"text":"([^"]+)"/g;
    let r: RegExpExecArray | null;
    while ((r = re.exec(html)) && out.length < 5) {
      const id = r[1];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ id, title: r[2], url: `https://www.youtube.com/watch?v=${id}` });
    }
  }
  return out;
}

export const Route = createFileRoute("/api/find-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { query } = (await request.json()) as { query?: string };
          if (!query) return new Response("query obrigatória", { status: 400 });
          const videos = await youtubeSearch(query);
          return Response.json({ query, videos });
        } catch (e) {
          return new Response((e as Error).message, { status: 500 });
        }
      },
    },
  },
});
