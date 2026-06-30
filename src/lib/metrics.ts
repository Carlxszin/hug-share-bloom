// Octopus telemetry — 100% client-side (localStorage), zero backend.
// Foundation for adaptive routing, self-critique scoring, and the IQ dashboard.

import { useSyncExternalStore } from "react";

export type Intent =
  | "chat"
  | "code"
  | "search"
  | "image"
  | "calc"
  | "voice"
  | "agent"
  | "builder";

export type TurnMetric = {
  id: string;
  ts: number;
  intent: Intent;
  model: string;
  mode: "paid" | "free" | "voice";
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUSD: number;
  costBRL: number;
  toolCalls: { name: string; ok: boolean }[];
  retryCount: number;
  truncated: boolean;
  thumb?: 1 | -1;
  selfScore?: number; // 0..1
  cacheHit?: boolean;
  variant?: string; // A/B prompt variant id
};

const KEY = "octopus:metrics:v1";
const MAX = 500; // rolling window

function read(): TurnMetric[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TurnMetric[]) : [];
  } catch {
    return [];
  }
}

function write(items: TurnMetric[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX)));
  } catch {
    /* quota — silently drop */
  }
}

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function logTurn(t: Omit<TurnMetric, "id" | "ts"> & { id?: string; ts?: number }): string {
  const item: TurnMetric = {
    id: t.id ?? crypto.randomUUID(),
    ts: t.ts ?? Date.now(),
    ...t,
  };
  const all = [...read(), item];
  write(all);
  emit();
  return item.id;
}

export function patchTurn(id: string, patch: Partial<TurnMetric>) {
  const all = read().map((m) => (m.id === id ? { ...m, ...patch } : m));
  write(all);
  emit();
}

export function clearMetrics() {
  write([]);
  emit();
}

export function allMetrics(): TurnMetric[] {
  return read();
}

