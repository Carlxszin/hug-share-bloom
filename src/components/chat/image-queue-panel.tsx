import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ImageIcon,
  X,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  enqueueImage,
  removeImageJob,
  useImageQueue,
  type ImageJob,
} from "@/lib/image-queue";
import { Button } from "@/components/ui/button";

export function ImageQueuePanel({
  className = "",
  position = "absolute",
}: {
  className?: string;
  position?: "absolute" | "fixed";
}) {
  const jobs = useImageQueue();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");

  const visible = jobs.filter(
    (j) => j.status !== "done" || Date.now() - j.createdAt < 1000 * 60 * 10,
  );
  const active = jobs.find((j) => j.status === "running");
  const queued = jobs.filter((j) => j.status === "queued");
  const finished = jobs.filter((j) => j.status === "done" || j.status === "error");

  if (visible.length === 0 && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${position} top-3 right-3 z-30 h-9 w-9 rounded-full bg-card/90 hover:bg-card border border-white/10 flex items-center justify-center text-muted-foreground hover:text-foreground transition ${className}`}
        aria-label="Abrir gerador de imagens"
      >
        <ImageIcon className="h-4 w-4" />
      </button>
    );
  }

  const submitDraft = () => {
    if (!draft.trim()) return;
    enqueueImage(draft.trim());
    setDraft("");
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`${position} top-3 right-3 z-30 w-[300px] rounded-2xl border border-white/10 bg-card shadow-2xl overflow-hidden ${className}`}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide">
          <ImageIcon className="h-3.5 w-3.5 text-primary" />
          Imagens
          {active && (
            <span className="text-[10px] text-primary/80">gerando…</span>
          )}
          {queued.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              +{queued.length} na fila
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Recolher" : "Expandir"}
        >
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
              {visible.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                  Peça uma imagem ("gera uma imagem de…") ou digite abaixo.
                </div>
              ) : (
                <div className="p-2 space-y-2">
                  {active && <JobCard job={active} />}
                  {queued.map((j) => (
                    <JobCard key={j.id} job={j} />
                  ))}
                  {finished.slice(-3).map((j) => (
                    <JobCard key={j.id} job={j} />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-white/5 p-2 flex items-center gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder="ex: um polvo neon em Tóquio"
                className="flex-1 bg-white/[0.04] rounded-md px-2.5 py-1.5 text-[11px] placeholder:text-muted-foreground/60 border border-white/5 focus:outline-none focus:border-primary/40"
              />
              <Button
                size="icon"
                onClick={submitDraft}
                disabled={!draft.trim()}
                className="h-7 w-7 rounded-md"
                aria-label="Adicionar à fila"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function JobCard({ job }: { job: ImageJob }) {
  const downloadName =
    job.prompt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40) || "imagem";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden"
    >
      <div className="relative aspect-square bg-black/40">
        {job.dataUrl ? (
          <img
            src={job.dataUrl}
            alt={job.prompt}
            className={`h-full w-full object-cover transition-[filter] duration-500 ${
              job.isFinal ? "blur-0" : "blur-xl scale-105"
            }`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            {job.status === "error" ? (
              <AlertCircle className="h-6 w-6 text-destructive" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </div>
        )}
        {job.status === "running" && !job.isFinal && (
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        )}
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
          <StatusBadge status={job.status} />
        </div>
        <button
          onClick={() => removeImageJob(job.id)}
          className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white/80 hover:text-white"
          aria-label="Remover"
        >
          <X className="h-3 w-3" />
        </button>
        {job.status === "done" && job.dataUrl && (
          <a
            href={job.dataUrl}
            download={`${downloadName}.png`}
            className="absolute bottom-1.5 right-1.5 h-6 w-6 rounded-full bg-primary/80 hover:bg-primary flex items-center justify-center text-primary-foreground"
            aria-label="Baixar"
          >
            <Download className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="px-2.5 py-1.5 text-[10.5px] text-foreground/80 line-clamp-2 leading-snug">
        {job.prompt}
      </div>
      {job.error && (
        <div className="px-2.5 pb-2 text-[10px] text-destructive line-clamp-2">
          {job.error}
        </div>
      )}
    </motion.div>
  );
}

function StatusBadge({ status }: { status: ImageJob["status"] }) {
  const map: Record<ImageJob["status"], { label: string; cls: string; icon: ReactNode }> = {
    queued: {
      label: "Fila",
      cls: "bg-muted/70 text-muted-foreground",
      icon: <Loader2 className="h-2.5 w-2.5" />,
    },
    running: {
      label: "Criando",
      cls: "bg-primary/80 text-primary-foreground",
      icon: <Loader2 className="h-2.5 w-2.5 animate-spin" />,
    },
    done: {
      label: "Pronto",
      cls: "bg-success/80 text-white",
      icon: <CheckCircle2 className="h-2.5 w-2.5" />,
    },
    error: {
      label: "Erro",
      cls: "bg-destructive/80 text-white",
      icon: <AlertCircle className="h-2.5 w-2.5" />,
    },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}
