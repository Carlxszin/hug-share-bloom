import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Mic, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  loading: boolean;
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
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
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
    <div className="border-t bg-background/80 backdrop-blur-sm p-3">
      <motion.div
        layout
        className="relative max-w-3xl mx-auto rounded-2xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition"
      >
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
                ? "Gravando…  clique no microfone para parar"
                : "Pergunte qualquer coisa…  (Enter envia, Shift+Enter quebra linha)"
          }
          rows={1}
          className="resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 pr-24 max-h-[200px]"
        />
        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
          <AnimatePresence mode="popLayout">
            {recording ? (
              <motion.div
                key="recording"
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.7, opacity: 0 }}
              >
                <Button
                  size="icon"
                  variant="destructive"
                  onClick={stopRec}
                  aria-label="Parar gravação"
                  className="rounded-full"
                >
                  <motion.span
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                    className="h-2.5 w-2.5 rounded-full bg-white"
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
                  className="rounded-full"
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

          {loading ? (
            <Button
              size="icon"
              variant="destructive"
              onClick={onStop}
              aria-label="Parar"
              className="rounded-full"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={onSubmit}
              disabled={!value.trim() || transcribing}
              aria-label="Enviar"
              className="rounded-full"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </motion.div>
      <p className="text-[10px] text-muted-foreground text-center mt-2">
        {recError ? (
          <span className="text-destructive">⚠️ {recError}</span>
        ) : (
          "IA pode cometer erros. Confira informações importantes."
        )}
      </p>
    </div>
  );
}
