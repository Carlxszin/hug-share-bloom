// Lightweight pub/sub used to navigate the in-app embedded browser
// (replaces window.open popups across agent + call modals).

const KEY = "octopus.browser.history.v1";
const MAX = 30;

type NavListener = (url: string) => void;
type CmdListener = (cmd: "close" | "pause" | "play") => void;
const navListeners = new Set<NavListener>();
const cmdListeners = new Set<CmdListener>();

let reservedExternalTab: Window | null = null;
let reservedExternalTabUsed = false;

function writeWaitingPage(tab: Window) {
  try {
    tab.document.title = "Octopus abrindo site…";
    tab.document.body.style.cssText =
      "margin:0;background:#0b0b0f;color:#fff;font:14px system-ui;display:grid;place-items:center;height:100vh";
    tab.document.body.innerHTML =
      '<div style="text-align:center;max-width:320px;padding:24px"><div style="font-size:40px;margin-bottom:12px">🐙</div><strong>Octopus está preparando a página…</strong><p style="color:#aaa;line-height:1.4">Esta aba será usada automaticamente caso o site bloqueie a visualização dentro do agente.</p></div>';
  } catch {
    /* cross-origin or blocked */
  }
}

export function reserveExternalTab() {
  if (typeof window === "undefined") return false;
  if (reservedExternalTab && !reservedExternalTab.closed) return true;
  try {
    const tab = window.open("", "octopus-agent-popup");
    if (!tab) return false;
    reservedExternalTab = tab;
    reservedExternalTabUsed = false;
    writeWaitingPage(tab);
    tab.focus();
    return true;
  } catch {
    reservedExternalTab = null;
    reservedExternalTabUsed = false;
    return false;
  }
}

export function openExternalTab(url: string) {
  if (!url || typeof window === "undefined") return false;
  try {
    // Reusa a janela nomeada: o próprio browser navega sem violar same-origin.
    const tab = window.open(url, "octopus-agent-popup");
    if (!tab) return false;
    reservedExternalTab = tab;
    reservedExternalTabUsed = true;
    try {
      tab.focus();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

export function closeReservedExternalTabIfUnused() {
  try {
    if (reservedExternalTab && !reservedExternalTab.closed && !reservedExternalTabUsed) {
      reservedExternalTab.close();
    }
  } catch {
    /* ignore */
  } finally {
    if (!reservedExternalTabUsed) reservedExternalTab = null;
  }
}

export function closeExternalTab() {
  try {
    reservedExternalTab?.close();
  } catch {
    /* ignore */
  }
  reservedExternalTab = null;
  reservedExternalTabUsed = false;
}

export function openInAppBrowser(url: string) {
  if (!url) return;
  const hasEmbeddedBrowser = navListeners.size > 0;
  for (const l of navListeners) {
    try {
      l(url);
    } catch {
      /* ignore */
    }
  }
  if (!hasEmbeddedBrowser) openExternalTab(url);
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
  if (cmd === "close") closeExternalTab();
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
