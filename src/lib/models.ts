// Pricing in USD per 1M tokens. Update as OpenAI publishes new prices.
export type ModelInfo = {
  id: string;
  label: string;
  description: string;
  inputPer1M: number;
  outputPer1M: number;
  contextK: number;
  speed: "Rápido" | "Equilibrado" | "Profundo";
  reasoning: "Básico" | "Avançado" | "Especialista";
};

export const MODELS: ModelInfo[] = [
  {
    id: "gpt-5",
    label: "GPT-5",
    description: "Raciocínio avançado, melhor qualidade.",
    inputPer1M: 1.25,
    outputPer1M: 10,
    contextK: 400,
    speed: "Equilibrado",
    reasoning: "Especialista",
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 Mini",
    description: "Ótimo custo-benefício para uso diário.",
    inputPer1M: 0.25,
    outputPer1M: 2,
    contextK: 400,
    speed: "Rápido",
    reasoning: "Avançado",
  },
  {
    id: "gpt-5-nano",
    label: "GPT-5 Nano",
    description: "Ultra-rápido e barato para alto volume.",
    inputPer1M: 0.05,
    outputPer1M: 0.4,
    contextK: 200,
    speed: "Rápido",
    reasoning: "Básico",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    description: "Multimodal clássico, amplamente compatível.",
    inputPer1M: 2.5,
    outputPer1M: 10,
    contextK: 128,
    speed: "Equilibrado",
    reasoning: "Avançado",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o Mini",
    description: "Versão econômica do 4o.",
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    contextK: 128,
    speed: "Rápido",
    reasoning: "Básico",
  },
];

export const DEFAULT_MODEL = "gpt-5-mini";

export function getModel(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function costUSD(model: ModelInfo, inputTokens: number, outputTokens: number) {
  const input = (inputTokens / 1_000_000) * model.inputPer1M;
  const output = (outputTokens / 1_000_000) * model.outputPer1M;
  return { input, output, total: input + output };
}
