/**
 * Conversas anteriores com o agente — o que não depende de React.
 * Spec: docs/superpowers/specs/2026-10-14-conversas-anteriores-design.md
 *
 * A conversa antiga abre só para leitura. O que a pessoa quiser reaproveitar
 * entra na conversa de HOJE como citação — a sessão antiga não é retomada.
 */

/** Uma conversa encerrada por "Nova conversa", como `GET /anteriores` devolve. */
export interface ConversaAnterior {
  /** uuid do reset que a encerrou — o identificador (o horário não serve). */
  id: string;
  ate: string;
  inicio: string;
  titulo: string;
  mensagens: number;
}

export function citarTrecho(texto: string): string {
  const linhas = texto.replace(/\s+$/, "").split("\n");
  return `${linhas.map((l) => (l.trim() ? `> ${l}` : ">")).join("\n")}\n\n`;
}

/** Acrescenta a citação ao que já estiver no campo — nunca apaga o rascunho. */
export function acrescentarCitacao(rascunho: string, texto: string): string {
  const citacao = citarTrecho(texto);
  if (!rascunho.trim()) return citacao;
  const separador = rascunho.endsWith("\n\n") ? "" : rascunho.endsWith("\n") ? "\n" : "\n\n";
  return `${rascunho}${separador}${citacao}`;
}

/**
 * Para onde a busca global leva um achado de conversa com agente. Da conversa
 * atual, o caminho de sempre; de uma conversa encerrada, o histórico nela — o
 * chat esconderia a mensagem, que é de antes do último "Nova conversa".
 */
export function destinoDaBusca(r: { origem: string; id: string; conversa_anterior?: string | null }): string {
  const agente = encodeURIComponent(r.origem);
  const msg = encodeURIComponent(r.id);
  return r.conversa_anterior
    ? `/chat?agent=${agente}&anterior=${encodeURIComponent(r.conversa_anterior)}&message=${msg}`
    : `/chat?agent=${agente}&message=${msg}`;
}
