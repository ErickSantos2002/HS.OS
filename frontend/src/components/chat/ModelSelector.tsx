import { useEffect, useState } from "react";
import { Check, ChevronDown, Cpu, AlertTriangle } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGatewayModels, type GatewayModel } from "@/hooks/use-gateway-models";
import { connectorLogoUrl, getConnectorTemplate } from "@/lib/connector-templates";
import {
  getModelOverride,
  setModelOverride,
  MODEL_OVERRIDE_EVENT,
} from "@/lib/agent-model-override";
import { cn } from "@/lib/utils";

interface Props {
  agentId: string;
  className?: string;
}

/** Rótulo do provedor, para agrupar a lista. */
const PROVIDER_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google",
};

/**
 * Logo do provedor. Reusa o catálogo de conectores — os ids de provedor
 * ("deepseek", "openai", "anthropic", "gemini") são os mesmos ids de template,
 * então a marca já está disponível sem cadastrar nada novo.
 */
function ProviderLogo({ provider, size = 14 }: { provider: string; size?: number }) {
  const template = getConnectorTemplate(provider);
  const url = template ? connectorLogoUrl(template) : null;
  if (!url) return <Cpu className="shrink-0 opacity-70" style={{ width: size, height: size }} />;
  return (
    <img
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      className="shrink-0 rounded-sm object-contain"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Seletor de LLM da CONVERSA.
 *
 * Escopo: troca o modelo só nesta conversa, via header x-openclaw-model. Não
 * altera o modelo padrão do agente (isso é Settings, administrador) nem afeta as
 * conversas de outras pessoas com o mesmo agente.
 *
 * A lista vem do Gateway (useGatewayModels), nunca de constante local — duas
 * listas hardcoded divergentes foi exatamente o bug que fez o rótulo "DeepSeek
 * V4 Pro" gravar deepseek-chat.
 */
export function ModelSelector({ agentId, className }: Props) {
  const { models, isFallback, agentDefaults } = useGatewayModels();
  const [override, setOverride] = useState<string | null>(() => getModelOverride(agentId));

  // Ressincroniza ao trocar de agente e quando o override muda em outro lugar.
  useEffect(() => {
    setOverride(getModelOverride(agentId));
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (!detail?.agentId || detail.agentId === agentId) {
        setOverride(getModelOverride(agentId));
      }
    };
    window.addEventListener(MODEL_OVERRIDE_EVENT, onChange);
    return () => window.removeEventListener(MODEL_OVERRIDE_EVENT, onChange);
  }, [agentId]);

  const selected = override ? models.find((m) => m.qualifiedId === override) : null;

  // Qual modelo o "padrão do agente" resolve, quando o Gateway informa. Sem
  // isso o rótulo genérico não diz nada — mas mostrar um modelo NÃO confirmado
  // seria pior, então o fallback é continuar genérico.
  const defaultQualified = agentDefaults[agentId] ?? null;
  const defaultModel = defaultQualified
    ? models.find((m) => m.qualifiedId === defaultQualified)
    : null;
  const defaultLabel = defaultModel?.label ?? null;

  // O modelo salvo pode não estar mais na lista do Gateway (removido da config,
  // ou Gateway fora do ar). Mostrar o id cru é melhor do que fingir que está no
  // padrão — o usuário precisa saber que a conversa está num modelo não
  // confirmado.
  const label = override
    ? (selected?.label ?? override)
    : defaultLabel
      ? `${defaultLabel} (padrão)`
      : "Padrão do agente";
  const unknownOverride = !!override && !selected && !isFallback;

  const byProvider = models.reduce<Record<string, GatewayModel[]>>((acc, m) => {
    (acc[m.provider] ??= []).push(m);
    return acc;
  }, {});

  function choose(model: string | null) {
    setModelOverride(agentId, model);
    setOverride(model);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Modelo usado nesta conversa. Não altera o padrão do agente."
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-mono transition-colors",
            override
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border/40 bg-secondary/30 text-muted-foreground hover:bg-secondary/50",
            className,
          )}
        >
          {unknownOverride ? (
            <AlertTriangle className="h-3 w-3 shrink-0" />
          ) : selected ? (
            <ProviderLogo provider={selected.provider} size={12} />
          ) : defaultModel ? (
            <ProviderLogo provider={defaultModel.provider} size={12} />
          ) : (
            <Cpu className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate max-w-[160px]">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          Modelo desta conversa
        </DropdownMenuLabel>

        {/* Item genérico só quando o padrão NÃO pôde ser resolvido a um modelo
            da lista. Quando ele é conhecido, o "(padrão)" aparece no próprio
            modelo lá embaixo — ter os dois mostraria o mesmo modelo duas vezes
            sem explicar a diferença. Mas sem este item, um override não teria
            como ser desfeito se o padrão não estiver na lista. */}
        {!defaultModel && (
          <DropdownMenuItem onClick={() => choose(null)} className="gap-2">
            <Check className={cn("h-3.5 w-3.5 shrink-0", override ? "opacity-0" : "opacity-100")} />
            <div className="flex-1 min-w-0">
              <div className="text-xs">Padrão do agente</div>
              <div className="text-[10px] text-muted-foreground">Segue o que está configurado</div>
            </div>
          </DropdownMenuItem>
        )}

        {Object.entries(byProvider).map(([provider, list]) => (
          <div key={provider}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
              <ProviderLogo provider={provider} size={12} />
              {PROVIDER_LABEL[provider] ?? provider}
            </DropdownMenuLabel>
            {list.map((m) => {
              const isDefault = m.qualifiedId === defaultQualified;
              // Escolher o modelo padrão LIMPA o override em vez de fixá-lo:
              // assim a conversa continua acompanhando a configuração do agente
              // se um admin trocar o padrão depois. Fixar explicitamente o
              // mesmo modelo que já é o padrão não teria utilidade prática e
              // custaria essa propriedade.
              const checked = isDefault ? !override : override === m.qualifiedId;
              return (
                <DropdownMenuItem
                  key={m.qualifiedId}
                  onClick={() => choose(isDefault ? null : m.qualifiedId)}
                  className="gap-2"
                >
                  <Check className={cn("h-3.5 w-3.5 shrink-0", checked ? "opacity-100" : "opacity-0")} />
                  <ProviderLogo provider={m.provider} size={16} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate">
                      {m.label}
                      {isDefault && <span className="text-muted-foreground"> (padrão)</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {isDefault
                        ? "Acompanha se o padrão mudar"
                        : m.contextWindow
                          ? m.contextWindow >= 1_000_000
                            ? `${(m.contextWindow / 1_000_000).toFixed(0)}M de contexto`
                            : `${Math.round(m.contextWindow / 1000)}k de contexto`
                          : ""}
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}

        {isFallback && (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">
              Não foi possível confirmar os modelos com o Gateway — lista de referência.
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
