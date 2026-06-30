import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Turn = { role: "user" | "assistant"; text: string };
type Status = "idle" | "listening" | "thinking" | "speaking" | "error";

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
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [partial, setPartial] = useState("");
  const [active, setActive] = useState<"stt" | "llm" | "tts" | null>(null);
  const [supported, setSupported] = useState(true);

  const recRef = useRef<SpeechRecognition | null>(null);
  const mutedRef = useRef(false);
  const runningRef = useRef(false);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (!("speechSynthesis" in window)) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "pt-BR";
      u.rate = 1.05;
      const voices = window.speechSynthesis.getVoices();
      const pt = voices.find((v) => v.lang?.toLowerCase().startsWith("pt"));
      if (pt) u.voice = pt;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      utterRef.current = u;
      window.speechSynthesis.speak(u);
    });
  }, []);

  const handleFinal = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setTranscript((p) => [...p, { role: "user", text: clean }]);
      setPartial("");
      setActive("llm");
      setStatus("thinking");

      try {
        const history = [...transcript, { role: "user" as const, text: clean }]
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
        setStatus("speaking");
        await speak(reply);
      } catch (err) {
        setError((err as Error).message);
        setStatus("error");
        return;
      }

      if (runningRef.current) {
        setActive("stt");
        setStatus("listening");
      }
    },
    [transcript, speak],
  );

  const start = useCallback(() => {
    setError(null);
    const SR: SRConstructor | undefined =
      (window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SRConstructor }).webkitSpeechRecognition;
    if (!SR) {
      setSupported(false);
      setError("Web Speech API não suportada neste navegador. Use Chrome/Edge.");
      setStatus("error");
      return;
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
        handleFinal(finalText);
      }
    };
    rec.onerror = (e) => {
      const err = (e as unknown as { error?: string }).error;
      if (err === "no-speech" || err === "aborted") return;
      setError(`Reconhecimento: ${err ?? "erro"}`);
    };
    rec.onend = () => {
      if (runningRef.current && status === "listening") {
        try { rec.start(); } catch { /* noop */ }
      }
    };

    recRef.current = rec;
    runningRef.current = true;
    setActive("stt");
    setStatus("listening");
    try { rec.start(); } catch { /* already started */ }
  }, [handleFinal, status]);

  const stop = useCallback(() => {
    runningRef.current = false;
    try { recRef.current?.abort(); } catch { /* noop */ }
    recRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus("idle");
    setActive(null);
    setPartial("");
  }, []);

  useEffect(() => {
    if (!open) stop();
    return () => stop();
  }, [open, stop]);

  const statusLabel = {
    idle: "Pronto para começar",
    listening: "Ouvindo… fale agora",
    thinking: "Pensando…",
    speaking: "Falando…",
    error: error ?? "Erro",
  }[status];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && status === "idle") onClose();
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
                  animate={status === "listening" ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                >
                  {status === "listening" && (
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
                <p className="text-xs text-success mt-1 font-medium">
                  R$ 0,00 · sem custo da OpenAI
                </p>
                <p className="text-sm text-muted-foreground mt-2 min-h-5">
                  {status === "listening" && (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                      {statusLabel}
                    </span>
                  )}
                  {status !== "listening" && (
                    <span className={status === "error" ? "text-destructive" : ""}>{statusLabel}</span>
                  )}
                </p>
                {partial && (
                  <p className="text-xs text-muted-foreground italic mt-1 max-w-sm truncate">
                    "{partial}"
                  </p>
                )}
              </div>
            </div>

            {/* Provider strip — mostra qual API está sendo usada agora */}
            <div className="px-6 py-3 border-t border-b bg-muted/30 grid grid-cols-3 gap-2 text-[11px]">
              <ProviderChip
                label="STT"
                name="Web Speech"
                free
                active={active === "stt"}
              />
              <ProviderChip
                label="LLM"
                name="Gemini Flash"
                free
                active={active === "llm"}
              />
              <ProviderChip
                label="TTS"
                name="Web Speech"
                free
                active={active === "tts"}
              />
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
              {status === "idle" || status === "error" ? (
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
                    onClick={() => setMuted((m) => !m)}
                    className="h-14 w-14 rounded-full p-0"
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
                    {status === "thinking" ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Sparkles className="h-5 w-5" style={{ opacity: status === "speaking" ? 1 : 0.4 }} />
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
  label,
  name,
  free,
  active,
}: {
  label: string;
  name: string;
  free?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={`rounded-lg px-2.5 py-1.5 border transition ${
        active
          ? "border-success bg-success/10 shadow-sm"
          : "border-transparent bg-background/40"
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
