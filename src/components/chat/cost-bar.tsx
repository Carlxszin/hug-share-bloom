import { useEffect, useState } from "react";
import { getModel, costUSD } from "@/lib/models";
import { totalsByPeriod, type Conversation } from "@/lib/storage";
import { DollarSign, TrendingUp, Calendar } from "lucide-react";

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
    : { input: 0, output: 0, total: 0 };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2 border-b bg-muted/30 text-xs">
      <Stat
        icon={<DollarSign className="h-3.5 w-3.5" />}
        label="Última msg"
        usd={lastCost.total}
        brl={lastCost.total * rate}
        detail={`in ${last?.inputTokens ?? 0} / out ${last?.outputTokens ?? 0}`}
      />
      <Stat
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Conversa"
        usd={conv.total}
        brl={conv.total * rate}
        detail={`${tokens.in + tokens.out} tokens`}
      />
      <Stat
        icon={<Calendar className="h-3.5 w-3.5" />}
        label="Hoje"
        usd={periods.day}
        brl={periods.day * rate}
      />
      <Stat
        icon={<Calendar className="h-3.5 w-3.5" />}
        label="Mês"
        usd={periods.month}
        brl={periods.month * rate}
      />
    </div>
  );
}

function Stat({
  icon,
  label,
  usd,
  brl,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  usd: number;
  brl: number;
  detail?: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="font-mono font-medium text-foreground">{fmtBRL(brl)}</div>
      <div className="text-[10px] text-muted-foreground font-mono">
        {fmtUSD(usd)}
        {detail ? ` · ${detail}` : ""}
      </div>
    </div>
  );
}
