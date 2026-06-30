import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams image generation from Lovable AI Gateway.
 * Default model: openai/gpt-image-2 (state-of-the-art).
 * Response: SSE passthrough — client renders each `image_generation.partial_image`
 * (with blur) and the final `image_generation.completed`.
 */
export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("LOVABLE_API_KEY ausente", { status: 500 });

        const { prompt, model, size, quality } = (await request.json()) as {
          prompt: string;
          model?: string;
          size?: string;
          quality?: string;
        };
        if (!prompt || typeof prompt !== "string") {
          return new Response("prompt obrigatório", { status: 400 });
        }

        const chosen = model || "openai/gpt-image-2";
        const isGemini = chosen.startsWith("google/");

        const body = isGemini
          ? {
              model: chosen,
              messages: [{ role: "user", content: prompt }],
              modalities: ["image", "text"],
              stream: true,
            }
          : {
              model: chosen,
              prompt,
              size: size || "1024x1024",
              quality: quality || "low",
              n: 1,
              stream: true,
              partial_images: 2,
            };

        const upstream = await fetch(
          "https://ai.gateway.lovable.dev/v1/images/generations",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          },
        );

        if (!upstream.ok || !upstream.body) {
          const t = await upstream.text().catch(() => "");
          return new Response(t || "Falha na geração", { status: upstream.status });
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
