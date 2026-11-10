/**
 * Responder citando — no celular, deslizar a bolha (spec 2026-11-03, item 4);
 * no desktop e na folha do celular, o "Responder" das ações da mensagem, que
 * substituiu o "Responder em thread" em 10/11/2026.
 *
 * Não existe coluna de "resposta a" no banco, e não vale criar uma para isto:
 * a citação vai no próprio texto, em Markdown — `> **Autor:** trecho`. É o
 * mesmo formato que o "Citar" das conversas anteriores já usa
 * (`acrescentarCitacao`).
 * Celular e desktop reconhecem o bloco e desenham o cartão da citação.
 */

const LIMITE_TRECHO = 140;

export interface Citacao {
  autor: string;
  texto: string;
}

/** O trecho citado: uma linha só, sem a citação que a própria mensagem já trazia. */
export function trechoParaCitar(conteudo: string): string {
  const { resto } = separarCitacao(conteudo);
  const linha = resto.replace(/\s+/g, " ").trim();
  return linha.length > LIMITE_TRECHO ? `${linha.slice(0, LIMITE_TRECHO).trimEnd()}…` : linha;
}

/**
 * Quem a citação nomeia: o nome de verdade, também quando a mensagem citada é
 * minha. "Você" gravado no texto seria lido como "você" por todos os outros.
 */
export function autorDaCitacao(ehMinha: boolean, meuNome: string, nomeDoAutor: string): string {
  return ehMinha ? meuNome : nomeDoAutor;
}

export function montarResposta(citacao: Citacao | null, texto: string): string {
  if (!citacao) return texto;
  return `> **${citacao.autor}:** ${citacao.texto}\n\n${texto}`;
}

const PADRAO = /^> \*\*(.+?):\*\* (.*)\n\n([\s\S]*)$/;

export function separarCitacao(conteudo: string): { citacao: Citacao | null; resto: string } {
  const m = PADRAO.exec(conteudo ?? "");
  if (!m) return { citacao: null, resto: conteudo ?? "" };
  return { citacao: { autor: m[1], texto: m[2] }, resto: m[3] };
}

/**
 * A mensagem que uma citação aponta, para o clique levar até ela (10/11/2026).
 * A citação não guarda id — é texto —, então procura pelo trecho, de trás
 * para a frente a partir da resposta. `null` quando a citada não está na
 * lista (apagada, ou numa página que ainda não carregou).
 */
export function acharCitada(
  mensagens: ReadonlyArray<{ id: string; content: string | null }>,
  idDaResposta: string,
  citacao: Citacao,
): string | null {
  const fim = mensagens.findIndex((m) => m.id === idDaResposta);
  for (let i = (fim < 0 ? mensagens.length : fim) - 1; i >= 0; i--) {
    if (trechoParaCitar(mensagens[i].content || "") === citacao.texto) return mensagens[i].id;
  }
  return null;
}
