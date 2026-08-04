import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getContextWindowFor, getModelLabel, DEFAULT_CONTEXT_WINDOW } from "@/lib/model-pricing";
import { useGatewayModels } from "@/hooks/use-gateway-models";
import { getModelOverride, MODEL_OVERRIDE_EVENT } from "@/lib/agent-model-override";

interface Props {
  agentId: string;
  /**
   * Slot renderizado à esquerda do badge, na mesma linha (usado pelo
   * ModelSelector). Fica aqui, e não como irmão no ChatPage, porque este
   * componente é `w-full` e dono do próprio espaçamento — compor por fora
   * duplicaria o padding e desalinharia a barra de progresso.
   */
  actions?: React.ReactNode;
}

interface CtxData {
  contextTokens: number;
  contextWindow: number;
  cacheRead: number;
  cacheWrite: number;
  estimatedCost: number;
  model: string | null;
  snapshotAt: string | null;
}

function colorFor(pct: number) {
  if (pct <= 60) return { ring: "hsl(142 71% 45%)", bg: "bg-emerald-500" };
  if (pct <= 80) return { ring: "hsl(38 92% 50%)", bg: "bg-amber-500" };
  return { ring: "hsl(0 84% 60%)", bg: "bg-red-500" };
}

function fmtK(n: number) {
  if (n < 1000) return `${n}`;
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

export function ContextWindowIndicator({ agentId, actions }: Props) {
  const [data, setData] = useState<CtxData | null>(null);
  // O snapshot reporta o modelo PADRÃO do agente. Se esta conversa escolheu
  // outro (ModelSelector), o modelo e a janela mudam — sem isso, os dois badges
  // do cabeçalho se contradiriam e o % seria calculado contra a janela errada.
  const { models: gatewayModels } = useGatewayModels();
  const [override, setOverride] = useState<string | null>(() => getModelOverride(agentId));

  useEffect(() => {
    setOverride(getModelOverride(agentId));
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (!detail?.agentId || detail.agentId === agentId) setOverride(getModelOverride(agentId));
    };
    window.addEventListener(MODEL_OVERRIDE_EVENT, onChange);
    return () => window.removeEventListener(MODEL_OVERRIDE_EVENT, onChange);
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    let alive = true;
    setData(null);
    const load = async () => {
      // Fonte VIVA (task #3/#19): agent_context_state é atualizada a cada 15
      // minutos pela varredura de sessões do gateway, que traz totalTokens
      // (quanto da janela está ocupado) e contextTokens (o tamanho dela).
      //
      // Antes lia agent_token_snapshots — um snapshot que a compactação nunca
      // invalidava: a barra marcava 96% com o agente respondendo "estou em 4%".
      // A sessão mais recente do agente é a que o usuário está vendo.
      const { data: row, error } = await supabase
        .from("agent_context_state")
        .select("total_tokens, context_tokens, model, updated_at")
        .eq("agent_id", agentId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      const r: any = row;
      if (error || !r) {
        setData({ contextTokens: 0, contextWindow: DEFAULT_CONTEXT_WINDOW, cacheRead: 0, cacheWrite: 0, estimatedCost: 0, model: null, snapshotAt: null });
        return;
      }
      const model = (r.model ?? null) as string | null;
      // context_tokens é o TAMANHO da janela; total_tokens é o quanto dela
      // está ocupado — confirmado por sonda na VPS (30/07).
      const janela = Number(r.context_tokens) > 0
        ? Number(r.context_tokens)
        : getContextWindowFor(model);
      setData({
        contextTokens: Number(r.total_tokens ?? 0),
        contextWindow: janela,
        cacheRead: 0,
        cacheWrite: 0,
        estimatedCost: 0,
        model,
        snapshotAt: r.updated_at ?? null,
      });
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, [agentId]);

  // Sem snapshot ainda: esconde o badge de contexto, mas NÃO some com o slot —
  // o seletor de modelo não depende de snapshot e precisa continuar acessível.
  if (!data) {
    return actions ? (
      <div className="w-full">
        <div className="flex items-center justify-end gap-2 px-4 pt-2">{actions}</div>
      </div>
    ) : null;
  }

  // O override manda: é o modelo que esta conversa está de fato usando.
  const overrideModel = override ? gatewayModels.find((m) => m.qualifiedId === override) : null;
  const effectiveWindow = overrideModel?.contextWindow ?? data.contextWindow;
  const pct = Math.min(100, Math.round((data.contextTokens / effectiveWindow) * 100));
  const c = colorFor(pct);
  const modelLabel = overrideModel?.label ?? getModelLabel(data.model);
  const cost = Number.isFinite(data.estimatedCost) ? data.estimatedCost : 0;

  return (
    <div className="w-full">
      <div className="flex items-center justify-end gap-2 px-4 pt-2">
        {actions}
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-secondary/30 px-2.5 py-0.5 text-[10px] font-mono text-muted-foreground hover:bg-secondary/50 transition-colors"
              >
                {/* O nome do modelo saiu daqui: quem mostra (e deixa trocar) é
                    o ModelSelector, ao lado. Dois badges repetindo o modelo
                    seria ruído — e, pior, poderiam divergir. Continua no
                    tooltip abaixo. */}
                <span className="text-foreground/80">contexto {pct}%</span>
                <span className={`inline-block h-2 w-2 rounded-full ${c.bg}`} style={{ boxShadow: `0 0 8px ${c.ring}` }} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="w-72 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">janela de contexto</p>
                  <span className="text-[10px] text-muted-foreground">atualizado {timeAgo(data.snapshotAt)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div className={`h-full ${c.bg} transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <div className="space-y-1 pt-1 border-t border-border/40">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Tokens usados</span>
                    <span className="font-mono text-foreground">{fmtK(data.contextTokens)} / {fmtK(effectiveWindow)}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Cache hit</span>
                    <span className="font-mono text-foreground">{fmtK(data.cacheRead)} cached</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Modelo</span>
                    <span className="font-mono text-foreground truncate max-w-[150px]">{modelLabel}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">Custo estimado hoje</span>
                    <span className="font-mono text-foreground">${cost.toFixed(4)}</span>
                  </div>
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="px-4 pt-1.5">
        <div className="h-1 w-full rounded-full bg-secondary/40 overflow-hidden">
          <div className={`h-full ${c.bg} transition-all duration-300`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
