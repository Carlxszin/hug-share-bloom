import { createFileRoute } from "@tanstack/react-router";

type Body = { input: string };

export const Route = createFileRoute("/api/embed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return new Response("OPENAI_API_KEY ausente", { status: 500 });
        const { input } = (await request.json()) as Body;
        if (!input) return new Response("input ausente", { status: 400 });

        const upstream = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: input.slice(0, 4000),
          }),
        });
        if (!upstream.ok) {
          return new Response(await upstream.text(), { status: upstream.status });
        }
        const data = await upstream.json();
        const embedding = data.data?.[0]?.embedding ?? [];
        return new Response(JSON.stringify({ embedding }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
