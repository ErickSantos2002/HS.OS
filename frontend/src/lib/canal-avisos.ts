/**
 * Canal de avisos — só os escolhidos (e o administrador) enviam mensagens.
 * Spec: `docs/superpowers/specs/2026-10-30-canal-so-alguns-escrevem-design.md`.
 *
 * ⚠️ A trava é o banco (policy da 021). Isto decide só o que a tela mostra: a
 * caixa de texto ou o aviso no lugar dela. A frase é a MESMA do backend
 * (`frase_de_quem_escreve`), para o aviso e a recusa não dizerem coisas
 * diferentes — mude as duas juntas.
 */

export function fraseDeQuemEscreve(nomes: string[]): string {
  if (nomes.length === 0) return "Só o administrador envia mensagens neste canal.";
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `Só ${lista} ${nomes.length === 1 ? "envia" : "enviam"} mensagens neste canal.`;
}

export function podeEscreverNoCanal(opts: {
  soAlgunsEscrevem: boolean | undefined;
  souAdmin: boolean;
  /** `pode_escrever` da minha linha em `channel_members`; `undefined` se não sou membro. */
  meuPodeEscrever: boolean | undefined;
}): boolean {
  if (!opts.soAlgunsEscrevem) return true;
  return opts.souAdmin || opts.meuPodeEscrever === true;
}
