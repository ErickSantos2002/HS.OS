import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { getModelLabel } from "@/lib/model-pricing";

/**
 * Lista as LLMs que o Gateway REALMENTE serve (edge function gateway-models).
 *
 * Substitui as constantes hardcoded de modelo espalhadas pelo frontend. Existiam
 * duas listas independentes (AgentEditDrawer e AddAgentDialog) que divergiram e
 * causaram bug real: o item rotulado "DeepSeek V4 Pro" gravava
 * `deepseek/deepseek-chat` no Gateway — janela de 131k em vez de 1M — deixando
 * agentes no modelo errado sem ninguém perceber. Lista vinda do Gateway não tem
 * como divergir da realidade.
 *
 * `fallback` cobre o caso de o Gateway estar fora ou não expor modelo nenhum:
 * a tela continua utilizável em vez de mostrar um seletor vazio. Marcado com
 * `isFallback` para a UI poder avisar que a lista não foi confirmada.
 */
export type GatewayModel = {
  /** id nu, como o Gateway conhece: "deepseek-v4-pro" */
  id: string;
  /** formato aceito por agents.update: "deepseek/deepseek-v4-pro" */
  qualifiedId: string;
  provider: string;
  label: string;
  contextWindow: number | null;
};

/**
 * Usado só quando o Gateway não responde. Reflete o que está configurado hoje
 * no openclaw.json da HS.OS — pode não valer para um remix, por isso a UI deve
 * sinalizar que é fallback.
 */
// ⚠️ **Vazio de propósito.** Aqui havia DeepSeek V4 Pro e Flash, com o
// comentário de que "reflete o que está configurado hoje no openclaw.json" — e
// deixou de refletir quando a instalação passou a servir só Anthropic. Como
// esta lista é `placeholderData`, ela aparecia em TODA carga, não só com o
// gateway fora: em 14/08/2026 o formulário de criar agente ofereceu DeepSeek a
// quem não usa DeepSeek, e teria gravado esse modelo se a pessoa avançasse
// antes da resposta chegar.
//
// Lista de referência que envelhece é pior que lista vazia: a vazia mostra que
// não sabe, a velha afirma o que não é. Quem consome deve tratar
// `isFallback: true` como "ainda não sei", e não como "use estes".
const FALLBACK_MODELS: GatewayModel[] = [];

async function fetchGatewayModels(): Promise<{
  models: GatewayModel[];
  isFallback: boolean;
  /** agentId -> "provedor/modelo" configurado como padrão daquele agente. */
  agentDefaults: Record<string, string>;
}> {
  let data: { models?: GatewayModel[]; agentDefaults?: Record<string, string> };
  try {
    // `models.list` do gateway, via proxy do backend. O token nunca passa aqui.
    data = await api<{ models?: GatewayModel[]; agentDefaults?: Record<string, string> }>(
      "/gateway/models",
    );
  } catch {
    return { models: FALLBACK_MODELS, isFallback: true, agentDefaults: {} };
  }
  if (!Array.isArray(data.models) || data.models.length === 0) {
    return { models: FALLBACK_MODELS, isFallback: true, agentDefaults: {} };
  }
  const agentDefaults: Record<string, string> =
    data.agentDefaults && typeof data.agentDefaults === "object" ? data.agentDefaults : {};
  // Prefere o rótulo curado do model-pricing quando o modelo é conhecido; o
  // rótulo derivado pelo backend cobre modelos novos, que é justamente o caso
  // que a lista hardcoded não cobria.
  const models: GatewayModel[] = data.models.map((m: GatewayModel) => {
    const curated = getModelLabel(m.id);
    return { ...m, label: curated && curated !== m.id ? curated : m.label };
  });
  return { models, isFallback: false, agentDefaults };
}

export function useGatewayModels() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["gateway-models"],
    queryFn: fetchGatewayModels,
    // A lista muda só quando alguém mexe na config do Gateway — não vale
    // consultar a cada render, mas também não convém cachear pra sempre.
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: { models: FALLBACK_MODELS, isFallback: true, agentDefaults: {} },
  });

  return {
    models: data?.models ?? FALLBACK_MODELS,
    isFallback: data?.isFallback ?? true,
    /** agentId -> modelo padrão do agente. Vazio quando o Gateway não informou. */
    agentDefaults: data?.agentDefaults ?? {},
    loading: isLoading,
    error: error as Error | null,
    refetch,
  };
}
