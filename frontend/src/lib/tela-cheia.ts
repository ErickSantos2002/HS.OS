/**
 * A conversa aberta no celular ocupa a tela inteira — spec 2026-11-03, C1.
 *
 * Quem decide se há conversa aberta é a URL (`?agent=` / `?channel=`), a mesma
 * fonte da seleção no `ChatPage`; assim o `AppLayout` não precisa conhecer o
 * estado da página e o link profundo cai no mesmo lugar que o toque na lista.
 */
export function conversaEmTelaCheia(pathname: string, search: string, isMobile: boolean): boolean {
  if (!isMobile || pathname !== "/chat") return false;
  const params = new URLSearchParams(search);
  return params.has("agent") || params.has("channel");
}
