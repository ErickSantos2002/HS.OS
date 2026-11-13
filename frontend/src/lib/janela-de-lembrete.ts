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
 * O alarme da janela (13/11/2026, pedido do Erick depois do teste): um toque
 * só passava despercebido por quem não estava olhando a janela — e a
 * notificação do sistema pode estar bloqueada no aparelho. Enquanto o
 * lembrete estiver pendente, toca a cada `ALARME_INTERVALO_MS`, **também com a
 * aba oculta** (é justamente quem não está olhando), até alguém responder,
 * silenciar ou abrir a conversa — e no máximo por `ALARME_TETO_MS`: depois disso
 * quem chama de novo é a insistência de 5 min do servidor, que é um aviso novo
 * e recomeça o alarme.
 */
export const ALARME_INTERVALO_MS = 3_000;
export const ALARME_TETO_MS = 120_000;

export function alarmeTocando(o: {
  pendente: boolean;
  recolhida: boolean;
  silenciado: boolean;
  desde: number | null;
  agora: number;
}): boolean {
  return o.pendente && !o.recolhida && !o.silenciado && o.desde !== null && o.agora - o.desde < ALARME_TETO_MS;
}

/** O título da aba pisca com o lembrete: aparece na barra de tarefas mesmo com a janela atrás. */
export const tituloDaAba = (base: string, lembrete: string, aceso: boolean) =>
  aceso ? `⏰ LEMBRETE — ${lembrete}` : base;

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