export function detectIntent(text: string, mode?: TurnMetric["mode"]): Intent {
  const t = text.toLowerCase();
  if (mode === "voice") return "voice";
  if (/(```|função|function|classe|class\s|def |const |let |bug|erro|stack|typescript|react|sql)/.test(t)) return "code";
  if (/(gera|cria|desenha|gere|gerar).{0,30}(imagem|foto|figura|logo|ilustra)/.test(t) || /^\/img/i.test(text)) return "image";
  if (/(pesquisa|busca|procura|search|google|youtube|abre|abrir)/.test(t)) return "search";
  if (/(calcula|quanto é|raiz|integral|equaç|derivada|\d+\s*[+\-*/x]\s*\d+)/.test(t)) return "calc";
  return "chat";
}

// ---- aggregation ----
export type Rollup = {
  count: number;
  thumbsUp: number;
  thumbsDown: number;
  satisfaction: number; // 0..1 (defaults 0.5 if no votes)
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgCostBRL: number;
  totalCostBRL: number;
  toolUseRate: number;
  toolSuccessRate: number;
  avgSelfScore: number;
  cacheHitRate: number;
  byIntent: Record<Intent, { count: number; avgCostBRL: number; avgLatencyMs: number; satisfaction: number }>;
  byModel: Record<string, { count: number; avgCostBRL: number; satisfaction: number; avgSelfScore: number }>;
  iq: number; // 0..100 composite
};

const EMPTY_ROLLUP: Rollup = {
  count: 0,
  thumbsUp: 0,
  thumbsDown: 0,
  satisfaction: 0.5,
  avgLatencyMs: 0,
  p95LatencyMs: 0,
  avgCostBRL: 0,
  totalCostBRL: 0,
  toolUseRate: 0,
  toolSuccessRate: 0,
  avgSelfScore: 0,
  cacheHitRate: 0,
  byIntent: {} as Rollup["byIntent"],
  byModel: {},
  iq: 0,
};

export function computeRollup(items = read()): Rollup {
  if (items.length === 0) return EMPTY_ROLLUP;
  const lat = items.map((m) => m.latencyMs).sort((a, b) => a - b);
  const p95 = lat[Math.floor(lat.length * 0.95)] ?? lat[lat.length - 1] ?? 0;
  const up = items.filter((m) => m.thumb === 1).length;
  const down = items.filter((m) => m.thumb === -1).length;
  const votes = up + down;
  const satisfaction = votes > 0 ? up / votes : 0.5;
  const totalCostBRL = items.reduce((s, m) => s + m.costBRL, 0);
  const toolTurns = items.filter((m) => m.toolCalls.length > 0);
  const allTools = items.flatMap((m) => m.toolCalls);
  const toolOk = allTools.filter((t) => t.ok).length;
  const scored = items.filter((m) => typeof m.selfScore === "number");
  const avgSelfScore = scored.length ? scored.reduce((s, m) => s + (m.selfScore ?? 0), 0) / scored.length : 0;
  const cache = items.filter((m) => m.cacheHit).length;

  const byIntent = {} as Rollup["byIntent"];
  const byModel: Rollup["byModel"] = {};
  for (const m of items) {
    const i = (byIntent[m.intent] ??= { count: 0, avgCostBRL: 0, avgLatencyMs: 0, satisfaction: 0.5 });
    i.count++;
    i.avgCostBRL += m.costBRL;
    i.avgLatencyMs += m.latencyMs;
    const mm = (byModel[m.model] ??= { count: 0, avgCostBRL: 0, satisfaction: 0.5, avgSelfScore: 0 });
    mm.count++;
    mm.avgCostBRL += m.costBRL;
    mm.avgSelfScore += m.selfScore ?? 0;
  }
  for (const k of Object.keys(byIntent) as Intent[]) {
    const x = byIntent[k];
    x.avgCostBRL /= x.count;
    x.avgLatencyMs /= x.count;
    const sub = items.filter((m) => m.intent === k && m.thumb);
    const upI = sub.filter((m) => m.thumb === 1).length;
    x.satisfaction = sub.length ? upI / sub.length : 0.5;
  }
  for (const k of Object.keys(byModel)) {
    const x = byModel[k];
    x.avgCostBRL /= x.count;
    x.avgSelfScore /= x.count;
    const sub = items.filter((m) => m.model === k && m.thumb);
    const upM = sub.filter((m) => m.thumb === 1).length;
    x.satisfaction = sub.length ? upM / sub.length : 0.5;
  }

  const avgLatency = lat.reduce((s, n) => s + n, 0) / lat.length;
  const latNorm = Math.min(1, avgLatency / 8000); // 8s = pior
  const avgCost = totalCostBRL / items.length;
  const costNorm = Math.min(1, avgCost / 0.1); // R$0,10 = pior
  const toolSuccess = allTools.length ? toolOk / allTools.length : 1;
  const toolUseRate = items.length ? toolTurns.length / items.length : 0;
  const iq = Math.round(
    100 *
      (0.4 * satisfaction +
        0.2 * (1 - latNorm) +
        0.2 * (1 - costNorm) +
        0.1 * toolSuccess +
        0.1 * (cache / items.length)),
  );

  return {
    count: items.length,
    thumbsUp: up,
    thumbsDown: down,
    satisfaction,
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95,
    avgCostBRL: avgCost,
    totalCostBRL,
    toolUseRate,
    toolSuccessRate: toolSuccess,
    avgSelfScore,
    cacheHitRate: items.length ? cache / items.length : 0,
    byIntent,
    byModel,
    iq: Math.max(0, Math.min(100, iq)),
  };
}

// ---- React hook ----
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useMetrics(): { items: TurnMetric[]; rollup: Rollup } {
  const items = useSyncExternalStore(
    subscribe,
    () => {
      // Cache by ref — read() returns a new array each time which would loop.
      const raw = typeof window === "undefined" ? "[]" : localStorage.getItem(KEY) ?? "[]";
      return raw;
    },
    () => "[]",
  );
  const parsed: TurnMetric[] = JSON.parse(items);
  return { items: parsed, rollup: computeRollup(parsed) };
}
