// Lightweight pub/sub used to navigate the in-app embedded browser
// (replaces window.open popups across agent + call modals).

const KEY = "octopus.browser.history.v1";
const MAX = 30;

type NavListener = (url: string) => void;
type CmdListener = (cmd: "close" | "pause" | "play") => void;
const navListeners = new Set<NavListener>();
const cmdListeners = new Set<CmdListener>();

export function openInAppBrowser(url: string) {
  if (!url) return;
  for (const l of navListeners) {
    try {
      l(url);
    } catch {
      /* ignore */
    }
  }
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

export function sendBrowserCommand(cmd: "close" | "pause" | "play") {
  for (const l of cmdListeners) {
    try {
      l(cmd);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeBrowserBus(fn: NavListener) {
  navListeners.add(fn);
  return () => navListeners.delete(fn);
}

export function subscribeBrowserCommands(fn: CmdListener) {
  cmdListeners.add(fn);
  return () => cmdListeners.delete(fn);
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
