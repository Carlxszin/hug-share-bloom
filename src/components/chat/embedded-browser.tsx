import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  ExternalLink,
  X,
  Globe,
  History,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  clearHistory,
  loadHistory,
  subscribeBrowserBus,
  subscribeBrowserCommands,
} from "@/lib/browser-bus";

/**
 * In-app browser panel. Sites that send X-Frame-Options: DENY (Google,
 * YouTube watch pages, etc.) will refuse to render inside the iframe —
 * in that case we surface a clear "abrir em nova aba" fallback.
 */
export function EmbeddedBrowser({
  className = "",
  onClose,
}: {
  className?: string;
  onClose?: () => void;
}) {
  const [stack, setStack] = useState<string[]>([]);
  const [idx, setIdx] = useState(-1);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const blockTimer = useRef<number | null>(null);
  const externalTabRef = useRef<Window | null>(null);
  const autoOpenedFor = useRef<string | null>(null);

  const current = idx >= 0 ? stack[idx] : null;

  const go = useCallback((url: string) => {
    setStack((s) => {
      const trimmed = s.slice(0, Math.max(0, idx + 1));
      const next = [...trimmed, url];
      setIdx(next.length - 1);
      return next;
    });
    setHistory(loadHistory());
  }, [idx]);

  useEffect(() => {
    const off = subscribeBrowserBus((url) => {
      go(url);
    });
    const offCmd = subscribeBrowserCommands((cmd) => {
      const iframe = iframeRef.current;
      if (cmd === "close") {
        setStack([]);
        setIdx(-1);
        setBlocked(false);
      } else if (cmd === "pause" || cmd === "play") {
        // YouTube IFrame API postMessage
        if (iframe?.contentWindow) {
          const func = cmd === "pause" ? "pauseVideo" : "playVideo";
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: "command", func, args: [] }),
            "*",
          );
        }
      }
    });
    return () => {
      off();
      offCmd();
    };
  }, [go]);

  // Track "blocked" by iframe: if load never fires within 2.5s, assume the
  // site refused via X-Frame-Options / CSP and show the fallback.
  useEffect(() => {
    if (!current) return;
    setBlocked(false);
    setLoading(true);
    if (blockTimer.current) window.clearTimeout(blockTimer.current);
    blockTimer.current = window.setTimeout(() => {
      setBlocked(true);
      setLoading(false);
    }, 2800);
    return () => {
      if (blockTimer.current) window.clearTimeout(blockTimer.current);
    };
  }, [current]);

  const onLoad = () => {
    setLoading(false);
    if (blockTimer.current) {
      window.clearTimeout(blockTimer.current);
      blockTimer.current = null;
    }
    setBlocked(false);
  };

  const canBack = idx > 0;
  const canFwd = idx >= 0 && idx < stack.length - 1;

  const embedUrl = useMemo(() => {
    if (!current) return null;
    // YouTube: convert to nocookie embed with origin to avoid Error 150/153
    try {
      const u = new URL(current);
      const host = u.hostname.replace(/^www\./, "");
      let id: string | null = null;
      if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
      else if (host.endsWith("youtube.com")) {
        if (u.pathname === "/watch") id = u.searchParams.get("v");
        else if (u.pathname.startsWith("/shorts/")) id = u.pathname.split("/")[2];
        else if (u.pathname.startsWith("/embed/")) id = u.pathname.split("/")[2];
      }
      if (id) {
        const origin =
          typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : "";
        return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1${origin ? `&origin=${origin}` : ""}`;
      }
    } catch {
      /* not a URL */
    }
    return current;
  }, [current]);

  return (
    <div
      className={`flex flex-col bg-card/60 backdrop-blur border border-white/10 rounded-2xl overflow-hidden ${className}`}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/10 bg-background/40">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!canBack}
          onClick={() => setIdx((i) => i - 1)}
          aria-label="Voltar"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!canFwd}
          onClick={() => setIdx((i) => i + 1)}
          aria-label="Avançar"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!current}
          onClick={() => {
            if (iframeRef.current && current) {
              iframeRef.current.src = embedUrl ?? current;
            }
          }}
          aria-label="Recarregar"
        >
          <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="flex-1 min-w-0 mx-1">
          <div className="h-7 px-2 rounded-md bg-background/60 border border-white/10 flex items-center gap-1.5 text-xs text-muted-foreground truncate">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate font-mono">{current ?? "novo separador"}</span>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setShowHistory((v) => !v)}
          aria-label="Histórico"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          disabled={!current}
          onClick={() => current && window.open(current, "_blank", "noopener,noreferrer")}
          aria-label="Abrir externo"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Body */}
      <div className="relative flex-1 min-h-[280px] bg-background">
        {!current && !showHistory && (
          <EmptyBrowser />
        )}
        {showHistory && (
          <HistoryPanel
            items={history}
            onPick={(u) => {
              setShowHistory(false);
              go(u);
            }}
            onClear={() => {
              clearHistory();
              setHistory([]);
            }}
          />
        )}
        {current && !showHistory && (
          <>
            <iframe
              ref={iframeRef}
              key={current}
              src={embedUrl ?? current}
              onLoad={onLoad}
              title="Navegador embutido"
              className="absolute inset-0 h-full w-full bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
              referrerPolicy="no-referrer"
              allow="autoplay; encrypted-media; clipboard-read; clipboard-write; fullscreen"
            />
            {blocked && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 text-center p-6">
                <Globe className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-foreground max-w-xs">
                  Este site bloqueia visualização embutida, chefe.
                </p>
                <Button
                  size="sm"
                  onClick={() => window.open(current, "_blank", "noopener,noreferrer")}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" /> Abrir em nova aba
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyBrowser() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-6 text-muted-foreground">
      <Globe className="h-7 w-7 opacity-50" />
      <p className="text-xs max-w-xs">
        O Octopus abre páginas aqui em tempo real. Peça para pesquisar, abrir um vídeo
        ou navegar em algum site.
      </p>
    </div>
  );
}

function HistoryPanel({
  items,
  onPick,
  onClear,
}: {
  items: string[];
  onPick: (url: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="absolute inset-0 overflow-y-auto scrollbar-thin p-3 space-y-1">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Histórico salvo
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs gap-1"
          onClick={onClear}
          disabled={!items.length}
        >
          <Trash2 className="h-3 w-3" /> Limpar
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-1">Nada salvo ainda.</p>
      ) : (
        items.map((url) => (
          <button
            key={url}
            onClick={() => onPick(url)}
            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-muted/40 text-xs font-mono truncate"
          >
            {url}
          </button>
        ))
      )}
    </div>
  );
}
