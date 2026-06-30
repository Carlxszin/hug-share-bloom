import { DEFAULT_MODEL } from "./models";

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: number;
};

export type Conversation = {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

const KEY = "lovable-chat:conversations:v1";
const COST_KEY = "lovable-chat:costs:v1";

export type CostLog = {
  date: string; // YYYY-MM-DD
  usd: number;
  inputTokens: number;
  outputTokens: number;
};

export function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function newConversation(model = DEFAULT_MODEL): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "Nova conversa",
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function loadCosts(): CostLog[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(COST_KEY) ?? "[]") as CostLog[];
  } catch {
    return [];
  }
}

export function logCost(entry: { usd: number; inputTokens: number; outputTokens: number }) {
  if (typeof window === "undefined") return;
  const date = new Date().toISOString().slice(0, 10);
  const list = loadCosts();
  const existing = list.find((l) => l.date === date);
  if (existing) {
    existing.usd += entry.usd;
    existing.inputTokens += entry.inputTokens;
    existing.outputTokens += entry.outputTokens;
  } else {
    list.push({ date, ...entry });
  }
  localStorage.setItem(COST_KEY, JSON.stringify(list));
}

export function totalsByPeriod() {
  const list = loadCosts();
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const day = list.filter((l) => l.date === today).reduce((s, l) => s + l.usd, 0);
  const mo = list.filter((l) => l.date.startsWith(month)).reduce((s, l) => s + l.usd, 0);
  return { day, month: mo };
}
