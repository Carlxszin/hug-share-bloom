import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Globe,
  Camera,
  Loader2,
  Check,
  AlertTriangle,
  ExternalLink,
  Database,
  GitCompare,
  Calculator,

} from "lucide-react";
import type { AgentStep, AgentTool } from "@/lib/storage";

const TOOL_META: Record<AgentTool, { icon: typeof Search; label: string }> = {
  web_search: { icon: Search, label: "Pesquisa" },
  fetch_page: { icon: Globe, label: "Leitura" },
  screenshot: { icon: Camera, label: "Screenshot" },
  extract_structured: { icon: Database, label: "Extração" },
  compare_pages: { icon: GitCompare, label: "Comparação" },
  calculate: { icon: Calculator, label: "Cálculo" },
};

export function AgentView({
  steps,
  streaming,
}: {
  steps: AgentStep[];
  streaming: boolean;
}) {
  return (
    <div className="h-full flex flex-col bg-background/40">
      <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Execução do Agente
        </div>
        {streaming && (
          <div className="flex items-center gap-1.5 text-[11px] text-primary">
            <Loader2 className="h-3 w-3 animate-spin" /> trabalhando…
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-3">
        {steps.length === 0 ? (
          <div className="text-xs text-muted-foreground/70 text-center mt-12">
            Os passos do agente aparecerão aqui.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {steps.map((s) => (
              <StepCard key={s.id} step={s} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: AgentStep }) {
  const meta = TOOL_META[step.tool] ?? { icon: Search, label: step.tool };
  const Icon = meta.icon;
  const label = meta.label;
  const arg =
    (step.input?.query as string) ??
    (step.input?.url as string) ??
    (step.input?.expression as string) ??
    (Array.isArray(step.input?.urls)
      ? (step.input.urls as string[]).join(", ")
      : "") ??
    "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={
            "h-7 w-7 rounded-md flex items-center justify-center shrink-0 " +
            (step.ok === false
              ? "bg-destructive/15 text-destructive"
              : "bg-primary/10 text-primary border border-primary/20")
          }
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            {label}
            {step.cached && (
              <span className="px-1.5 py-0.5 rounded bg-success/15 text-success text-[9px] tracking-wider">
                CACHE
              </span>
            )}
            {step.ok === false ? (
              <AlertTriangle className="h-3 w-3 text-destructive" />
            ) : (
              <Check className="h-3 w-3 text-success" />
            )}
          </div>
          <div className="text-xs text-foreground/90 mt-0.5 font-mono break-all line-clamp-2">
            {arg}
          </div>
          {step.result && (
            <div className="text-[11px] text-muted-foreground mt-1">{step.result}</div>
          )}
          {step.error && (
            <div className="text-[11px] text-destructive mt-1">{step.error}</div>
          )}
          {step.links && step.links.length > 0 && (
            <ul className="mt-2 space-y-1">
              {step.links.slice(0, 5).map((l, i) => (
                <li key={i} className="text-[11px]">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    <span className="line-clamp-1">{l.title || l.url}</span>
                  </a>
                  {l.snippet && (
                    <div className="text-muted-foreground/80 line-clamp-2 pl-3.5">
                      {l.snippet}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {step.screenshotUrl && (
            <a
              href={step.screenshotUrl}
              target="_blank"
              rel="noreferrer"
              className="block mt-2 rounded-lg overflow-hidden border border-white/10"
            >
              <img
                src={step.screenshotUrl}
                alt="screenshot"
                className="w-full h-auto"
                loading="lazy"
              />
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
}
