/**
 * Global image-generation queue.
 * - Multiple prompts can be enqueued; one runs at a time.
 * - Subscribers get realtime partial frames (blurred previews) + final image.
 * - User can keep chatting / talking; panel renders in the corner.
 */

import { useSyncExternalStore } from "react";

export type ImageJobStatus = "queued" | "running" | "done" | "error";

export type ImageJob = {
  id: string;
  prompt: string;
  status: ImageJobStatus;
  /** Latest data URL (partial preview or final). */
  dataUrl?: string;
  /** True once `image_generation.completed` arrived. */
  isFinal?: boolean;
  error?: string;
  createdAt: number;
  model: string;
};

type Listener = () => void;

const state = {
  jobs: [] as ImageJob[],
};

const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function getSnapshot() {
  return state.jobs;
}

function subscribe(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useImageQueue() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

let running = false;

export function enqueueImage(prompt: string, model = "openai/gpt-image-2") {
  const clean = prompt.trim();
  if (!clean) return null;
  const job: ImageJob = {
    id: crypto.randomUUID(),
    prompt: clean,
    status: "queued",
    createdAt: Date.now(),
    model,
  };
  state.jobs = [...state.jobs, job];
  emit();
  pump();
  return job.id;
}

export function removeImageJob(id: string) {
  state.jobs = state.jobs.filter((j) => j.id !== id);
  emit();
}

export function clearFinishedImageJobs() {
  state.jobs = state.jobs.filter((j) => j.status === "queued" || j.status === "running");
  emit();
}

function updateJob(id: string, patch: Partial<ImageJob>) {
  state.jobs = state.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  emit();
}

async function pump() {
  if (running) return;
  const next = state.jobs.find((j) => j.status === "queued");
  if (!next) return;
  running = true;
  updateJob(next.id, { status: "running" });
  try {
    await runJob(next);
  } catch (err) {
    updateJob(next.id, { status: "error", error: (err as Error).message });
  } finally {
    running = false;
    // Continue with next queued.
    if (state.jobs.some((j) => j.status === "queued")) pump();
  }
}

async function runJob(job: ImageJob) {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: job.prompt, model: job.model }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let sawCompleted = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evtBlock of events) {
      const lines = evtBlock.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      const data = dataLines.join("\n");
      if (!data || data === "[DONE]") continue;
      let payload: any;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (eventName === "error" || payload?.type === "error") {
        throw new Error(payload?.error?.message ?? "Erro na geração");
      }
      const type = eventName !== "message" ? eventName : payload?.type;
      if (
        (type === "image_generation.partial_image" ||
          type === "image_generation.completed") &&
        typeof payload?.b64_json === "string"
      ) {
        const isFinal = type === "image_generation.completed";
        updateJob(job.id, {
          dataUrl: `data:image/png;base64,${payload.b64_json}`,
          isFinal,
        });
        if (isFinal) sawCompleted = true;
      }
    }
  }
  if (!sawCompleted) throw new Error("Stream encerrado sem imagem final");
  updateJob(job.id, { status: "done", isFinal: true });
}

/** Detects "gera/cria/desenha uma imagem de X". Returns extracted subject or null. */
export function detectImagePrompt(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // explicit slash command
  if (/^\/img(?:agem)?\s+/i.test(t)) return t.replace(/^\/img(?:agem)?\s+/i, "").trim();
  // natural language PT/EN
  const re =
    /\b(?:gera(?:r)?|cria(?:r)?|desenh(?:a|e|ar)|fa(?:z|ç)a?|generate|draw|create|paint)\s+(?:uma?\s+|an?\s+)?(?:imagem|foto|figura|ilustra[cç][aã]o|desenho|picture|image|drawing|illustration)\s+(?:de|do|da|dos|das|com|sobre|of|with|about)\s+(.+)$/i;
  const m = t.match(re);
  if (m) return m[1].trim().replace(/[.!?]+$/, "");
  return null;
}
