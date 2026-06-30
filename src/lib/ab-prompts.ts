// Octopus A/B prompts — Phase 6.
// Tests system-prompt variants against each other using the same
// telemetry that powers IQ (satisfaction + self-score). Epsilon-greedy
// exploration: 20% random, 80% pick current best.

import { allMetrics, type Intent } from "@/lib/metrics";

export type PromptVariant = {
  id: string;
  label: string;
  // appended to PERSONA_SYSTEM on the server
  suffix: string;
};

export const VARIANTS: PromptVariant[] = [
  {
    id: "v0_baseline",
    label: "Baseline",
    suffix: "",
  },
  {
    id: "v1_concise",
    label: "Conciso",
    suffix:
      " Responda de forma direta e enxuta: vá ao ponto na primeira frase, evite preâmbulos como 'Claro!' e só expanda se o chefe pedir detalhe.",
  },
  {
    id: "v2_structured",
    label: "Estruturado",
    suffix:
      " Quando a resposta tiver múltiplos pontos, use bullets curtos em markdown. Comece com a resposta direta, depois detalhes em lista. Inclua exemplos práticos quando ajudar.",
  },
  {
    id: "v3_socratic",
    label: "Socrático",
    suffix:
      " Antes de responder algo complexo, confirme em 1 linha o que o chefe quer. Depois entregue a resposta. Se houver ambiguidade real, faça 1 pergunta curta.",
  },
];

const EPSILON = 0.2; // 20% exploration

export function getVariantById(id?: string): PromptVariant {
  return VARIANTS.find((v) => v.id === id) ?? VARIANTS[0];
}

export type VariantStat = {
  id: string;
  label: string;
  count: number;
  satisfaction: number; // 0..1
  avgSelfScore: number; // 0..1
  avgLatencyMs: number;
  avgCostBRL: number;
  score: number; // composite
};

export function computeVariantStats(intent?: Intent): VariantStat[] {
  const items = allMetrics().filter((m) => m.variant && (!intent || m.intent === intent));
  return VARIANTS.map((v) => {
    const sub = items.filter((m) => m.variant === v.id);
    const n = sub.length;
    const votes = sub.filter((m) => m.thumb);
    const sat = votes.length
      ? votes.filter((m) => m.thumb === 1).length / votes.length
      : 0.5;
    const scored = sub.filter((m) => typeof m.selfScore === "number");
    const self = scored.length
      ? scored.reduce((s, m) => s + (m.selfScore ?? 0), 0) / scored.length
      : 0.5;
    const lat = n ? sub.reduce((s, m) => s + m.latencyMs, 0) / n : 0;
    const cost = n ? sub.reduce((s, m) => s + m.costBRL, 0) / n : 0;
    const score = 0.6 * sat + 0.4 * self;
    return {
      id: v.id,
      label: v.label,
      count: n,
      satisfaction: sat,
      avgSelfScore: self,
      avgLatencyMs: lat,
      avgCostBRL: cost,
      score,
    };
  });
}

const MIN_SAMPLES = 3;

export function pickVariant(intent: Intent): PromptVariant {
  // Explore
  if (Math.random() < EPSILON) {
    return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
  }
  const stats = computeVariantStats(intent);
  // Need enough samples on at least one variant to "exploit"
  const mature = stats.filter((s) => s.count >= MIN_SAMPLES);
  if (mature.length === 0) {
    // Round-robin to fill cells
    const counts = stats.map((s) => s.count);
    const minIdx = counts.indexOf(Math.min(...counts));
    return VARIANTS[minIdx] ?? VARIANTS[0];
  }
  const best = mature.reduce((a, b) => (b.score > a.score ? b : a));
  return getVariantById(best.id);
}
