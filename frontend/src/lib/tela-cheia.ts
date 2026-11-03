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
