/**
 * O que cada evento do tópico `canal:<id>` faz com a lista de mensagens.
 *
 * ⚠️ **O backend publica quatro tipos e o front escutava um.**
 * `app/routers/channels.py` publica `mensagem` (nova, em dois caminhos),
 * `mensagem-editada` e `mensagem-removida`. O assinante em `use-channels.ts`
 * começava com `if (tipo !== "mensagem") return` — os outros dois chegavam e
 * eram descartados em silêncio.
 *
 * Quem salvava a tela era a rede de segurança de 60s do próprio hook, escrita
 * como "plano B". Medido na pilha local em 03/09/2026: edição levou **10,6 s**
 * para aparecer (o intervalo pegando no meio do ciclo) e o apagar levou mais de
 * dez minutos na aba de quem apagou. Mensagem nova chega em ~40 ms — não é o
 * transporte que é lento, eram dois eventos que ninguém escutava.
 *
 * O pior dos dois é o apagar: a pessoa clica, a mensagem continua na tela com o
 * texto original, e o reflexo é clicar de novo.
 */
import type { ChannelMessage } from "@/hooks/use-channels";

/** Junta por id (o que chega vence), troca a otimista pela real, ordena. */
export const reconcileMessages = (
  prev: ChannelMessage[],
  incoming: ChannelMessage[],
): ChannelMessage[] => {
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) {
    const optimistic = [...byId.values()].find(
      (x) =>
        x.id.startsWith("optimistic-") &&
        x.author_id === m.author_id &&
        x.content === m.content &&
        !x.thread_id &&
        !m.thread_id,
    );
    if (optimistic) byId.delete(optimistic.id);
    byId.set(m.id, { ...(byId.get(m.id) || {}), ...m });
  }
  return [...byId.values()].sort(
    (a, b) => +new Date(a.created_at) - +new Date(b.created_at),
  );
};

export function aplicarEventoDeCanal(
  prev: ChannelMessage[],
  tipo: string,
  dados: unknown,
): ChannelMessage[] {
  if (tipo === "mensagem" || tipo === "mensagem-editada") {
    const msg = dados as ChannelMessage;
    // Resposta de thread tem painel próprio; aqui ela abriria uma linha solta
    // no meio da conversa.
    if (!msg?.id || msg.thread_id) return prev;
    return reconcileMessages(prev, [msg]);
  }

  if (tipo === "mensagem-removida") {
    // O evento traz só `{id}` — o conteúdo não viaja, e não precisa: o que a
    // tela mostra para uma mensagem com `deleted_at` é "Mensagem apagada".
    const id = (dados as { id?: string })?.id;
    if (!id) return prev;
    let achou = false;
    const fim = prev.map((m) => {
      if (m.id !== id || m.deleted_at) return m;
      achou = true;
      return { ...m, deleted_at: new Date().toISOString() };
    });
    // ⚠️ Apagada continua na lista, marcada. Removê-la abriria um buraco no
    // meio da conversa, e é diferente do que a tela mostra ao recarregar —
    // que é a referência do que está certo.
    return achou ? fim : prev;
  }

  return prev;
}
