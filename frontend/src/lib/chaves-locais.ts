/**
 * As chaves que a aplicação guarda no navegador, com o nome antigo migrado.
 *
 * ⚠️ **Renomear chave de `localStorage` é perda de dado silenciosa.** O valor
 * antigo continua lá, sob o nome antigo, e o código novo lê `null` — que quase
 * sempre significa "o padrão". Ninguém vê erro; a pessoa só percebe que o tema
 * voltou ao escuro, que os favoritos sumiram, ou — pior — que uma correção de
 * estabilidade que estava ligada parou de valer.
 *
 * As flags `dnos_flag_*` são o caso grave: elas ligam quatro correções no
 * caminho do chat e vêm **desligadas por padrão**. Uma renomeação sem migração
 * desligaria as de quem as tinha ligado, e o sintoma seria a volta de um bug
 * que já parecia resolvido — sem nada apontando para o rebrand.
 *
 * Por isso a leitura procura o nome novo e, não achando, **adota o antigo e o
 * regrava com o nome novo**. A migração acontece na primeira leitura de cada
 * chave, sem varredura no boot e sem lista para manter em dia.
 */

/** Prefixo antigo → novo. A ordem importa: o mais específico primeiro. */
const RENOMES: ReadonlyArray<readonly [string, string]> = [
  ["dnos_flag_", "hsos_flag_"],
  ["dnos-", "hsos-"],
  ["dnos:", "hsos:"],
];

function nomeAntigo(chave: string): string | null {
  for (const [velho, novo] of RENOMES) {
    if (chave.startsWith(novo)) return velho + chave.slice(novo.length);
  }
  return null;
}

/**
 * Lê a chave, migrando do nome antigo na primeira vez.
 *
 * Devolve `null` quando não existe sob nenhum dos dois nomes — o mesmo
 * contrato do `localStorage.getItem`, para os chamadores não mudarem.
 */
export function lerChave(chave: string): string | null {
  try {
    const atual = localStorage.getItem(chave);
    if (atual !== null) return atual;

    const antigo = nomeAntigo(chave);
    if (!antigo) return null;

    const herdado = localStorage.getItem(antigo);
    if (herdado === null) return null;

    // Regrava sob o nome novo e apaga o antigo: a migração é uma vez só, e
    // deixar os dois convivendo criaria a dúvida de qual vale.
    localStorage.setItem(chave, herdado);
    localStorage.removeItem(antigo);
    return herdado;
  } catch {
    // Modo privado ou armazenamento cheio. Quem chama trata como ausente.
    return null;
  }
}

export function gravarChave(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    /* modo privado */
  }
}

export function apagarChave(chave: string): void {
  try {
    localStorage.removeItem(chave);
    const antigo = nomeAntigo(chave);
    // Apaga o antigo também: senão a próxima leitura o ressuscitaria.
    if (antigo) localStorage.removeItem(antigo);
  } catch {
    /* modo privado */
  }
}
