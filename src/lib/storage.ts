import { DEFAULT_MODEL } from "./models";

export type FileEdit = {
  tool: "write" | "edit" | "delete";
  path: string;
  ok?: boolean;
  error?: string;
  isNew?: boolean;
  old?: string;
  new?: string;
  line?: number;
  preview?: string;
  size?: number;
  ts: number;
};

export type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** USD cost spent on this single message turn. */
  costUSD?: number;
  createdAt: number;
  /** Builder-mode: list of files changed in this turn (for badge). */
  fileChanges?: { path: string; action: "write" | "edit" | "delete" }[];
  /** Builder-mode: full edit log with diffs for this turn. */
  edits?: FileEdit[];
  /** Agent-mode: list of executed steps. */
  agentSteps?: AgentStep[];
};

export type AgentTool =
  | "web_search"
  | "fetch_page"
  | "screenshot"
  | "extract_structured"
  | "compare_pages"
  | "calculate"
  | "open_url";

export type AgentStep = {
  id: string;
  tool: AgentTool;
  input: Record<string, unknown>;
  ok?: boolean;
  error?: string;
  result?: string;
  screenshotUrl?: string;
  openedUrl?: string;
  links?: { title: string; url: string; snippet?: string }[];
  cached?: boolean;
  ts: number;
};

export type ConversationKind = "chat" | "builder" | "agent";

export type Conversation = {
  id: string;
  title: string;
  model: string;
  kind: ConversationKind;
  messages: Message[];
  /** Builder-mode workspace: path → content. */
  files?: Record<string, string>;
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
    const list = JSON.parse(raw) as Conversation[];
    // Back-compat: legacy convos without `kind`
    return list.map((c) => ({ ...c, kind: c.kind ?? "chat" }));
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function newConversation(
  model = DEFAULT_MODEL,
  kind: ConversationKind = "chat",
): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: kind === "builder" ? "Novo site" : "Nova conversa",
    model,
    kind,
    messages: [],
    files: kind === "builder" ? {} : undefined,
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
