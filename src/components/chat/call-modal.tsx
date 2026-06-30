import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Loader2, Activity, Search, ExternalLink, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { realtimeCostUSD } from "@/lib/models";
import {
  closeReservedExternalTabIfUnused,
  openInAppBrowser,
  reserveExternalTab,
  sendBrowserCommand,
} from "@/lib/browser-bus";
import { detectImagePrompt, enqueueImage } from "@/lib/image-queue";
import { ImageQueuePanel } from "./image-queue-panel";

type Usage = { textIn: number; textOut: number; audioIn: number; audioOut: number };
type FeedItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "search"; query: string; count?: number }
  | { kind: "open"; url: string }
  | { kind: "tool-error"; text: string };

export function CallModal({
  open,
  onClose,
  rate,
  voice = "alloy",
}: {
  open: boolean;
  onClose: () => void;
  rate: number;
  voice?: string;
}) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [usage, setUsage] = useState<Usage>({ textIn: 0, textOut: 0, audioIn: 0, audioOut: 0 });
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [level, setLevel] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  // Buffer accumulators for streaming function_call_arguments
  const fnBufRef = useRef<Map<string, { name: string; args: string; call_id: string }>>(new Map());

  const pushFeed = useCallback((item: FeedItem) => {
    setFeed((p) => [...p, item]);
  }, []);

  useEffect(() => {
    feedScrollRef.current?.scrollTo({ top: feedScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [feed]);

  const stop = useCallback(() => {
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    micRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    closeReservedExternalTabIfUnused();
    setStatus("idle");
    setLevel(0);
  }, []);

  const sendEvent = (ev: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify(ev));
  };

  const executeTool = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (name === "open_url") {
        const url = String(args.url ?? "");
        if (!url) return JSON.stringify({ error: "url ausente" });
        try {
          openInAppBrowser(url);
          pushFeed({ kind: "open", url });
          return JSON.stringify({ ok: true, opened: url });
        } catch (e) {
          pushFeed({ kind: "tool-error", text: `Falha ao abrir ${url}` });
          return JSON.stringify({ error: (e as Error).message });
        }
      }
      if (name === "web_search") {
        const query = String(args.query ?? "");
        pushFeed({ kind: "search", query });
        try {
          const res = await fetch("/api/web-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query }),
          });
          if (!res.ok) throw new Error(await res.text());
          const data = (await res.json()) as {
            results: { title: string; url: string; snippet?: string }[];
          };
          setFeed((p) => {
            const copy = [...p];
            for (let i = copy.length - 1; i >= 0; i--) {
              const it = copy[i];
              if (it.kind === "search" && it.query === query && it.count === undefined) {
                copy[i] = { ...it, count: data.results.length };
                break;
              }
            }
            return copy;
          });
          return JSON.stringify({ query, results: data.results.slice(0, 6) });
        } catch (e) {
          pushFeed({ kind: "tool-error", text: `Pesquisa falhou: ${(e as Error).message}` });
          return JSON.stringify({ error: (e as Error).message });
        }
      }
      return JSON.stringify({ error: `tool desconhecida: ${name}` });
    },
    [pushFeed],
  );

  const handleEvent = useCallback(
    async (ev: Record<string, unknown>) => {
      const type = ev.type as string;
      if (type === "response.done") {
        const response = ev.response as
          | {
              usage?: {
                input_token_details?: Record<string, number>;
                output_token_details?: Record<string, number>;
              };
            }
          | undefined;
        const u = response?.usage;
        if (u) {
          setUsage((prev) => ({
            textIn: prev.textIn + (u.input_token_details?.text_tokens ?? 0),
            textOut: prev.textOut + (u.output_token_details?.text_tokens ?? 0),
            audioIn: prev.audioIn + (u.input_token_details?.audio_tokens ?? 0),
            audioOut: prev.audioOut + (u.output_token_details?.audio_tokens ?? 0),
          }));
        }
      } else if (type === "conversation.item.input_audio_transcription.completed") {
        const text = (ev.transcript as string) ?? "";
        if (text.trim()) {
          const n = text.trim().toLowerCase();
          if (/\b(pausa|pausar|pare|para)\b/.test(n) && /(música|musica|vídeo|video|som|áudio|audio)/.test(n)) sendBrowserCommand("pause");
          else if (/\b(toca|tocar|continua|continuar|play)\b/.test(n) && /(música|musica|vídeo|video|som)/.test(n)) sendBrowserCommand("play");
          else if (/\b(fecha|fechar|feche)\b/.test(n) && /(aba|site|página|pagina|janela|navegador)/.test(n)) sendBrowserCommand("close");
          const imgPrompt = detectImagePrompt(text);
          if (imgPrompt) {
            enqueueImage(imgPrompt);
            pushFeed({ kind: "open", url: `🎨 ${imgPrompt}` });
          }
          pushFeed({ kind: "user", text });
        }
      } else if (type === "response.audio_transcript.done") {
        const text = (ev.transcript as string) ?? "";
        if (text.trim()) pushFeed({ kind: "assistant", text });
      } else if (type === "response.output_item.added") {
        const item = ev.item as { id?: string; type?: string; name?: string; call_id?: string } | undefined;
        if (item?.type === "function_call" && item.id && item.name && item.call_id) {
          fnBufRef.current.set(item.id, { name: item.name, args: "", call_id: item.call_id });
        }
      } else if (type === "response.function_call_arguments.delta") {
        const itemId = ev.item_id as string;
        const delta = (ev.delta as string) ?? "";
        const buf = fnBufRef.current.get(itemId);
        if (buf) buf.args += delta;
      } else if (type === "response.function_call_arguments.done") {
        const itemId = ev.item_id as string;
        const callId = (ev.call_id as string) ?? fnBufRef.current.get(itemId)?.call_id;
        const name = (ev.name as string) ?? fnBufRef.current.get(itemId)?.name ?? "";
        const argsStr = (ev.arguments as string) ?? fnBufRef.current.get(itemId)?.args ?? "{}";
        fnBufRef.current.delete(itemId);
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(argsStr || "{}");
        } catch {
          /* keep empty */
        }
        const output = await executeTool(name, parsed);
        sendEvent({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output,
          },
        });
        sendEvent({ type: "response.create" });
      }
    },
    [executeTool, pushFeed],
  );

  const start = useCallback(async () => {
    reserveExternalTab();
    setStatus("connecting");
    setError(null);
    setUsage({ textIn: 0, textOut: 0, audioIn: 0, audioOut: 0 });
    setFeed([]);
    setElapsed(0);

    try {
      const tokRes = await fetch("/api/realtime-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      if (!tokRes.ok) throw new Error(await tokRes.text());
      const session = await tokRes.json();
      const ephemeralKey: string | undefined =
        session?.value ?? session?.client_secret?.value;
      if (!ephemeralKey) throw new Error("Token efêmero ausente");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = audioElRef.current ?? new Audio();
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      // VU meter
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(mic);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          handleEvent(ev);
        } catch {
          /* ignore */
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls?model=gpt-realtime-mini", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) throw new Error(await sdpRes.text());
      const answer = { type: "answer", sdp: await sdpRes.text() } as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(answer);

      startTimeRef.current = Date.now();
      setStatus("live");
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
      setStatus("error");
      stop();
    }
  }, [voice, stop, handleEvent]);

  useEffect(() => {
    if (status !== "live") return;
    const id = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 500);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (!open) stop();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleMute = () => {
    if (!micRef.current) return;
    const newMuted = !muted;
    micRef.current.getAudioTracks().forEach((t) => (t.enabled = !newMuted));
    setMuted(newMuted);
  };

  const cost = realtimeCostUSD(usage);
  const mm = String(Math.floor(elapsed / 60000)).padStart(2, "0");
  const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, "0");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && status !== "live") onClose();
          }}
        >
          <ImageQueuePanel position="fixed" />

          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="w-full max-w-4xl rounded-3xl border bg-card text-card-foreground shadow-2xl overflow-hidden grid md:grid-cols-[1fr_360px]"
          >
            {/* LEFT: Call panel */}
            <div className="flex flex-col">
              <div className="relative px-6 pt-8 pb-6 bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
                <div className="flex flex-col items-center text-center">
                  <motion.div
                    className="relative h-32 w-32 rounded-full bg-primary/15 flex items-center justify-center"
                    animate={
                      status === "live"
                        ? { scale: [1, 1 + level * 0.15, 1] }
                        : { scale: 1 }
                    }
                    transition={{ duration: 0.2 }}
                  >
                    {status === "live" && (
                      <>
                        <motion.div
                          className="absolute inset-0 rounded-full bg-primary/20"
                          animate={{ scale: [1, 1.4, 1.8], opacity: [0.6, 0.2, 0] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                        />
                        <motion.div
                          className="absolute inset-0 rounded-full bg-primary/15"
                          animate={{ scale: [1, 1.4, 1.8], opacity: [0.5, 0.15, 0] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.6 }}
                        />
                      </>
                    )}
                    <div className="relative h-24 w-24 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-3xl font-semibold shadow-lg">
                      O
                    </div>
                  </motion.div>
                  <h2 className="mt-5 text-xl font-semibold tracking-tight">Octopus</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {status === "idle" && "Pronto para conversar por voz"}
                    {status === "connecting" && "Conectando…"}
                    {status === "live" && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                        Em chamada · {mm}:{ss}
                      </span>
                    )}
                    {status === "error" && (
                      <span className="text-destructive">{error ?? "Erro de conexão"}</span>
                    )}
                  </p>
                </div>
              </div>

              {status === "live" && (
                <div className="px-6 py-4 border-t border-b bg-muted/30 grid grid-cols-3 gap-3 text-xs">
                  <CostStat label="Áudio in" usd={cost.audioIn} rate={rate} />
                  <CostStat label="Áudio out" usd={cost.audioOut} rate={rate} />
                  <CostStat label="Total" usd={cost.total} rate={rate} highlight />
                </div>
              )}

              <div className="mt-auto p-6 flex items-center justify-center gap-3">
                {status === "live" ? (
                  <>
                    <Button
                      size="lg"
                      variant={muted ? "secondary" : "outline"}
                      onClick={toggleMute}
                      className="h-14 w-14 rounded-full p-0"
                      aria-label={muted ? "Ativar microfone" : "Silenciar"}
                    >
                      {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                    </Button>
                    <Button
                      size="lg"
                      variant="destructive"
                      onClick={() => {
                        stop();
                        onClose();
                      }}
                      className="h-14 px-6 rounded-full gap-2"
                    >
                      <PhoneOff className="h-5 w-5" /> Encerrar
                    </Button>
                    <div className="h-14 w-14 rounded-full border flex items-center justify-center text-muted-foreground">
                      <Activity className="h-5 w-5" style={{ opacity: 0.4 + level * 0.6 }} />
                    </div>
                  </>
                ) : status === "connecting" ? (
                  <Button size="lg" disabled className="h-14 px-8 rounded-full gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" /> Conectando
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      onClick={start}
                      className="h-14 px-8 rounded-full gap-2 shadow-lg"
                    >
                      <Phone className="h-5 w-5" /> Iniciar chamada
                    </Button>
                    <Button size="lg" variant="ghost" onClick={onClose} className="h-14 rounded-full">
                      Fechar
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* RIGHT: Live activity feed */}
            <SideFeed feed={feed} scrollRef={feedScrollRef} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SideFeed({
  feed,
  scrollRef,
}: {
  feed: FeedItem[];
  scrollRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="border-t md:border-t-0 md:border-l bg-muted/20 flex flex-col max-h-[640px] md:max-h-none">
      <div className="px-4 py-3 border-b flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-medium">
        <MessageSquare className="h-3.5 w-3.5" /> Chat ao vivo
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-2 text-sm min-h-[280px] md:min-h-[400px]"
      >
        {feed.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            As pesquisas, sites abertos e a transcrição aparecem aqui em tempo real.
          </p>
        ) : (
          feed.map((it, i) => <FeedRow key={i} item={it} />)
        )}
      </div>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex gap-2">
        <span className="text-[10px] uppercase font-semibold text-muted-foreground w-14 shrink-0 pt-0.5">
          Você
        </span>
        <span className="text-foreground">{item.text}</span>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="flex gap-2">
        <span className="text-[10px] uppercase font-semibold text-primary w-14 shrink-0 pt-0.5">
          Octopus
        </span>
        <span className="text-foreground">{item.text}</span>
      </div>
    );
  }
  if (item.kind === "search") {
    return (
      <div className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5 flex items-center gap-2 text-xs">
        <Search className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="font-medium truncate">{item.query}</span>
        <span className="ml-auto text-muted-foreground shrink-0">
          {item.count === undefined ? "…" : `${item.count} resultados`}
        </span>
      </div>
    );
  }
  if (item.kind === "open") {
    return (
      <div className="rounded-md border border-success/30 bg-success/10 px-2.5 py-1.5 flex items-center gap-2 text-xs">
        <ExternalLink className="h-3.5 w-3.5 text-success shrink-0" />
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-foreground hover:underline"
        >
          {item.url}
        </a>
      </div>
    );
  }
  return (
    <div className="text-xs text-destructive">{item.text}</div>
  );
}

function CostStat({
  label,
  usd,
  rate,
  highlight,
}: {
  label: string;
  usd: number;
  rate: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{label}</span>
      <span
        className={`font-mono font-semibold ${highlight ? "text-primary" : "text-foreground"}`}
      >
        {(usd * rate).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
          minimumFractionDigits: 4,
        })}
      </span>
      <span className="text-[10px] text-muted-foreground font-mono">${usd.toFixed(4)}</span>
    </div>
  );
}
