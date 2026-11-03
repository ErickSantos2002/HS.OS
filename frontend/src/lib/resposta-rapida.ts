/**
 * Resposta rápida pela notificação (Android: campo de texto no push).
 *
 * Mora fora do `sw.ts` para dar para testar: o SW importa estas funções.
 */

interface ClienteDeJanela {
  focused: boolean;
}

/**
 * Para qual aba mandar a resposta: a focada, senão a primeira.
 *
 * ⚠️ **Uma só.** O SW mandava para todas as abas, e cada uma postava — com o
 * PWA e uma aba do navegador abertos, a resposta saía duas vezes no canal.
 */
export function clienteDaResposta<T extends ClienteDeJanela>(abertas: readonly T[]): T | null {
  return abertas.find((c) => c.focused) ?? abertas[0] ?? null;
}

export interface PedidoDeRespostaRapida {
  channelId: string;
  threadId?: string | null;
  text: string;
}

/**
 * O corpo do `POST /channels/{id}/messages` da resposta rápida.
 *
 * ⚠️ Leva o `thread_id` quando a notificação era de thread: sem ele, a
 * resposta à thread caía na raiz do canal, fora da conversa a que respondia.
 */
export function corpoDaRespostaRapida(
  pedido: PedidoDeRespostaRapida,
  autor: { nome: string; avatar: string | null },
) {
  return {
    author_type: "human",
    author_name: autor.nome,
    content: pedido.text,
    author_avatar: autor.avatar,
    ...(pedido.threadId ? { thread_id: pedido.threadId } : {}),
  };
}
