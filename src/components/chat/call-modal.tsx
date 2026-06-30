import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Loader2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { realtimeCostUSD } from "@/lib/models";

type Usage = { textIn: number; textOut: number; audioIn: number; audioOut: number };

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
  const [transcript, setTranscript] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [level, setLevel] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

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
    setStatus("idle");
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    setUsage({ textIn: 0, textOut: 0, audioIn: 0, audioOut: 0 });
    setTranscript([]);
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
  }, [voice, stop]);

  const handleEvent = (ev: Record<string, unknown>) => {
    const type = ev.type as string;
    if (type === "response.done") {
      const response = ev.response as
        | { usage?: { input_token_details?: Record<string, number>; output_token_details?: Record<string, number> } }
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
      if (text.trim()) setTranscript((p) => [...p, { role: "user", text }]);
    } else if (type === "response.audio_transcript.done") {
      const text = (ev.transcript as string) ?? "";
      if (text.trim()) setTranscript((p) => [...p, { role: "assistant", text }]);
    }
  };

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
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="w-full max-w-lg rounded-3xl border bg-card text-card-foreground shadow-2xl overflow-hidden"
          >
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
                    A
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

            {transcript.length > 0 && (
              <div className="max-h-40 overflow-y-auto scrollbar-thin px-6 py-3 text-sm space-y-2 border-b">
                {transcript.slice(-6).map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[10px] uppercase font-medium text-muted-foreground w-12 shrink-0 pt-0.5">
                      {m.role === "user" ? "Você" : "Octopus"}
                    </span>
                    <span className="text-foreground">{m.text}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="p-6 flex items-center justify-center gap-3">
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
