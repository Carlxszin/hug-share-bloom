// Detect optional local helper services running on the chefe's machine.
// All checks fail silently — services are OPTIONAL. Cached for 30s.

export type LocalService = {
  ollama: { up: boolean; models: string[] };
  whisper: { up: boolean };
  playwright: { up: boolean };
};

let cache: { data: LocalService; ts: number } | null = null;
const TTL = 30_000;

async function ping(url: string, ms = 800): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

export async function detectLocalServices(force = false): Promise<LocalService> {
  if (!force && cache && Date.now() - cache.ts < TTL) return cache.data;

  const [ollamaRes, whisperRes, pwRes] = await Promise.all([
    ping("http://localhost:11434/api/tags"),
    ping("http://localhost:7677/health"),
    ping("http://localhost:7676/health"),
  ]);

  let models: string[] = [];
  if (ollamaRes) {
    try {
      const j = (await ollamaRes.json()) as { models?: { name: string }[] };
      models = (j.models ?? []).map((m) => m.name);
    } catch {
      /* ignore */
    }
  }

  const data: LocalService = {
    ollama: { up: !!ollamaRes, models },
    whisper: { up: !!whisperRes },
    playwright: { up: !!pwRes },
  };
  cache = { data, ts: Date.now() };
  return data;
}
