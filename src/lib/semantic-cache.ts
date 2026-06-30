// Octopus Semantic Cache — 100% client-side.
// Embeds prompts with OpenAI text-embedding-3-small (via /api/embed),
// stores {prompt, embedding, reply, model, ts} in localStorage.
// On new prompt: cosine similarity ≥ THRESHOLD → returns cached reply (zero cost).

// v2: invalidated after persona "chefe" was introduced — old cached replies
// without the persona were leaking back into greetings.
const KEY = "octopus:semcache:v2";
const MAX = 200;
const THRESHOLD = 0.93;
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type CacheEntry = {
  id: string;
  prompt: string;
  embedding: number[];
  reply: string;
  model: string;
  ts: number;
};

function read(): CacheEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as CacheEntry[]) : [];
    const fresh = all.filter((e) => Date.now() - e.ts < TTL_MS);
    return fresh;
  } catch {
    return [];
  }
}

function write(items: CacheEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX)));
  } catch {
    /* quota */
  }
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch("/api/embed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.embedding) ? (data.embedding as number[]) : null;
  } catch {
    return null;
  }
}

export type CacheHit = { entry: CacheEntry; similarity: number };

export async function findSimilar(prompt: string): Promise<{ hit: CacheHit | null; queryEmbedding: number[] | null }> {
  const all = read();
  const qEmb = await embedText(prompt);
  if (!qEmb) return { hit: null, queryEmbedding: null };
  let best: CacheHit | null = null;
  for (const e of all) {
    const sim = cosine(qEmb, e.embedding);
    if (sim >= THRESHOLD && (!best || sim > best.similarity)) {
      best = { entry: e, similarity: sim };
    }
  }
  return { hit: best, queryEmbedding: qEmb };
}

export function saveEntry(
  prompt: string,
  embedding: number[],
  reply: string,
  model: string,
) {
  if (!embedding || embedding.length === 0 || !reply) return;
  const entry: CacheEntry = {
    id: crypto.randomUUID(),
    prompt,
    embedding,
    reply,
    model,
    ts: Date.now(),
  };
  write([...read(), entry]);
}

export function clearSemanticCache() {
  write([]);
}

export function cacheSize(): number {
  return read().length;
}
