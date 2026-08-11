import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, Users } from "lucide-react";
import AgentDetailPanel from "@/components/agents/AgentDetailPanel";
import AgentFilesSection from "@/components/agents/AgentFilesSection";
import OnboardingDoLiderLog from "@/components/agents/OnboardingDoLiderLog";

import { useAgents } from "@/hooks/use-agents";
import { useAllAvatars } from "@/hooks/use-agent-avatar";
import { normalizeAgentId, getAgentDisplayNameById } from "@/lib/active-agents";

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const decodedId = decodeURIComponent(agentId || "");
  const { agents } = useAgents();
  const avatars = useAllAvatars();

  const currentShort = normalizeAgentId(decodedId);
  const others = agents.filter((a) => normalizeAgentId(a.id) !== currentShort);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link
          to="/agents"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar aos Super agentes
        </Link>
      </div>

      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          <AgentDetailPanel agentId={decodedId} fullWidth />
          <AgentFilesSection agentId={decodedId} />
          <OnboardingDoLiderLog agentId={decodedId} />
        </div>


        {/* Other agents */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 glass-card rounded-2xl p-3 flex-col">
          <div className="flex items-center gap-2 px-1 mb-3">
            <Users className="h-3.5 w-3.5 text-primary" />
            <h2 className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-[0.2em]">
              Outros Super agentes
            </h2>
            <span className="ml-auto text-[10px] font-mono text-muted-foreground">{others.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
            {others.map((agent) => {
              const shortId = normalizeAgentId(agent.id);
              const isActive = agent.status === "active";
              const avatarUrl = avatars[agent.id] ?? avatars[shortId];
              return (
                <button
                  key={agent.id}
                  onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                  className="w-full text-left rounded-2xl p-3 transition-all duration-200 border bg-card/30 border-transparent hover:bg-card/60 hover:border-border"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="relative shrink-0">
                      <div
                        className="h-9 w-9 rounded-xl flex items-center justify-center overflow-hidden border bg-gradient-to-br from-card to-secondary"
                        style={{
                          borderColor: isActive
                            ? "hsl(160 84% 39%)"
                            : agent.status === "inactive"
                            ? "hsl(0 0% 22%)"
                            : "hsl(38 80% 45%)",
                        }}
                      >
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt={agent.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Bot className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div
                        className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${
                          isActive
                            ? "bg-success"
                            : agent.status === "inactive"
                            ? "bg-muted-foreground"
                            : "bg-warning"
                        }`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-display font-bold text-foreground truncate">
                        {getAgentDisplayNameById(agent.id, agent.name)}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate font-mono">
                        {agent.model}
                      </div>
                    </div>
                    <span
                      className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-lg tracking-wider shrink-0 ${
                        isActive
                          ? "bg-success/15 text-success"
                          : agent.status === "inactive"
                          ? "bg-muted/50 text-muted-foreground"
                          : "bg-warning/15 text-warning"
                      }`}
                    >
                      {isActive ? "ACTIVE" : agent.status === "inactive" ? "OFF" : "STALE"}
                    </span>
                  </div>
                </button>
              );
            })}
            {others.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Nenhum outro agente</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
