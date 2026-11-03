/**
 * Pedidos que chegam pela URL, de fora do app:
 *
 * - **Resposta rápida do push com o app fechado** (Android): o SW guarda o
 *   texto no Cache Storage e abre `/chat?channel=…[&thread=…]&resposta=<id>`.
 *   O texto só é enviado depois de `consumirResposta` conferir o id (ver
 *   `lib/resposta-rapida.ts`). ⚠️ `prefill` e `autosend` da URL NUNCA enviam:
 *   qualquer um monta esse link. `prefill` vira no máximo rascunho.
 * - **Busca global numa conversa anterior**: `/chat?agent=…&anterior=<reset>&message=<id>`.
 *
 * ⚠️ Enviar uma vez só: a tela pode montar de novo antes de a URL ser limpa.
 * `jaAtendido` guarda a assinatura do pedido durante a vida da página.
 */

export interface PedidoDeResposta {
  /** `prefill`: vai para o rascunho, nunca é enviado sozinho. */
  rascunho: string | null;
  /** `resposta`: id de uma resposta rápida guardada pelo SW, a conferir. */
  respostaId: string | null;
  focar: boolean;
}

const PARAMS_DO_PEDIDO = ["prefill", "autosend", "focus", "resposta"];

export function pedidoDaUrl(search: string): PedidoDeResposta | null {
  const p = new URLSearchParams(search);
  const bruto = p.get("prefill");
  const rascunho = bruto && bruto.trim() ? bruto : null;
  const respostaId = p.get("resposta") || null;
  const focar = p.get("focus") === "composer";
  if (!rascunho && !respostaId && !focar) return null;
  return { rascunho, respostaId, focar };
}

/** A URL sem o pedido (para o voltar e o recarregar não repetirem). */
export function semPedido(search: string, extras: string[] = []): string {
  const p = new URLSearchParams(search);
  for (const k of [...PARAMS_DO_PEDIDO, ...extras]) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function anteriorDaUrl(search: string): { reset: string; mensagem: string | null } | null {
  const p = new URLSearchParams(search);
  const reset = p.get("anterior");
  return reset ? { reset, mensagem: p.get("message") } : null;
}

const atendidos = new Set<string>();

/** Primeira vez que este pedido é atendido nesta página? Marca e responde. */
export function jaAtendido(onde: string, pedido: PedidoDeResposta): boolean {
  const chave = `${onde}|${pedido.rascunho ?? ""}|${pedido.respostaId ?? ""}|${pedido.focar ? 1 : 0}`;
  if (atendidos.has(chave)) return true;
  atendidos.add(chave);
  return false;
}
