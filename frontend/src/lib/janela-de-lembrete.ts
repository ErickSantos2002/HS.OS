/**
 * A janela de lembrete do app (spec 2026-11-13, "Camada 2") — a parte sem React.
 *
 * O cartão no centro da tela é função do SERVIDOR: a lista de avisos ainda sem
 * "Adiar" nem "Feito" (`GET /agenda/lembretes/pendentes`). O tempo real só
 * diz "busque de novo" — o evento não carrega a linha (ver `lib/realtime.ts`).
 * Assim a mesma regra serve para os três casos: o recado novo (INSERT em
 * `conversations`), a resposta dada noutra aba ou aparelho (`lembretes`) e quem
 * abriu o app depois do aviso.
 */

export interface AvisoPendente {
  id: string;
  aviso_em: string;
}

/** Um aviso é o lembrete NAQUELE instante: o re-aviso é outro aviso. */
export const chaveDoAviso = (p: AvisoPendente) => `${p.id}@${p.aviso_em}`;

/** Evento do tópico da pessoa que pode mudar a janela. */
export function mudaAJanela(dados: unknown): boolean {
  const tabela = (dados as { tabela?: unknown } | null)?.tabela;
  return tabela === "conversations" || tabela === "lembretes";
}

/**
 * Compara a lista nova com o que esta aba já mostrou.
 *
 * - `novos`: avisos que a aba nunca viu — abrem a janela e tocam o som (uma vez).
 * - `sumiram`: lembretes que saíram da lista porque alguém respondeu (noutra
 *   aba, aparelho ou pela notificação) — a notificação do sistema deles fecha.
 */
export function compararAvisos(
  vistos: ReadonlySet<string>,
  antes: readonly AvisoPendente[],
  agora: readonly AvisoPendente[],
): { novos: AvisoPendente[]; sumiram: string[] } {
  const novos = agora.filter((p) => !vistos.has(chaveDoAviso(p)));
  const ficam = new Set(agora.map((p) => p.id));
  const sumiram = [...new Set(antes.map((p) => p.id))].filter((id) => !ficam.has(id));
  return { novos, sumiram };
}

/**
 * Toca o som? Só para aviso novo e com a aba à vista — oculta, quem avisa é o
 * push (tocar duas vezes, uma no SO e outra numa aba escondida, é ruído).
 */
export const deveTocar = (novos: number, visivel: boolean) => novos > 0 && visivel;

/** Fecha a notificação do SO de um lembrete (`tag: lembrete:<id>`). Nunca levanta. */
export async function fecharNotificacaoDoLembrete(id: string): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    const abertas = await reg.getNotifications({ tag: `lembrete:${id}` });
    for (const n of abertas) n.close();
  } catch {
    // sem suporte: a notificação fica até a pessoa a dispensar
  }
}
