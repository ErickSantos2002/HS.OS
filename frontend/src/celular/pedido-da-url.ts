/**
 * Pedidos que chegam pela URL, de fora do app:
 *
 * - **Resposta rápida do push com o app fechado** (Android): o SW abre
 *   `/chat?channel=…[&thread=…]&prefill=<texto>&autosend=1&focus=composer`
 *   (`sw.ts`). Era o `ChannelChat` quem tratava; no celular é a conversa (ou
 *   a thread) do topo.
 * - **Busca global numa conversa anterior**: `/chat?agent=…&anterior=<reset>&message=<id>`.
 *
 * ⚠️ Enviar uma vez só: a tela pode montar de novo antes de a URL ser limpa.
 * `jaAtendido` guarda a assinatura do pedido durante a vida da página.
 */

export interface PedidoDeResposta {
  texto: string | null;
  enviar: boolean;
  focar: boolean;
}

const PARAMS_DO_PEDIDO = ["prefill", "autosend", "focus"];

export function pedidoDaUrl(search: string): PedidoDeResposta | null {
  const p = new URLSearchParams(search);
  const bruto = p.get("prefill");
  const texto = bruto && bruto.trim() ? bruto : null;
  const focar = p.get("focus") === "composer";
  if (!texto && !focar) return null;
  return { texto, enviar: p.get("autosend") === "1" && !!texto, focar };
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
  const chave = `${onde}|${pedido.texto ?? ""}|${pedido.enviar ? 1 : 0}|${pedido.focar ? 1 : 0}`;
  if (atendidos.has(chave)) return true;
  atendidos.add(chave);
  return false;
}
