/**
 * Quando a War Room deve impedir a TV de apagar — e quando não.
 *
 * A TV do escritório é uma LG webOS com proteção de tela que apaga a imagem em
 * até 30 min sem tocar no controle, e não há opção para desligá-la (relato do
 * Rickelme, 30/10/2026). A página é que tem que se manter "em uso".
 *
 * Só onde faz sentido: a mesma `/warroom` é aberta por quem espelha a tela de
 * um notebook logado, e ali segurar a tela acesa seria gastar bateria alheia.
 * Por isso a decisão olha para sinais de TV, não para a rota:
 *
 * - `?tv=1` liga e `?tv=0` desliga, vencendo os outros sinais;
 * - navegador webOS liga;
 * - `?t=` (o token da TV) liga — é por ele que a TV entra, porque ela não faz
 *   login. Quem chega pela sessão não traz `t`.
 */
export function deveManterAcordada(params: URLSearchParams, userAgent: string): boolean {
  const tv = params.get("tv");
  if (tv === "1") return true;
  if (tv === "0") return false;
  if (ehWebOS(userAgent)) return true;
  return !!params.get("t");
}

/** O navegador da LG se anuncia como `Web0S` (com zero) ou `webOS`. */
export function ehWebOS(userAgent: string): boolean {
  return /web(0|o)s/i.test(userAgent);
}
