/* Prévia de arquivo HTML (/wiki-html-preview) — PK-01, 24/11/2026.
 *
 * Portado da auditoria de 02/11 do DN.OS (item M4). A página é PÚBLICA e lê o
 * pedido do endereço: `?url=` buscava QUALQUER site e o mostrava em tela cheia
 * sob hsos.healthsafetytech.com (serve para login falso), e `?key=` apagava
 * qualquer chave do localStorage — `?key=hsos.token` deslogava quem clicasse.
 * Agora só a chave de uso único que o `openPreview`
 * (components/wiki/mediaActions.ts) grava, e só arquivo do nosso storage ou da
 * própria origem.
 *
 * ⚠️ Diferença para o DN.OS: lá a segunda origem era o Storage do Supabase
 * (`/storage/v1/`). Aqui os buckets são servidos pela API, em
 * `${VITE_API_URL}/storage/…` — e SÓ esse caminho dela vale. A API tem outras
 * rotas públicas (`/p/…`, `/mcp/…`) que não são arquivo da wiki.
 */

/** Prefixo da chave que o openHtmlPreviewRoute grava (mediaActions.ts). */
export const PREFIXO_DA_CHAVE = "wiki-html-preview:";

/** A chave é da prévia (prefixo + carimbo + sorteio); qualquer outra fica intocada. */
export function chaveDaPrevia(chave: string | null | undefined): string | null {
  if (!chave || !chave.startsWith(PREFIXO_DA_CHAVE)) return null;
  return /^wiki-html-preview:\d+:[a-z0-9]+$/.test(chave) ? chave : null;
}

/** O endereço se for da mesma origem ou do storage da API (`<api>/storage/`); senão null.
    `apiBase` é o `VITE_API_URL`: absoluto em produção, `/api` em desenvolvimento. */
export function enderecoDaPrevia(
  valor: string | null | undefined,
  origem: string,
  apiBase: string | null | undefined,
): string | null {
  if (!valor) return null;
  let url: URL;
  try {
    url = new URL(valor.trim(), origem);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.origin === new URL(origem).origin) return url.href;
  let api: URL | null = null;
  try {
    api = apiBase ? new URL(apiBase, origem) : null;
  } catch {
    api = null;
  }
  // `new URL` já resolveu `..` e `%2e%2e`: o pathname aqui é o que será pedido.
  const raiz = api ? `${api.pathname.replace(/\/+$/, "")}/storage/` : "";
  if (api && url.origin === api.origin && url.pathname.startsWith(raiz)) return url.href;
  return null;
}
