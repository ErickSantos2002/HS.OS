import { useState } from "react";
import { Bot, ChevronDown, ChevronUp, Crown, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";

/** Agent colors for debate mode */
const AGENT_COLORS = [
  { bg: "bg-blue-500/15", border: "border-blue-500/30", text: "text-blue-400", dot: "bg-blue-400", name: "blue" },
  { bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-400", dot: "bg-emerald-400", name: "emerald" },
  { bg: "bg-amber-500/15", border: "border-amber-500/30", text: "text-amber-400", dot: "bg-amber-400", name: "amber" },
  { bg: "bg-purple-500/15", border: "border-purple-500/30", text: "text-purple-400", dot: "bg-purple-400", name: "purple" },
  { bg: "bg-rose-500/15", border: "border-rose-500/30", text: "text-rose-400", dot: "bg-rose-400", name: "rose" },
  { bg: "bg-cyan-500/15", border: "border-cyan-500/30", text: "text-cyan-400", dot: "bg-cyan-400", name: "cyan" },
  { bg: "bg-orange-500/15", border: "border-orange-500/30", text: "text-orange-400", dot: "bg-orange-400", name: "orange" },
];

export function getAgentColor(index: number) {
  return AGENT_COLORS[index % AGENT_COLORS.length];
}

export interface DebateResponse {
  agentId: string;
  agentName: string;
  roleName: string | null;
  content: string;
  loading?: boolean;
  isSynthesis?: boolean;
}

interface Props {
  question: string;
  responses: DebateResponse[];
  roundNumber: number;
  onNewRound?: () => void;
  isComplete?: boolean;
  allAgentIds?: string[];
}

/** Highlight agent name references in content */
function highlightAgentRefs(content: string, agentIds: string[]): string {
  let result = content;
  for (const id of agentIds) {
    // Case-insensitive replace agent names with bold
    const regex = new RegExp(`\\b(${id})\\b`, "gi");
    result = result.replace(regex, "**$1**");
  }
  return result;
}

export default function DebateCards({ question, responses, roundNumber, onNewRound, isComplete, allAgentIds = [] }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const synthesis = responses.find((r) => r.isSynthesis);
  const debateResponses = responses.filter((r) => !r.isSynthesis);
  const anyLoading = responses.some((r) => r.loading);

  return (
    <div className="space-y-2">
      {/* Round label */}
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border/30" />
        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Rodada {roundNumber}
        </span>
        <div className="h-px flex-1 bg-border/30" />
      </div>

      {/* Question */}
      {question && (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground">
            {question}
          </div>
        </div>
      )}

      {/* Sequential debate responses — timeline style */}
      <div className="relative pl-4 space-y-2">
        {/* Timeline line */}
        <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border/40" />

        {debateResponses.map((r, i) => {
          const color = getAgentColor(
            allAgentIds.length > 0 ? allAgentIds.indexOf(r.agentId) : i
          );
          const key = `${roundNumber}-${r.agentId}`;
          const isCollapsed = collapsed[key];

          return (
            <div key={key} className="relative flex gap-3">
              {/* Timeline dot */}
              <div className={`relative z-10 mt-2.5 h-3 w-3 rounded-full ${color.dot} shrink-0 ring-2 ring-background`} />

              <div className={`flex-1 rounded-xl border ${color.border} ${color.bg} overflow-hidden transition-all`}>
                {/* Header */}
                <button
                  onClick={() => toggleCollapse(key)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                >
                  <div className={`h-6 w-6 rounded-full flex items-center justify-center ${color.bg}`}>
                    <Bot className={`h-3 w-3 ${color.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-xs font-semibold ${color.text}`}>{r.agentId}</span>
                    {r.roleName && (
                      <span className="text-[10px] text-muted-foreground ml-1.5">· {r.roleName}</span>
                    )}
                    {i > 0 && !r.loading && (
                      <span className="text-[9px] text-muted-foreground/60 ml-1.5">
                        (respondendo aos anteriores)
                      </span>
                    )}
                  </div>
                  {r.loading ? (
                    <div className="flex gap-1">
                      <div className={`h-1.5 w-1.5 rounded-full ${color.dot} animate-pulse`} />
                      <div className={`h-1.5 w-1.5 rounded-full ${color.dot} animate-pulse [animation-delay:0.2s]`} />
                      <div className={`h-1.5 w-1.5 rounded-full ${color.dot} animate-pulse [animation-delay:0.4s]`} />
                    </div>
                  ) : (
                    isCollapsed ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronUp className="h-3 w-3 text-muted-foreground" />
                  )}
                </button>

                {/* Content */}
                {!isCollapsed && !r.loading && r.content && (
                  <div className="px-3 pb-3">
                    <div className="prose prose-sm prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 text-xs leading-relaxed">
                      <ReactMarkdown>
                        {allAgentIds.length > 0 ? highlightAgentRefs(r.content, allAgentIds) : r.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Synthesis card */}
      {synthesis && (
        <div className="mt-3">
          {synthesis.loading ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 flex items-center gap-2">
              <Crown className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-xs text-muted-foreground">Gerando síntese...</span>
              <div className="flex gap-1 ml-auto">
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.2s]" />
                <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse [animation-delay:0.4s]" />
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/20">
                <Crown className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold text-primary">Síntese · {synthesis.agentId}</span>
                {synthesis.roleName && (
                  <span className="text-[10px] text-muted-foreground">· {synthesis.roleName}</span>
                )}
              </div>
              <div className="px-3 py-3">
                <div className="prose prose-sm prose-invert max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 text-xs leading-relaxed">
                  <ReactMarkdown>
                    {allAgentIds.length > 0 ? highlightAgentRefs(synthesis.content, allAgentIds) : synthesis.content}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* New round button */}
      {isComplete && !anyLoading && onNewRound && (
        <div className="flex justify-center pt-2">
          <button
            onClick={onNewRound}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Nova rodada
          </button>
        </div>
      )}
    </div>
  );
}
