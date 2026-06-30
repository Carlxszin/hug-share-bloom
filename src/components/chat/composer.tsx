import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Square, Mic, Loader2, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  loading,
  onCall,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  loading: boolean;
  onCall?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) ref.current?.focus();
  }, [loading]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  const startRec = async () => {
    setRecError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 1024) {
          setRecError("Gravação muito curta");
          return;
        }
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append("file", blob, mime.includes("mp4") ? "audio.mp4" : "audio.webm");
          fd.append("language", "pt");
          const res = await fetch("/api/transcribe", { method: "POST", body: fd });
          if (!res.ok) throw new Error(await res.text());
          const data = (await res.json()) as { text: string };
          if (data.text) onChange((value ? value + " " : "") + data.text);
        } catch (err) {
          setRecError((err as Error).message);
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
    } catch (err) {
      setRecError((err as Error).message);
    }
  };

  const stopRec = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <div className="px-4 md:px-8 pb-6 pt-2">
      <div className="max-w-3xl mx-auto">
        <motion.div
          layout
          className="relative group"
        >
          <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-primary/40 to-primary/10 opacity-0 group-focus-within:opacity-100 blur-md transition-opacity duration-500 pointer-events-none" />
          <div className="relative rounded-2xl border border-white/10 bg-[#15151b] shadow-[0_8px_40px_-12px_rgba(0,0,0,0.5)] transition-colors group-focus-within:border-white/20">
            <Textarea
              ref={ref}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              disabled={transcribing}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!loading && value.trim()) onSubmit();
                }
              }}
              placeholder={
                transcribing
                  ? "Transcrevendo áudio…"
                  : recording
                    ? "Gravando… clique no microfone para parar"
                    : "Pergunte ao Octopus…"
              }
              rows={1}
              className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 px-5 pt-4 pb-2 text-sm leading-relaxed max-h-[200px] placeholder:text-muted-foreground/70"
            />
            <div className="flex items-center justify-between px-3 pb-3 pt-1 border-t border-white/5">
              <div className="flex items-center gap-1">
                <AnimatePresence mode="popLayout">
                  {recording ? (
                    <motion.div
                      key="rec"
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.7, opacity: 0 }}
                    >
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={stopRec}
                        aria-label="Parar gravação"
                        className="h-8 w-8 rounded-lg"
                      >
                        <motion.span
                          animate={{ scale: [1, 1.3, 1] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                          className="h-2 w-2 rounded-full bg-white"
                        />
                      </Button>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="mic"
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.7, opacity: 0 }}
                    >
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={startRec}
                        disabled={loading || transcribing}
                        aria-label="Gravar áudio"
                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5"
                      >
                        {transcribing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                      </Button>
                    </motion.div>
                  )}
                </AnimatePresence>
                {onCall && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={onCall}
                    disabled={loading || transcribing || recording}
                    aria-label="Ligar"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5"
                  >
                    <Phone className="h-4 w-4" />
                  </Button>
                )}
              </div>


              {loading ? (
                <Button
                  size="icon"
                  variant="destructive"
                  onClick={onStop}
                  aria-label="Parar"
                  className="h-8 w-8 rounded-lg"
                >
                  <Square className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <motion.div whileTap={{ scale: 0.92 }}>
                  <Button
                    size="icon"
                    onClick={onSubmit}
                    disabled={!value.trim() || transcribing}
                    aria-label="Enviar"
                    className="h-8 w-8 rounded-lg glow-primary"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
        <p className="text-[10px] text-muted-foreground/70 text-center mt-3 tracking-wide">
          {recError ? (
            <span className="text-destructive">⚠️ {recError}</span>
          ) : (
            "IA pode cometer erros. Confira informações importantes."
          )}
        </p>
      </div>
    </div>
  );
}
