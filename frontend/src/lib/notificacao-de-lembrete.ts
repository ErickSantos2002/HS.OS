/**
 * Notificação de lembrete no service worker (spec 2026-11-13, "Camada 1").
 *
 * Mora fora do `sw.ts` para dar para testar: o SW importa estas funções. Sem
 * `@/` nos imports — este arquivo entra no bundle do SW.
 *
 * Em 13/11/2026 a Sandra não viu o lembrete das 14:00: a notificação apareceu
 * e sumiu. Notificação que some serve para mensagem, não para lembrete — o de
 * lembrete fica na tela (`requireInteraction`) até a pessoa decidir, com
 * "Adiar 10 min" e "Feito" ali mesmo.
 */

export interface PayloadDeLembrete {
  tipo: "lembrete";
  lembrete_id: string;
  aviso_em?: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  /** Tokens assinados pelo backend: um por ação. Sem o segredo lá, não vêm. */
  acoes?: { adiar?: string; feito?: string };
}

export const ACAO_ADIAR = "lembrete_adiar";
export const ACAO_FEITO = "lembrete_feito";

export function ehLembrete(payload: unknown): payload is PayloadDeLembrete {
  const p = payload as { tipo?: unknown; lembrete_id?: unknown } | null;
  return !!p && p.tipo === "lembrete" && typeof p.lembrete_id === "string" && !!p.lembrete_id;
}

/**
 * ⚠️ **Lembrete não passa pelo `alguemOlhando`.** Mensagem com a conversa
 * aberta e em foco não notifica; lembrete notifica sempre — quem está olhando
 * recebe também a janela do app, e fechar uma fecha a outra.
 */
export function respeitaQuemOlha(payload: unknown): boolean {
  return !ehLembrete(payload);
}

export interface NotificacaoMontada {
  titulo: string;
  opcoes: NotificationOptions & {
    renotify?: boolean;
    actions?: Array<{ action: string; title: string }>;
  };
}

/** Título e opções do `showNotification` de um lembrete. */
export function notificacaoDoLembrete(p: PayloadDeLembrete): NotificacaoMontada {
  const actions: Array<{ action: string; title: string }> = [];
  if (p.acoes?.adiar) actions.push({ action: ACAO_ADIAR, title: "Adiar 10 min" });
  if (p.acoes?.feito) actions.push({ action: ACAO_FEITO, title: "Feito" });
  const tag = p.tag ?? `lembrete:${p.lembrete_id}`;
  return {
    titulo: p.title ?? "⏰ Lembrete",
    opcoes: {
      body: p.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag,
      // O re-aviso usa a mesma tag: substitui a velha e toca de novo.
      renotify: true,
      // Fica na tela até Adiar, Feito ou um clique. No iOS não existe — lá
      // fica na central, como hoje (aceito pela spec).
      requireInteraction: true,
      data: {
        url: p.url ?? "/agenda",
        tipo: "lembrete",
        lembrete_id: p.lembrete_id,
        acoes: p.acoes ?? {},
      },
      actions,
    },
  };
}

/** A ação clicada → o token dela, ou `null` se não é ação de lembrete. */
export function tokenDaAcao(
  action: string,
  data: { tipo?: string; acoes?: { adiar?: string; feito?: string } } | null | undefined,
): string | null {
  if (data?.tipo !== "lembrete") return null;
  if (action === ACAO_ADIAR) return data.acoes?.adiar ?? null;
  if (action === ACAO_FEITO) return data.acoes?.feito ?? null;
  return null;
}

/**
 * Manda a ação ao backend SEM login: o token é a autorização inteira e só
 * serve para aquele lembrete, naquele aviso, naquela ação (`agenda/token_acao.py`).
 * Devolve se o servidor aceitou o pedido (o segundo clique também é aceito —
 * só não muda nada).
 */
export async function enviarAcaoDoLembrete(
  token: string,
  base: string,
  buscar: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const r = await buscar(`${base}/agenda/lembretes/acao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
