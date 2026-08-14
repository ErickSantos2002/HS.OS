import { useNavigate } from "react-router-dom";
import { Bot, Crown, MessageSquare, X } from "lucide-react";
import type { GatewayAgent } from "@/hooks/use-agents";

/**
 * O que o colaborador vê ao clicar num agente no mapa.
 *
 * ⚠️ **Existe para não reusar o `AgentDetailPanel` com condicionais.** Aquele
 * tem 1700 linhas e ~15 seções — custo, crons, integrações, guardrails, sessões,
 * usuários recentes — e esconder seção por seção é onde se esquece uma. Aqui a
 * regra é a outra: só entra o que já veio no `GET /agents`, que é filtrado por
 * `_pode_ver` e não devolve `systemPrompt` nem consumo.
 *
 * Se um dia isto precisar de mais um dado, o dado tem que vir de um endpoint
 * aberto ao colaborador — não de um `exige_papel("administrador")` afrouxado.
 */
interface Props {
  agent: GatewayAgent;
  avatar: string | null;
  onClose: () => void;
}

const ROTULO_STATUS: Record<string, { texto: string; cor: string }> = {
  active: { texto: "Ativo", cor: "hsl(160 84% 39%)" },
  inactive: { texto: "Inativo", cor: "hsl(0 0% 45%)" },
  recent: { texto: "Ocioso", cor: "hsl(38 92% 50%)" },
};

export default function AgentResumoPanel({ agent, avatar, onClose }: Props) {
  const navigate = useNavigate();
  const status = ROTULO_STATUS[agent.status] ?? ROTULO_STATUS.recent;

  return (
    <div
      className="absolute inset-y-0 right-0 w-[420px] z-30 animate-slide-in-right backdrop-blur-2xl border-l border-border flex flex-col rounded-l-2xl overflow-hidden"
      style={{ background: "hsl(0 0% 6% / 0.95)" }}
    >
      <div className="p-4 border-b border-border/50 flex items-center justify-between shrink-0">
        <h3 className="text-sm font-display font-bold text-foreground">Sobre o agente</h3>
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="h-7 w-7 rounded-xl bg-secondary/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <section className="glass-card-glow rounded-2xl p-4 relative">
          <div className="glass-card-glow-effect" />
          <div className="relative z-10 flex items-start gap-3">
            <div className="shrink-0">
              {avatar ? (
                <img
                  src={avatar}
                  alt={agent.name}
                  className="h-16 w-16 rounded-2xl object-cover border-2"
                  style={{ borderColor: status.cor }}
                />
              ) : (
                <div
                  className="h-16 w-16 rounded-2xl flex items-center justify-center border-2 bg-gradient-to-br from-card to-secondary text-2xl"
                  style={{ borderColor: status.cor }}
                >
                  {agent.emoji || <Bot className="h-7 w-7 text-muted-foreground" />}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-foreground truncate">{agent.name}</h2>
                {agent.isLeader && (
                  <Crown className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Orquestrador" />
                )}
              </div>
              {agent.specialty && (
                <p className="text-xs text-muted-foreground mt-0.5">{agent.specialty}</p>
              )}
              <div className="flex items-center gap-1.5 mt-2">
                <span className="h-2 w-2 rounded-full" style={{ background: status.cor }} />
                <span className="text-[11px] font-mono text-muted-foreground">{status.texto}</span>
                {agent.department && (
                  <span className="text-[11px] font-mono text-muted-foreground">
                    · {agent.department}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {agent.description && (
          <section className="glass-card rounded-2xl p-4">
            <h4 className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-[0.2em] mb-2">
              O que ele faz
            </h4>
            <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">
              {agent.description}
            </p>
          </section>
        )}

        <button
          onClick={() => navigate(`/chat?agent=${encodeURIComponent(agent.id)}`)}
          className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
        >
          <MessageSquare className="h-4 w-4" />
          Conversar com {agent.name}
        </button>
      </div>
    </div>
  );
}
