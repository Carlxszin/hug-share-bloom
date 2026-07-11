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
  {
    id: "local/llama3.1",
    label: "Llama 3.1 (Local)",
    description: "100% grátis, roda no seu PC via Ollama.",
    inputPer1M: 0,
    outputPer1M: 0,
    contextK: 128,
    speed: "Rápido",
    reasoning: "Avançado",
  },
  {
    id: "local/qwen2.5",
    label: "Qwen 2.5 (Local)",
    description: "Alternativa local rápida via Ollama.",
    inputPer1M: 0,
    outputPer1M: 0,
    contextK: 128,
    speed: "Rápido",
    reasoning: "Avançado",
  },
];

export const DEFAULT_MODEL = "gpt-5-mini";

// Realtime voice model pricing (USD per 1M tokens)
// Usando o "mini" por padrão: ~70% mais barato que o gpt-realtime full.
export const REALTIME_MODEL = "gpt-realtime-mini";
export const REALTIME_PRICING = {
  textIn: 0.6,
  textOut: 2.4,
  audioIn: 10,
  audioOut: 20,
};

// Whisper transcription (USD per minute)
export const WHISPER_MODEL = "whisper-1";
export const WHISPER_PRICE_PER_MIN = 0.006;

export function getModel(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function costUSD(model: ModelInfo, inputTokens: number, outputTokens: number) {
  const input = (inputTokens / 1_000_000) * model.inputPer1M;
  const output = (outputTokens / 1_000_000) * model.outputPer1M;
  return { input, output, total: input + output };
}

export function realtimeCostUSD(usage: {
  textIn?: number;
  textOut?: number;
  audioIn?: number;
  audioOut?: number;
}) {
  const ti = ((usage.textIn ?? 0) / 1_000_000) * REALTIME_PRICING.textIn;
  const to = ((usage.textOut ?? 0) / 1_000_000) * REALTIME_PRICING.textOut;
  const ai = ((usage.audioIn ?? 0) / 1_000_000) * REALTIME_PRICING.audioIn;
  const ao = ((usage.audioOut ?? 0) / 1_000_000) * REALTIME_PRICING.audioOut;
  return { textIn: ti, textOut: to, audioIn: ai, audioOut: ao, total: ti + to + ai + ao };
}
