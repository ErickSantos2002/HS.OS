import { useArenaTemplates, type ArenaTemplate } from "@/hooks/use-arena-templates";
import { Swords, Sparkles, Megaphone, Brain, Search, Settings, Target, LayoutTemplate, type LucideIcon } from "lucide-react";

const EMOJI_ICON_MAP: Record<string, LucideIcon> = {
  "📣": Megaphone,
  "📢": Megaphone,
  "🧠": Brain,
  "🔍": Search,
  "🔎": Search,
  "⚙️": Settings,
  "⚙": Settings,
  "🎯": Target,
};

function TemplateIcon({ emoji }: { emoji: string | null }) {
  const Icon = (emoji && EMOJI_ICON_MAP[emoji]) || LayoutTemplate;
  return (
    <span className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
      <Icon className="h-3.5 w-3.5 text-primary" />
    </span>
  );
}


interface Props {
  onSelect: (template: ArenaTemplate) => void;
  onSkip: () => void;
}

export default function TemplateSelector({ onSelect, onSkip }: Props) {
  const { templates, loading } = useArenaTemplates();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="text-center space-y-3">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mx-auto">
          <Swords className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground">Criar Nova Arena</h1>
        <p className="text-sm text-muted-foreground">Escolha um template ou comece do zero</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t)}
            className="text-left p-4 rounded-xl border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all group"
          >
            <div className="flex items-center gap-2 mb-2">
              <TemplateIcon emoji={t.emoji} />
              <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                {t.name}
              </h3>
            </div>

            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{t.description}</p>
            <div className="flex flex-wrap gap-1">
              {t.agents.slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  className="px-2 py-0.5 rounded-full bg-secondary/60 text-[10px] text-muted-foreground"
                >
                  {a.name} · {a.role}
                </span>
              ))}
              {t.agents.length > 3 && (
                <span className="px-2 py-0.5 rounded-full bg-secondary/60 text-[10px] text-muted-foreground">
                  +{t.agents.length - 3}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onSkip}
        className="w-full py-3 rounded-xl border border-border/60 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary/30 transition-colors flex items-center justify-center gap-2"
      >
        <Sparkles className="h-4 w-4" />
        Começar do zero com IA
      </button>
    </div>
  );
}
