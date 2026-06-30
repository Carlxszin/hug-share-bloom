import { createFileRoute } from "@tanstack/react-router";

let cache: { rate: number; ts: number } | null = null;
const TTL = 60 * 60 * 1000; // 1h

export const Route = createFileRoute("/api/fx")({
  server: {
    handlers: {
      GET: async () => {
        if (cache && Date.now() - cache.ts < TTL) {
          return Response.json({ rate: cache.rate, cached: true });
        }
        try {
          const res = await fetch("https://open.er-api.com/v6/latest/USD");
          const data = (await res.json()) as { rates?: { BRL?: number } };
          const rate = data?.rates?.BRL ?? 5.4;
          cache = { rate, ts: Date.now() };
          return Response.json({ rate });
        } catch {
          return Response.json({ rate: 5.4, fallback: true });
        }
      },
    },
  },
});
