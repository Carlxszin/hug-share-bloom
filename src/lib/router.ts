// Octopus Adaptive Router — picks the best model per intent using telemetry.
// Falls back to sensible defaults when there is no data yet.

import { allMetrics, type Intent } from "@/lib/metrics";
import { MODELS, getModel } from "@/lib/models";

export const AUTO_MODEL_ID = "auto";

// Defaults per intent — chosen for cost/quality balance until metrics override.
const DEFAULT_BY_INTENT: Record<Intent, string> = {
  chat: "gpt-5-mini",
  code: "gpt-5",
  search: "gpt-5-mini",
  calc: "gpt-5-mini",
  image: "gpt-5-nano", // image gen routes elsewhere; this is for ack text
  voice: "gpt-5-mini",
  agent: "gpt-5",
  builder: "gpt-5",
};

const MIN_SAMPLES = 4; // need at least this many to trust a model for an intent

export type RouteDecision = {
  model: string;
  reason: "default" | "learned" | "explicit";
  score?: number;
};

export function pickModel(intent: Intent, requested: string): RouteDecision {
  if (requested && requested !== AUTO_MODEL_ID) {
    return { model: requested, reason: "explicit" };
  }

  const items = allMetrics().filter((m) => m.intent === intent && m.mode === "paid");
  const byModel = new Map<string, { n: number; sat: number; selfScore: number; cost: number; lat: number }>();
  for (const m of items) {
    const cur = byModel.get(m.model) ?? { n: 0, sat: 0, selfScore: 0, cost: 0, lat: 0 };
    cur.n++;
    cur.sat += m.thumb === 1 ? 1 : m.thumb === -1 ? 0 : 0.5;
    cur.selfScore += m.selfScore ?? 0.5;
    cur.cost += m.costBRL;
    cur.lat += m.latencyMs;
    byModel.set(m.model, cur);
  }

  let best: { id: string; score: number } | null = null;
  for (const [id, v] of byModel) {
    if (v.n < MIN_SAMPLES) continue;
    if (!MODELS.find((mm) => mm.id === id)) continue;
    const sat = v.sat / v.n;
    const self = v.selfScore / v.n;
    const avgCost = v.cost / v.n;
    const avgLat = v.lat / v.n;
    // composite: quality dominates, cost & latency penalize.
    const score =
      0.5 * sat +
      0.3 * self +
      0.1 * (1 - Math.min(1, avgCost / 0.1)) +
      0.1 * (1 - Math.min(1, avgLat / 8000));
    if (!best || score > best.score) best = { id, score };
  }

  if (best) return { model: best.id, reason: "learned", score: best.score };
  return { model: DEFAULT_BY_INTENT[intent] ?? "gpt-5-mini", reason: "default" };
}

export function resolveModel(requested: string, intent: Intent): { id: string; decision: RouteDecision } {
  const decision = pickModel(intent, requested);
  // Guarantee a known model id
  const safe = getModel(decision.model).id;
  return { id: safe, decision };
}
