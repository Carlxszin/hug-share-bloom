import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  X,
  TrendingUp,
  Zap,
  DollarSign,
  ThumbsUp,
  ThumbsDown,
  Wrench,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearMetrics, useMetrics, type Intent } from "@/lib/metrics";
import { computeVariantStats } from "@/lib/ab-prompts";

const INTENT_LABEL: Record<Intent, string> = {
  chat: "Conversa",
  code: "Código",
  search: "Pesquisa",
  image: "Imagem",
  calc: "Cálculo",
  voice: "Voz",
  agent: "Agente",
  builder: "Builder",
};

export function IntelligenceButton({ onClick }: { onClick: () => void }) {
  const { rollup } = useMetrics();
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onClick}
      aria-label="Painel de inteligência"
      className="relative h-8 w-8 rounded-full hover:bg-white/[0.06]"
    >
      <Brain className="h-4 w-4" />
      {rollup.count > 0 && (
        <span className="absolute -bottom-0.5 -right-0.5 text-[9px] font-bold tabular-nums bg-primary text-primary-foreground rounded-full px-1 leading-tight">
          {rollup.iq}
        </span>
      )}
    </Button>
  );
}

export function IntelligencePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, rollup } = useMetrics();
  const [tab, setTab] = useState<"overview" | "models" | "intents" | "variants" | "raw">("overview");

  const recent = useMemo(() => items.slice(-20).reverse(), [items]);
  const variantStats = useMemo(() => computeVariantStats(), [items]);
  const bestVariant = useMemo(() => {
    const mature = variantStats.filter((v) => v.count >= 3);
    if (!mature.length) return null;
    return mature.reduce((a, b) => (b.score > a.score ? b : a));
  }, [variantStats]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 24 }}
            className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-3xl border bg-card text-card-foreground shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-primary/15 via-transparent to-success/10 border-b border-white/5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                    <Brain className="h-3.5 w-3.5" /> Inteligência do Octopus
                  </div>
                  <div className="mt-1 flex items-end gap-3">
                    <span className="text-5xl font-bold tabular-nums leading-none">{rollup.iq}</span>
                    <span className="text-sm text-muted-foreground pb-1">/ 100 IQ</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Baseado em {rollup.count} {rollup.count === 1 ? "turno" : "turnos"} mensurados.
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8 rounded-full">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat icon={<ThumbsUp className="h-3.5 w-3.5" />} label="Satisfação" value={`${Math.round(rollup.satisfaction * 100)}%`} hint={`${rollup.thumbsUp}👍 / ${rollup.thumbsDown}👎`} />
                <Stat icon={<Zap className="h-3.5 w-3.5" />} label="Latência p95" value={`${(rollup.p95LatencyMs / 1000).toFixed(1)}s`} hint={`média ${(rollup.avgLatencyMs / 1000).toFixed(1)}s`} />
                <Stat icon={<DollarSign className="h-3.5 w-3.5" />} label="Custo médio" value={`R$ ${rollup.avgCostBRL.toFixed(4)}`} hint={`total R$ ${rollup.totalCostBRL.toFixed(2)}`} />
                <Stat icon={<Wrench className="h-3.5 w-3.5" />} label="Ferramentas" value={`${Math.round(rollup.toolUseRate * 100)}%`} hint={`${Math.round(rollup.toolSuccessRate * 100)}% sucesso`} />
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-4 border-b border-white/5 text-sm">
              {(["overview", "intents", "models", "variants", "raw"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`relative px-3 py-2.5 transition-colors ${
                    tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "overview"
                    ? "Visão geral"
                    : t === "intents"
                      ? "Por intenção"
                      : t === "models"
                        ? "Por modelo"
                        : t === "variants"
                          ? "A/B prompts"
                          : "Recentes"}
                  {tab === t && (
                    <motion.div layoutId="iq-tab" className="absolute inset-x-2 -bottom-px h-px bg-primary" />
                  )}
                </button>
              ))}
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm("Apagar todas as métricas, chefe?")) clearMetrics();
                }}
                className="h-8 text-xs text-muted-foreground gap-1.5"
              >
                <Trash2 className="h-3 w-3" /> Limpar
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
              {rollup.count === 0 && (
                <div className="text-center py-16 text-muted-foreground text-sm">
                  Ainda sem dados, chefe. Mande algumas mensagens e o painel ganha vida.
                </div>
              )}

              {tab === "overview" && rollup.count > 0 && (
                <div className="space-y-4 text-sm">
                  <Row label="Self-score médio" value={`${(rollup.avgSelfScore * 100).toFixed(0)}%`} hint="Auto-avaliação interna (0–100%)" />
                  <Row label="Cache semântico" value={`${Math.round(rollup.cacheHitRate * 100)}%`} hint="Respostas reaproveitadas sem custo" />
                  <Row label="Sucesso de ferramentas" value={`${Math.round(rollup.toolSuccessRate * 100)}%`} hint="Tools que retornaram sem erro" />
                  <div className="pt-3 border-t border-white/5 text-xs text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="h-3 w-3" />
                    A meta é IQ ≥ 80. Cada melhoria (roteador, self-critique, cache) move este número.
                  </div>
                </div>
              )}

              {tab === "intents" && (
                <div className="grid gap-2">
                  {(Object.keys(rollup.byIntent) as Intent[])
                    .sort((a, b) => rollup.byIntent[b].count - rollup.byIntent[a].count)
                    .map((k) => {
                      const x = rollup.byIntent[k];
                      return (
                        <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
                          <div className="font-medium">{INTENT_LABEL[k]}</div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                            <span>{x.count} turnos</span>
                            <span>{(x.avgLatencyMs / 1000).toFixed(1)}s</span>
                            <span>R$ {x.avgCostBRL.toFixed(4)}</span>
                            <span>{Math.round(x.satisfaction * 100)}% 👍</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {tab === "models" && (
                <div className="grid gap-2">
                  {Object.keys(rollup.byModel)
                    .sort((a, b) => rollup.byModel[b].count - rollup.byModel[a].count)
                    .map((m) => {
                      const x = rollup.byModel[m];
                      return (
                        <div key={m} className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5">
                          <div className="font-mono text-xs">{m}</div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                            <span>{x.count}×</span>
                            <span>R$ {x.avgCostBRL.toFixed(4)}</span>
                            <span>{Math.round(x.satisfaction * 100)}% 👍</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}

              {tab === "variants" && (
                <div className="space-y-3">
                  {bestVariant && bestVariant.count >= 3 && (
                    <div className="text-xs px-3 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary-foreground/90">
                      🏆 Vencedora atual: <span className="font-semibold">{bestVariant.label}</span> · score {(bestVariant.score * 100).toFixed(0)}
                    </div>
                  )}
                  <div className="grid gap-2">
                    {variantStats
                      .sort((a, b) => b.score - a.score)
                      .map((v) => (
                        <div key={v.id} className="px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/5">
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-sm">{v.label}</div>
                            <div className="text-xs text-muted-foreground tabular-nums">{v.count}× usos</div>
                          </div>
                          <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                            <span>👍 {Math.round(v.satisfaction * 100)}%</span>
                            <span>🧠 {Math.round(v.avgSelfScore * 100)}%</span>
                            <span>⚡ {(v.avgLatencyMs / 1000).toFixed(1)}s</span>
                            <span>R$ {v.avgCostBRL.toFixed(4)}</span>
                            <span className="ml-auto text-foreground font-semibold">score {(v.score * 100).toFixed(0)}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    O Octopus testa estas variantes do system prompt (epsilon-greedy 20% exploração) e converge para a melhor por satisfação + self-score.
                  </div>
                </div>
              )}


              {tab === "raw" && (
                <div className="space-y-1.5 font-mono text-[11px]">
                  {recent.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02] border border-white/5">
                      <span className="text-muted-foreground">{new Date(m.ts).toLocaleTimeString()}</span>
                      <span className="text-primary">{m.intent}</span>
                      <span className="truncate flex-1">{m.model}</span>
                      <span className="text-muted-foreground">{(m.latencyMs / 1000).toFixed(1)}s</span>
                      <span className="text-muted-foreground">R${m.costBRL.toFixed(4)}</span>
                      {m.thumb === 1 && <ThumbsUp className="h-3 w-3 text-success" />}
                      {m.thumb === -1 && <ThumbsDown className="h-3 w-3 text-destructive" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground tabular-nums">{hint}</div>}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5">
      <div>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
