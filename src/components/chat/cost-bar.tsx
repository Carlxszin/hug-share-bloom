import { useEffect, useState } from "react";
import { getModel, costUSD } from "@/lib/models";
import { totalsByPeriod, type Conversation } from "@/lib/storage";

function fmtUSD(n: number) {
  return `$${n.toFixed(4)}`;
}
function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4 });
}

export function CostBar({
  conversation,
  rate,
}: {
  conversation: Conversation;
  rate: number;
}) {
  const [periods, setPeriods] = useState({ day: 0, month: 0 });

  useEffect(() => {
    setPeriods(totalsByPeriod());
  }, [conversation.messages.length]);

  const model = getModel(conversation.model);
  const tokens = conversation.messages.reduce(
    (acc, m) => {
      acc.in += m.inputTokens ?? 0;
      acc.out += m.outputTokens ?? 0;
      return acc;
    },
    { in: 0, out: 0 },
  );
  const conv = costUSD(model, tokens.in, tokens.out);
  const last = [...conversation.messages].reverse().find((m) => m.role === "assistant");
  const lastCost = last
    ? costUSD(model, last.inputTokens ?? 0, last.outputTokens ?? 0)
    : { total: 0 };

  return (
    <div className="px-6 md:px-8 py-3 border-b border-white/5 bg-white/[0.015]">
      <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px]">
        <Stat label="Última msg" usd={lastCost.total} brl={lastCost.total * rate} />
        <Divider />
        <Stat label="Conversa" usd={conv.total} brl={conv.total * rate} detail={`${tokens.in + tokens.out} tk`} />
        <Divider />
        <Stat label="Hoje" usd={periods.day} brl={periods.day * rate} />
        <Divider />
        <Stat label="Mês" usd={periods.month} brl={periods.month * rate} />
      </div>
    </div>
  );
}

function Divider() {
  return <span className="hidden sm:inline-block h-3 w-px bg-white/10" />;
}

function Stat({
  label,
  usd,
  brl,
  detail,
}: {
  label: string;
  usd: number;
  brl: number;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{label}</span>
      <span className="font-mono font-medium text-foreground">{fmtBRL(brl)}</span>
      <span className="font-mono text-muted-foreground/70">{fmtUSD(usd)}</span>
      {detail && <span className="text-muted-foreground/60">· {detail}</span>}
    </div>
  );
}
