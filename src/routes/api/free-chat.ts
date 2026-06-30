import { createFileRoute } from "@tanstack/react-router";
import { PERSONA_SYSTEM_VOICE } from "@/lib/persona";

type Msg = { role: "system" | "user" | "assistant"; content: string };
type Body = { messages: Msg[] };

export const Route = createFileRoute("/api/free-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("LOVABLE_API_KEY ausente no servidor", { status: 500 });
        }

        const body = (await request.json()) as Body;
        const messages: Msg[] = [
          { role: "system", content: PERSONA_SYSTEM_VOICE },
          ...body.messages.filter((m) => m.role !== "system"),
        ];

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages,
          }),
        });

        if (!upstream.ok) {
          const text = await upstream.text();
          return new Response(text || "Falha no Lovable AI", { status: upstream.status });
        }

        const data = await upstream.json();
        const reply: string = data?.choices?.[0]?.message?.content ?? "";
        return Response.json({ reply });
      },
    },
  },
});
