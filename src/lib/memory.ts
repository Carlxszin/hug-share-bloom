// Memória persistente do Octopus (localStorage).
// Guarda fatos/preferências do "chefe" e injeta no system prompt.

export type Memory = {
  id: string;
  text: string;
  kind: "fact" | "preference" | "note";
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
};

const KEY = "octopus:memories:v1";

export function loadMemories(): Memory[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Memory[];
  } catch {
    return [];
  }
}

export function saveMemories(list: Memory[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  try {
    window.dispatchEvent(new Event("octopus:memories"));
  } catch {
    /* noop */
  }
}

export function addMemory(text: string, kind: Memory["kind"] = "fact"): Memory {
  const clean = text.trim();
  const list = loadMemories();
  // dedupe by lowercase text
  const existing = list.find((m) => m.text.toLowerCase() === clean.toLowerCase());
  if (existing) {
    existing.updatedAt = Date.now();
    saveMemories(list);
    return existing;
  }
  const mem: Memory = {
    id: crypto.randomUUID(),
    text: clean,
    kind,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.unshift(mem);
  saveMemories(list.slice(0, 200));
  return mem;
}

export function updateMemory(id: string, patch: Partial<Memory>) {
  const list = loadMemories().map((m) =>
    m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m,
  );
  saveMemories(list);
}

export function deleteMemory(id: string) {
  saveMemories(loadMemories().filter((m) => m.id !== id));
}

export function clearMemories() {
  saveMemories([]);
}

/**
 * Formata as memórias como um bloco pra injetar no system prompt.
 * Retorna string vazia se não houver nada relevante.
 */
export function buildMemoryAddon(userText?: string): string {
  const list = loadMemories();
  if (!list.length) return "";
  const pinned = list.filter((m) => m.pinned);
  const relevant = userText ? filterRelevant(list, userText, 8) : list.slice(0, 8);
  const chosen = uniqueById([...pinned, ...relevant]).slice(0, 12);
  if (!chosen.length) return "";
  const bullets = chosen.map((m) => `- ${m.text}`).join("\n");
  return `Memórias do chefe (use quando fizer sentido, não cite explicitamente que "lembra"):\n${bullets}`;
}

function uniqueById(list: Memory[]): Memory[] {
  const seen = new Set<string>();
  const out: Memory[] = [];
  for (const m of list) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

function filterRelevant(list: Memory[], q: string, limit: number): Memory[] {
  const tokens = q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  if (!tokens.length) return list.slice(0, limit);
  const scored = list.map((m) => {
    const hay = m.text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    let s = 0;
    for (const t of tokens) if (hay.includes(t)) s++;
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s || b.m.updatedAt - a.m.updatedAt);
  const withHit = scored.filter((x) => x.s > 0).map((x) => x.m);
  if (withHit.length >= limit) return withHit.slice(0, limit);
  // fallback: preencher com mais recentes
  const extra = list
    .filter((m) => !withHit.find((w) => w.id === m.id))
    .slice(0, limit - withHit.length);
  return [...withHit, ...extra];
}

/**
 * Detecta automaticamente frases do usuário que parecem declarações
 * de preferência/fato ("meu nome é...", "eu prefiro...", "eu moro em...").
 * Retorna a memória salva ou null.
 */
export function autoCaptureFromUser(text: string): Memory | null {
  const t = text.trim();
  if (t.length < 4 || t.length > 240) return null;
  const patterns: { re: RegExp; kind: Memory["kind"]; build: (m: RegExpMatchArray) => string }[] = [
    { re: /\bmeu nome (?:é|eh|e)\s+([^.,!?\n]{2,60})/i, kind: "fact", build: (m) => `Nome do chefe: ${m[1].trim()}` },
    { re: /\bme chamo\s+([^.,!?\n]{2,60})/i, kind: "fact", build: (m) => `Nome do chefe: ${m[1].trim()}` },
    { re: /\beu (?:sou|trabalho como)\s+([^.,!?\n]{2,80})/i, kind: "fact", build: (m) => `Chefe é/trabalha como: ${m[1].trim()}` },
    { re: /\beu moro (?:em|no|na)\s+([^.,!?\n]{2,60})/i, kind: "fact", build: (m) => `Chefe mora em: ${m[1].trim()}` },
    { re: /\b(?:eu )?prefiro\s+([^.,!?\n]{2,120})/i, kind: "preference", build: (m) => `Preferência: ${m[1].trim()}` },
    { re: /\bnão gosto de\s+([^.,!?\n]{2,120})/i, kind: "preference", build: (m) => `Não gosta de: ${m[1].trim()}` },
    { re: /\blembre(?:-se)? (?:que|de)\s+([^.,!?\n]{3,200})/i, kind: "note", build: (m) => m[1].trim() },
    { re: /\banota (?:ai|aí|isso)?:?\s+([^.\n]{3,200})/i, kind: "note", build: (m) => m[1].trim() },
  ];
  for (const p of patterns) {
    const m = t.match(p.re);
    if (m) return addMemory(p.build(m), p.kind);
  }
  return null;
}
