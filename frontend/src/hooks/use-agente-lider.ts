import { useAgents } from "@/hooks/use-agents";

/**
 * O nome do agente orquestrador desta instalação, para usar em texto de tela.
 *
 * ⚠️ **Existe para não escrever "Lia" no código.** A `lia` é a orquestradora da
 * instância original da dn.ia; aqui é a `nina`, e no próximo remix será outra.
 * Trocar "Lia" por "Nina" resolveria hoje e recriaria exatamente o mesmo
 * problema — o `CLAUDE.md` proíbe reintroduzir o nome fixo, e a resolução por
 * `agent_profiles.is_leader` foi feita justamente para isso.
 *
 * ⚠️ **Não usa o `agent-catalog`, embora ele tenha um `getLeaderAgentEntry()`
 * feito para isto.** O catálogo filtra por `isOfficial`, e nesta instalação
 * **nenhum agente é oficial** — os cinco vêm com `is_official = false`. Ou
 * seja, ele está vazio e todo acessor dele devolve o fallback, em silêncio.
 * O `is_leader` da `/agents` é o dado que existe de verdade aqui.
 *
 * ⚠️ **Cuidado com preposição ao usar.** Em português "por" + "o" vira "pelo"
 * e "a" + "o" vira "ao", então `por {lider}` fica errado quando o valor cai no
 * genérico ("por o agente orquestrador"). Escreva as frases com `para`, com
 * dois-pontos, ou sem preposição antes do nome — foi o que quebrou na primeira
 * versão disto.
 */
export function useNomeDoLider(generico = "o agente orquestrador"): string {
  const { agents } = useAgents();
  return agents.find((a) => a.isLeader)?.name?.trim() || generico;
}
