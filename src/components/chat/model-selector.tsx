import { MODELS, getModel, type ModelInfo } from "@/lib/models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Zap, Brain, Gauge } from "lucide-react";

export function ModelSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const current = getModel(value);
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
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
      <ModelMeta model={current} />
    </div>
  );
}

function ModelMeta({ model }: { model: ModelInfo }) {
  return (
    <div className="hidden md:flex items-center gap-1.5">
      <Badge variant="secondary" className="gap-1">
        <Zap className="h-3 w-3" /> {model.speed}
      </Badge>
      <Badge variant="secondary" className="gap-1">
        <Brain className="h-3 w-3" /> {model.reasoning}
      </Badge>
      <Badge variant="secondary" className="gap-1">
        <Gauge className="h-3 w-3" /> {model.contextK}K ctx
      </Badge>
    </div>
  );
}
