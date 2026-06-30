import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Loader2, Sparkles, CheckCircle2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Turn = { role: "user" | "assistant"; text: string };
type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

type SRConstructor = new () => SpeechRecognition;
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult> & {
    [k: number]: SpeechRecognitionResult;
  };
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

export function FreeCallModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [active, setActive] = useState<"stt" | "llm" | "tts" | null>(null);
  const [supported, setSupported] = useState(true);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const [rate, setRate] = useState(1.05);
  const [volume, setVolume] = useState(1);

  // Refs (avoid stale closures in SR callbacks)
  const recRef = useRef<SpeechRecognition | null>(null);
  const runningRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const mutedRef = useRef(false);
  const transcriptRef = useRef<Turn[]>([]);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const handleFinalRef = useRef<(text: string) => void>(() => {});
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const rateRef = useRef(rate);
  const volumeRef = useRef(volume);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { rateRef.current = rate; }, [rate]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  // Load voices (browser populates async)
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      if (!voiceURI && list.length) {
        const pt = list.find((v) => v.lang?.toLowerCase().startsWith("pt")) ?? list[0];
        setVoiceURI(pt.voiceURI);
        voiceRef.current = pt;
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [voiceURI]);

  useEffect(() => {
    voiceRef.current = voices.find((v) => v.voiceURI === voiceURI) ?? null;
  }, [voiceURI, voices]);

  const startRecognition = useCallback(() => {
    const rec = recRef.current;
    if (!rec || !runningRef.current) return;
    try {
      rec.start();
    } catch {
      // Already started; ignore
    }
  }, []);

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voiceRef.current?.lang ?? "pt-BR";
      u.rate = rateRef.current;
      u.volume = volumeRef.current;
      if (voiceRef.current) u.voice = voiceRef.current;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      utterRef.current = u;
      window.speechSynthesis.speak(u);
    });
  }, []);

  // Stable handleFinal via ref pattern
  useEffect(() => {
    handleFinalRef.current = async (text: string) => {
      const clean = text.trim();
      if (!clean) {
        // resume listening if nothing useful captured
        if (runningRef.current) {
          setPhase("listening");
          setActive("stt");
          startRecognition();
        }
        return;
      }
      setTranscript((p) => [...p, { role: "user", text: clean }]);
      setPartial("");
      setActive("llm");
      setPhase("thinking");

      try {
        const history = [...transcriptRef.current, { role: "user" as const, text: clean }]
          .slice(-10)
          .map((t) => ({ role: t.role, content: t.text }));
        const res = await fetch("/api/free-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
        if (!res.ok) throw new Error(await res.text());
        const { reply } = (await res.json()) as { reply: string };
        setTranscript((p) => [...p, { role: "assistant", text: reply }]);

        setActive("tts");
        setPhase("speaking");
        await speak(reply);
      } catch (err) {
        setError((err as Error).message);
        setPhase("error");
        runningRef.current = false;
        return;
      }

      // CRITICAL: explicitly resume listening after TTS finishes
      if (runningRef.current) {
        setActive("stt");
        setPhase("listening");
        startRecognition();
      }
    };
  }, [speak, startRecognition]);

  const buildRecognition = useCallback((): SpeechRecognition | null => {
    const SR: SRConstructor | undefined =
      (window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SRConstructor }).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      setError("Web Speech API não suportada. Use Chrome/Edge.");
      setPhase("error");
      return null;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interim = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (interim) setPartial(interim);
      if (finalText && !mutedRef.current) {
        try { rec.stop(); } catch { /* noop */ }
        handleFinalRef.current(finalText);
      }
    };
    rec.onerror = (e) => {
      const err = (e as unknown as { error?: string }).error;
      if (err === "no-speech" || err === "aborted") return;
      if (err === "not-allowed" || err === "service-not-allowed") {
        setError("Permissão de microfone negada. Habilite nas configurações do navegador.");
        setPhase("error");
        runningRef.current = false;
        return;
      }
      // transient errors: log only
      console.warn("[SR error]", err);
    };
    rec.onend = () => {
      // Auto-restart only while in listening phase (not while thinking/speaking).
      // After speaking, handleFinal explicitly calls startRecognition().
      if (runningRef.current && phaseRef.current === "listening") {
        try { rec.start(); } catch { /* noop */ }
      }
    };

    return rec;
  }, []);

  const start = useCallback(() => {
    setError(null);
    const rec = buildRecognition();
    if (!rec) return;
    recRef.current = rec;
    runningRef.current = true;
    setActive("stt");
    setPhase("listening");
    try { rec.start(); } catch { /* already started */ }
  }, [buildRecognition]);

  const stop = useCallback(() => {
    runningRef.current = false;
    phaseRef.current = "idle";
    try { recRef.current?.abort(); } catch { /* noop */ }
    recRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPhase("idle");
    setActive(null);
    setPartial("");
  }, []);

  // Interrupt AI while it's speaking
  const interruptSpeech = useCallback(() => {
    if (phaseRef.current !== "speaking") return;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (runningRef.current) {
      setPhase("listening");
      setActive("stt");
      startRecognition();
    }
  }, [startRecognition]);

  useEffect(() => {
    if (!open) stop();
    return () => stop();
  }, [open, stop]);

  const statusLabel = {
    idle: "Pronto para começar",
    listening: "Ouvindo… fale agora",
    thinking: "Pensando…",
    speaking: "Falando… (toque no microfone para interromper)",
    error: error ?? "Erro",
  }[phase];

  const ptVoices = useMemo(
    () => voices.filter((v) => v.lang?.toLowerCase().startsWith("pt")),
    [voices],
  );
  const otherVoices = useMemo(
    () => voices.filter((v) => !v.lang?.toLowerCase().startsWith("pt")),
    [voices],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && phase === "idle") onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="w-full max-w-lg rounded-3xl border bg-card text-card-foreground shadow-2xl overflow-hidden"
          >
            <div className="relative px-6 pt-8 pb-6 bg-gradient-to-br from-success/15 via-transparent to-primary/10">
              <div className="flex flex-col items-center text-center">
                <motion.div
                  className="relative h-28 w-28 rounded-full bg-success/15 flex items-center justify-center"
                  animate={phase === "listening" ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                >
                  {phase === "listening" && (
                    <motion.div
                      className="absolute inset-0 rounded-full bg-success/20"
                      animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                    />
                  )}
                  <div className="relative h-20 w-20 rounded-full bg-success text-success-foreground flex items-center justify-center shadow-lg">
                    <Sparkles className="h-8 w-8" />
                  </div>
                </motion.div>
                <h2 className="mt-4 text-xl font-semibold tracking-tight">Chamada grátis</h2>
                <p className="text-xs text-success mt-1 font-medium">R$ 0,00 · contínua</p>
                <p className="text-sm text-muted-foreground mt-2 min-h-5">
                  {phase === "listening" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                      {statusLabel}
                    </span>
                  ) : (
                    <span className={phase === "error" ? "text-destructive" : ""}>{statusLabel}</span>
                  )}
                </p>
                {partial && (
                  <p className="text-xs text-muted-foreground italic mt-1 max-w-sm truncate">
                    "{partial}"
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-b bg-muted/30 grid grid-cols-3 gap-2 text-[11px]">
              <ProviderChip label="STT" name="Web Speech" free active={active === "stt"} />
              <ProviderChip label="LLM" name="Gemini Flash" free active={active === "llm"} />
              <ProviderChip label="TTS" name="Web Speech" free active={active === "tts"} />
            </div>

            {/* Voice / speed / volume controls */}
            <div className="px-6 py-3 border-b space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <select
                  value={voiceURI}
                  onChange={(e) => setVoiceURI(e.target.value)}
                  className="flex-1 min-w-0 bg-background border rounded-md px-2 py-1 text-xs"
                >
                  {ptVoices.length > 0 && (
                    <optgroup label="Português">
                      {ptVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherVoices.length > 0 && (
                    <optgroup label="Outros idiomas">
                      {otherVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground w-14">Veloc.</span>
                  <input
                    type="range" min={0.5} max={2} step={0.05}
                    value={rate} onChange={(e) => setRate(parseFloat(e.target.value))}
                    className="flex-1 accent-success"
                  />
                  <span className="tabular-nums w-8 text-right">{rate.toFixed(2)}x</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground w-14">Volume</span>
                  <input
                    type="range" min={0} max={1} step={0.05}
                    value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))}
                    className="flex-1 accent-success"
                  />
                  <span className="tabular-nums w-8 text-right">{Math.round(volume * 100)}%</span>
                </label>
              </div>
            </div>

            {transcript.length > 0 && (
              <div className="max-h-40 overflow-y-auto scrollbar-thin px-6 py-3 text-sm space-y-2 border-b">
                {transcript.slice(-6).map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[10px] uppercase font-medium text-muted-foreground w-12 shrink-0 pt-0.5">
                      {m.role === "user" ? "Você" : "Aurora"}
                    </span>
                    <span className="text-foreground">{m.text}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="p-6 flex items-center justify-center gap-3">
              {phase === "idle" || phase === "error" ? (
                <>
                  <Button
                    size="lg"
                    onClick={start}
                    disabled={!supported}
                    className="h-14 px-8 rounded-full gap-2 shadow-lg bg-success hover:bg-success/90 text-success-foreground"
                  >
                    <Phone className="h-5 w-5" /> Iniciar
                  </Button>
                  <Button size="lg" variant="ghost" onClick={onClose} className="h-14 rounded-full">
                    Fechar
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="lg"
                    variant={muted ? "secondary" : "outline"}
                    onClick={() => {
                      if (phaseRef.current === "speaking") {
                        interruptSpeech();
                      } else {
                        setMuted((m) => !m);
                      }
                    }}
                    className="h-14 w-14 rounded-full p-0"
                    title={phase === "speaking" ? "Interromper IA" : muted ? "Desmutar" : "Mutar"}
                  >
                    {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={() => { stop(); onClose(); }}
                    className="h-14 px-6 rounded-full gap-2"
                  >
                    <PhoneOff className="h-5 w-5" /> Encerrar
                  </Button>
                  <div className="h-14 w-14 rounded-full border flex items-center justify-center text-muted-foreground">
                    {phase === "thinking" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Sparkles className="h-5 w-5" style={{ opacity: phase === "speaking" ? 1 : 0.4 }} />
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ProviderChip({
  label, name, free, active,
}: { label: string; name: string; free?: boolean; active?: boolean }) {
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 border transition ${
        active ? "border-success bg-success/10 shadow-sm" : "border-transparent bg-background/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground uppercase tracking-wide">{label}</span>
        {active && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
          />
        )}
      </div>
      <div className="flex items-center gap-1 mt-0.5">
        <span className="font-medium text-foreground truncate">{name}</span>
        {free && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
      </div>
    </div>
  );
}
