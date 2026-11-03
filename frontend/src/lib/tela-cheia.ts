/**
 * A conversa aberta no celular ocupa a tela inteira — spec 2026-11-03, C1.
 *
 * ⚠️ **Quem decide é a conversa SELECIONADA de fato, não a URL.** A primeira
 * versão olhava `?agent=`/`?channel=`, e um `?channel=` que não resolve —
 * push de canal do qual a pessoa saiu, canal apagado, link antigo — mostrava
 * a lista sem cabeçalho, sem BottomNav e sem seta. No PWA do iPhone não há
 * voltar do sistema: a pessoa ficava presa. O `ChatPage` informa o
 * `AppLayout` (`useInformarConversaAberta`) só quando há seleção.
 */
export function conversaEmTelaCheia(pathname: string, isMobile: boolean, conversaSelecionada: boolean): boolean {
  return isMobile && pathname === "/chat" && conversaSelecionada;
}

/**
 * `?channel=` que não vira conversa nem depois de recarregar a lista de canais
 * deve sair da URL — senão a tela fica num limbo (lista com a URL de conversa).
 * Só decide depois do recarregamento daquele canal: um DM que acabou de ser
 * criado por outra pessoa ainda não está na lista do primeiro carregamento.
 */
export function canalNaoResolve(params: {
  channelParam: string | null;
  recarregadoPara: string | null;
  encontrado: boolean;
}): boolean {
  const { channelParam, recarregadoPara, encontrado } = params;
  return !!channelParam && recarregadoPara === channelParam && !encontrado;
}
