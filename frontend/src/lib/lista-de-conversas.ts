/**
 * Ordem e busca das listas laterais do chat (DMs e Agentes).
 *
 * Desde 20/10/2026 a lateral funciona como o WhatsApp: não existe mais a aba
 * "Não lidas" nem o botão "Nova conversa". Quem tem mensagem por ler sobe para
 * o topo com o contador; depois vem quem conversou por último; e quem nunca
 * conversou fica embaixo, em ordem alfabética — todas as pessoas aparecem,
 * para começar uma conversa basta clicar.
 *
 * ⚠️ **A aba "Não lidas" saiu porque abria a conversa por um caminho próprio,
 * e esse caminho perdia mensagem.** O clique marcava como lida ANTES de saber
 * se conseguia abrir; quando o canal não estava na lista carregada (DM que a
 * outra pessoa acabou de criar), nada abria e a notificação sumia. Foi o que
 * aconteceu com a primeira mensagem do Gustavo, em 20/10/2026. Na lista daqui a
 * conversa só deixa de contar como não lida quando é aberta de fato.
 */

export interface ItemDaLista {
  nome: string;
  /** Epoch em ms da última mensagem; 0 quando nunca houve conversa. */
  ultimaAtividade: number;
  naoLidas: number;
}

/** Não lidas primeiro, depois a mais recente, depois quem nunca conversou
 *  em ordem alfabética. Não altera a lista recebida. */
export function ordenarConversas<T extends ItemDaLista>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const aNaoLida = a.naoLidas > 0;
    const bNaoLida = b.naoLidas > 0;
    if (aNaoLida !== bNaoLida) return aNaoLida ? -1 : 1;
    if (a.ultimaAtividade !== b.ultimaAtividade) return b.ultimaAtividade - a.ultimaAtividade;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

/** Sem acento e em minúsculas: "Gestão" casa com "gestao". */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** A busca casa qualquer um dos campos — nome, e-mail, setor, cargo. Era o
 *  que o diálogo "Nova conversa" fazia, e "quem é do comercial?" continua
 *  sendo a pergunta real de quem procura alguém. */
export function casaBusca(campos: Array<string | null | undefined>, termo: string): boolean {
  const t = normalizar(termo.trim());
  if (!t) return true;
  return campos.some((campo) => normalizar(campo || "").includes(t));
}
