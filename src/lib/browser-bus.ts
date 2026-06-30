// Lightweight pub/sub used to navigate the in-app embedded browser
// (replaces window.open popups across agent + call modals).
//
// Also persists the last-visited URLs to localStorage so the panel
// can restore its history between sessions.

const KEY = "octopus.browser.history.v1";
const MAX = 30;

type Listener = (url: string) => void;
const listeners = new Set<Listener>();

export function openInAppBrowser(url: string) {
  if (!url) return;
  // Notify listeners (EmbeddedBrowser will pick it up)
  for (const l of listeners) {
    try {
      l(url);
    } catch {
      /* ignore */
    }
  }
  // Persist
  if (typeof window !== "undefined") {
    try {
      const prev = loadHistory();
      const next = [url, ...prev.filter((u) => u !== url)].slice(0, MAX);
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
}

export function subscribeBrowserBus(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function clearHistory() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
