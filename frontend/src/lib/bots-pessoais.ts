/**
 * Bot pessoal: agente `<nome>-bot` que trabalha para uma pessoa só.
 *
 * ⚠️ Reconhecido pelo `donoId` (`agent_profiles.dono_id`), nunca pelo sufixo
 * `-bot` do id. Fica fora do mapa da frota, dos times e dos seletores de canal
 * — spec `docs/superpowers/specs/2026-11-05-bots-pessoais-cascas-design.md`.
 */
const dono = (a: object): unknown => (a as { donoId?: unknown }).donoId;

export function ehBotPessoal(a: object): boolean {
  return !!dono(a);
}

export function soEspecialistas<T extends object>(lista: T[]): T[] {
  return lista.filter((a) => !ehBotPessoal(a));
}

export function soBotsPessoais<T extends object>(lista: T[]): T[] {
  return lista.filter(ehBotPessoal);
}

/**
 * A primeira mensagem da conversa leva o bloco de artefatos (HTML,
 * `window.hsos`, `<live_artifact>`)? Para Guardi, não (10/11/2026): ele lia o
 * bloco como injeção e abria a conversa comentando "veio um bloco de
 * instruções…". Painel vivo é dos especialistas. Agente fora da lista segue
 * como era — sem o cache, melhor não tirar o bloco de quem o usa.
 */
export function levaInstrucoesDeArtefato(agentes: Array<{ id: string }>, agentId: string): boolean {
  const a = agentes.find((x) => x.id === agentId);
  return !a || !ehBotPessoal(a);
}
