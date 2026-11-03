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

/* ── Resposta rápida com o app FECHADO ─────────────────────────────────────
 *
 * ⚠️ **Segurança: nada se envia a partir da query string.** Até 03/11/2026 o
 * SW abria `/chat?channel=…&prefill=<texto>&autosend=1` e a tela publicava o
 * texto. Qualquer um podia mandar um link desses por WhatsApp ou e-mail e
 * fazer quem o abrisse postar num canal em nome dele.
 *
 * Agora o SW guarda o texto no Cache Storage sob um id aleatório e a URL
 * leva só `?resposta=<id>`. O app lê o registro, confere que é do canal (e da
 * thread) da tela e que tem menos de 5 minutos, APAGA e só então envia. Um
 * link forjado não tem como pôr nada nesse cache: ele é do service worker
 * deste aparelho, nesta origem.
 */

export const CACHE_RESPOSTA = "hsos-resposta-rapida";
export const VALIDADE_RESPOSTA_MS = 5 * 60_000;
const ID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RegistroDeResposta {
  texto: string;
  channel_id: string;
  thread_id: string | null;
  criado_em: number;
}

/** O pedaço do Cache Storage que se usa aqui (dá para trocar por um falso no teste). */
export interface CacheMinimo {
  put(chave: string, resposta: Response): Promise<void>;
  match(chave: string): Promise<Response | undefined>;
  delete(chave: string): Promise<boolean>;
}

export function chaveDaResposta(id: string): string {
  return `/__resposta/${id}`;
}

/** SW: guarda o texto digitado no push sob o id que vai na URL. */
export async function guardarResposta(cache: CacheMinimo, id: string, registro: RegistroDeResposta): Promise<void> {
  await cache.put(chaveDaResposta(id), new Response(JSON.stringify(registro), { headers: { "content-type": "application/json" } }));
}

/**
 * App: o texto a enviar, se — e só se — o id existe, é deste canal/thread e
 * não venceu. Consome o registro: o mesmo id nunca envia duas vezes.
 */
export async function consumirResposta(
  cache: CacheMinimo,
  id: string,
  alvo: { canal: string; thread: string | null },
  agora: number = Date.now(),
): Promise<string | null> {
  if (!ID_VALIDO.test(id)) return null;
  const chave = chaveDaResposta(id);
  const achado = await cache.match(chave);
  if (!achado) return null;
  let r: RegistroDeResposta;
  try {
    r = await achado.json();
  } catch {
    await cache.delete(chave);
    return null;
  }
  if (agora - r.criado_em > VALIDADE_RESPOSTA_MS || agora < r.criado_em) {
    await cache.delete(chave);
    return null;
  }
  if (r.channel_id !== alvo.canal || (r.thread_id ?? null) !== (alvo.thread ?? null)) return null;
  await cache.delete(chave);
  return r.texto?.trim() ? r.texto : null;
}

/** O cache de verdade, no app. Sem Cache Storage, nada se envia. */
export async function abrirCacheDeRespostas(): Promise<CacheMinimo | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_RESPOSTA);
  } catch {
    return null;
  }
}
