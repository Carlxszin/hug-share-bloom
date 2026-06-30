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
  files: Record<string, string>;
};

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create or fully replace a file in the workspace. Use only for new files or full rewrites. Prefer edit_file for changes.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, e.g. 'index.html', 'styles.css'." },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description:
        "Surgical edit: replace `old_string` with `new_string` in the given file. `old_string` MUST appear exactly once in the file. Prefer this over write_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file from the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

const SYSTEM = `You are Octopus Builder, an elite frontend engineer that builds and edits multi-file websites (HTML/CSS/JS) inside a virtual workspace.

WORKSPACE RULES:
- The current workspace files are injected below as a snapshot. Treat them as ground truth.
- Use \`edit_file\` for ANY change to an existing file — never rewrite a whole file just to tweak it.
- \`old_string\` in edit_file must be a unique, exact substring (include enough surrounding context to be unique).
- Use \`write_file\` only to CREATE a new file or when the change touches >70% of the file.
- The main entry MUST be \`index.html\`. CSS/JS in separate files (\`styles.css\`, \`script.js\`) when reasonable.
- Use modern, beautiful design by default: semantic HTML, responsive CSS, subtle animations.
- After all tool calls, reply with a SHORT summary (1-3 sentences) of what you changed.`;

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
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>;
}

function snapshot(files: Record<string, string>) {
  const entries = Object.entries(files);
  if (entries.length === 0) return "(workspace empty)";
  return entries
    .map(
      ([p, c]) =>
        `=== ${p} (${c.length} chars) ===\n${c.length > 4000 ? c.slice(0, 4000) + "\n…(truncated)" : c}`,
    )
    .join("\n\n");
}

export const Route = createFileRoute("/api/builder")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return new Response("OPENAI_API_KEY ausente", { status: 500 });

        const body = (await request.json()) as Body;
        if (!body?.model || !Array.isArray(body.messages)) {
          return new Response("Bad request", { status: 400 });
        }
        const KNOWN = new Set(["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4o", "gpt-4o-mini"]);
        if (!KNOWN.has(body.model)) body.model = "gpt-5-mini";

        const files: Record<string, string> = { ...(body.files ?? {}) };
        const sysWithSnapshot = `${SYSTEM}\n\n--- CURRENT WORKSPACE ---\n${snapshot(files)}`;
        const messages: ChatMessage[] = [
          { role: "system", content: sysWithSnapshot },
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
              for (let step = 0; step < 8; step++) {
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
                    files,
                    usage: { inputTokens: totalIn, outputTokens: totalOut, usd: cost.total },
                  });
                  controller.close();
                  return;
                }

                for (const call of msg.tool_calls) {
                  let result = "ok";
                  let event: Record<string, unknown> = {};
                  try {
                    const args = JSON.parse(call.function.arguments);
                    if (call.function.name === "write_file") {
                      const isNew = files[args.path] === undefined;
                      files[args.path] = args.content;
                      event = {
                        type: "action",
                        tool: "write",
                        path: args.path,
                        isNew,
                        preview: args.content.slice(0, 240),
                        size: args.content.length,
                      };
                    } else if (call.function.name === "edit_file") {
                      const cur = files[args.path];
                      if (cur === undefined) {
                        result = `error: file '${args.path}' not found`;
                        event = {
                          type: "action",
                          tool: "edit",
                          path: args.path,
                          ok: false,
                          error: "not found",
                        };
                      } else {
                        const occ = cur.split(args.old_string).length - 1;
                        if (occ !== 1) {
                          result =
                            occ === 0
                              ? "error: old_string not found in file"
                              : `error: old_string appears ${occ} times; make it unique`;
                          event = {
                            type: "action",
                            tool: "edit",
                            path: args.path,
                            ok: false,
                            error: occ === 0 ? "not found" : "ambiguous",
                          };
                        } else {
                          const idx = cur.indexOf(args.old_string);
                          const line =
                            idx >= 0 ? cur.slice(0, idx).split("\n").length : undefined;
                          files[args.path] = cur.replace(args.old_string, args.new_string);
                          event = {
                            type: "action",
                            tool: "edit",
                            path: args.path,
                            ok: true,
                            old: args.old_string,
                            new: args.new_string,
                            line,
                          };
                        }
                      }
                    } else if (call.function.name === "delete_file") {
                      delete files[args.path];
                      event = { type: "action", tool: "delete", path: args.path };
                    } else {
                      result = `error: unknown tool ${call.function.name}`;
                    }
                  } catch (e) {
                    result = `error: ${(e as Error).message}`;
                  }
                  send(event);
                  send({ type: "files", files });
                  messages.push({
                    role: "tool",
                    tool_call_id: call.id,
                    content: result,
                  });
                }
              }
              const cost = costUSD(getModel(body.model), totalIn, totalOut);
              send({
                type: "done",
                message: "",
                files,
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
