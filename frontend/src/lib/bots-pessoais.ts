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
