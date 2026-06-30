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
    <div className="px-6 md:px-8 py-2 border-b border-white/5">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-4 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2 font-mono">
          <span className="text-foreground font-medium">{fmtBRL(conv.total * rate)}</span>
          <span className="text-muted-foreground/50">nesta conversa</span>
          <span className="text-muted-foreground/40">· {tokens.in + tokens.out} tk</span>
          {lastCost.total > 0 && (
            <span className="text-muted-foreground/40">· última {fmtBRL(lastCost.total * rate)}</span>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-3 font-mono">
          <span>Hoje <span className="text-foreground/80">{fmtBRL(periods.day * rate)}</span></span>
          <span className="text-muted-foreground/30">|</span>
          <span>Mês <span className="text-foreground/80">{fmtBRL(periods.month * rate)}</span></span>
        </div>
      </div>
    </div>
  );
}

