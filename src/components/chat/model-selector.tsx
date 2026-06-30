import { MODELS, getModel, type ModelInfo } from "@/lib/models";
import { AUTO_MODEL_ID } from "@/lib/router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Gauge, Sparkles } from "lucide-react";

export function ModelSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const isAuto = value === AUTO_MODEL_ID;
  const current = isAuto ? null : getModel(value);
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_MODEL_ID}>
            <div className="flex flex-col">
              <span className="font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> Auto (IQ)
              </span>
              <span className="text-xs text-muted-foreground">
                Escolhe o melhor modelo por intenção
              </span>
            </div>
          </SelectItem>
          {MODELS.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              <div className="flex flex-col">
                <span className="font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {current ? <ModelMeta model={current} /> : <AutoBadge />}
    </div>
  );
}

function ModelMeta({ model }: { model: ModelInfo }) {
  return (
    <div className="hidden md:flex items-center gap-1.5">
      <Badge variant="secondary" className="gap-1">
        <Gauge className="h-3 w-3" /> {model.contextK}K ctx
      </Badge>
    </div>
  );
}

function AutoBadge() {
  return (
    <div className="hidden md:flex items-center gap-1.5">
      <Badge variant="secondary" className="gap-1">
        <Sparkles className="h-3 w-3" /> adaptativo
      </Badge>
    </div>
  );
}
