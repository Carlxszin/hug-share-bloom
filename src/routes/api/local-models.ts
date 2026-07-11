import { createFileRoute } from "@tanstack/react-router";

// Lists models installed on the local Ollama instance.
export const Route = createFileRoute("/api/local-models")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const r = await fetch("http://localhost:11434/api/tags");
          if (!r.ok) return Response.json({ up: false, models: [] });
          const j = (await r.json()) as { models?: { name: string; size?: number }[] };
          return Response.json({
            up: true,
            models: (j.models ?? []).map((m) => ({ name: m.name, size: m.size ?? 0 })),
          });
        } catch {
          return Response.json({ up: false, models: [] });
        }
      },
    },
  },
});
