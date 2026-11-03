/**
 * Quais navegações o service worker pode atender com o `index.html`
 * precacheado (fallback offline do SPA).
 *
 * Fora ficam os caminhos que não são tela do app: a API (`/api`, e `/ws` do
 * tempo real), os arquivos (`/storage`) e os artefatos publicados
 * (`/artifact`). Para esses o SW não intervém e a navegação vai à rede.
 *
 * Mora aqui, e não no `sw.ts`, para ter teste: o SW não roda no Vitest.
 */

export const PREFIXOS_FORA_DO_APP = ["/api", "/ws", "/storage", "/artifact"] as const;

/** Para o `denylist` do `NavigationRoute`: casa o prefixo como segmento inteiro. */
export const LISTA_NEGADA: RegExp[] = PREFIXOS_FORA_DO_APP.map(
  (p) => new RegExp(`^${p}(?:[/?#]|$)`),
);

export function ehNavegacaoDoApp(caminho: string): boolean {
  return !LISTA_NEGADA.some((re) => re.test(caminho));
}
