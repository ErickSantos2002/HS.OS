import { Bot, User, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface MentionOption {
  id: string;
  name: string;
  type: "human" | "agent" | "all";
}

interface Props {
  options: MentionOption[];
  selected: number;
  visible: boolean;
  onSelect: (option: MentionOption) => void;
  onHover: (index: number) => void;
}

export default function MentionPopup({ options, selected, visible, onSelect, onHover }: Props) {
  if (!visible || options.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
      {options.map((opt, i) => (
        <button
          key={opt.id}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
            i === selected ? "bg-accent/20 text-accent-foreground" : "hover:bg-accent/10"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(opt);
          }}
          onMouseEnter={() => onHover(i)}
        >
          <div className="h-6 w-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
            {opt.type === "agent" ? (
              <Bot className="h-3 w-3" />
            ) : opt.type === "all" ? (
              <Users className="h-3 w-3" />
            ) : (
              <User className="h-3 w-3" />
            )}
          </div>
          <span className="truncate">{opt.name}</span>
          <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-auto shrink-0">
            {opt.type === "agent" ? "Agente" : opt.type === "all" ? "Todos" : "Humano"}
          </Badge>
        </button>
      ))}
    </div>
  );
}
