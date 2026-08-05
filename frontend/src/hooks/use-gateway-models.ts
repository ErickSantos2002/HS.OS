import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
const FALLBACK_MODELS: GatewayModel[] = [
  { id: "deepseek-v4-pro", qualifiedId: "deepseek/deepseek-v4-pro", provider: "deepseek", label: "DeepSeek V4 Pro", contextWindow: 1_000_000 },
  { id: "deepseek-v4-flash", qualifiedId: "deepseek/deepseek-v4-flash", provider: "deepseek", label: "DeepSeek V4 Flash", contextWindow: 1_000_000 },
];
// deepseek-chat saiu daqui de propósito: o models.list do Gateway (conferido em
// 2026-07-24) não serve mais esse modelo. Mantê-lo no fallback ofereceria um
// modelo inexistente. Agente que ainda tenha ele salvo continua aparecendo no
// seletor pela opção "não confirmado no Gateway".

async function fetchGatewayModels(): Promise<{
  models: GatewayModel[];
  isFallback: boolean;
  /** agentId -> "provedor/modelo" configurado como padrão daquele agente. */
  agentDefaults: Record<string, string>;
}> {
  const { data, error } = await supabase.functions.invoke("gateway-models", { body: {} });
  if (error || !data?.success || !Array.isArray(data.models) || data.models.length === 0) {
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
