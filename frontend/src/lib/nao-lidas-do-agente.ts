/**
 * Não lidas de um agente = as do canal de DM dele + as gravadas só com
 * `agent_id` (canal nulo, caso do `dm-agent-reply` quando o canal não
 * resolve). Antes só o primeiro mapa era lido e as órfãs nunca acendiam
 * badge. Saiu do `ChatPage` para a lista do celular contar igual.
 */
import { getAgentIdAliases } from "@/lib/agent-id";

export function naoLidasDoAgente(
  agentId: string,
  mapaDm: Record<string, string>,
  unreadByChannel: Record<string, number>,
  unreadByAgentOnly: Record<string, number>,
): number {
  const aliases = getAgentIdAliases(agentId);
  const dmChId = aliases.map((alias) => mapaDm[alias]).find(Boolean);
  const fromChannel = dmChId ? (unreadByChannel[dmChId] || 0) : 0;
  const fromAgentOnly = aliases.reduce((acc, alias) => acc + (unreadByAgentOnly[alias] || 0), 0);
  return fromChannel + fromAgentOnly;
}
