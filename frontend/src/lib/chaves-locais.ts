/**
 * As chaves que a aplicação guarda no navegador, com o nome antigo migrado.
 *
 * ⚠️ **Renomear chave de `localStorage` é perda de dado silenciosa.** O valor
 * antigo continua lá, sob o nome antigo, e o código novo lê `null` — que quase
 * sempre significa "o padrão". Ninguém vê erro; a pessoa só percebe que o tema
 * voltou ao escuro, que os favoritos sumiram, ou — pior — que uma correção de
 * estabilidade que estava ligada parou de valer.
 *
 * A flag `dnos_flag_real_stop` é o caso grave, e é a única que sobrou: ela
 * decide se "parar" aborta o agente no gateway ou só o poll do navegador, e
 * desde 31/08/2026 vem **ligada por padrão** (grava `off` para voltar ao
 * antigo). Uma renomeação sem migração RELIGARIA a de quem a tinha desligado
 * de propósito, e o sintoma seria um comportamento que a pessoa já tinha
 * recusado — sem nada apontando para o rebrand.
 *
 * ⚠️ Este comentário dizia "quatro correções, desligadas por padrão" até
 * 03/09/2026. Eram três no código, duas já não faziam nada, e a que restou
 * tinha trocado de padrão. Comentário que descreve um sistema que mudou custa
 * o mesmo que documentação errada — só que mais perto de quem vai mexer.
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

/**
 * Cancelamento real: "parar" também manda `/stop` ao gateway?
 *
 * ⚠️ **Ligada por padrão desde 31/08/2026, e a inversão é o conserto.** Nasceu
 * como opt-in em `chat-sender.ts` e ninguém nunca a ligou — nem em produção.
 * Com ela desligada, "parar" só aborta o poll do navegador: a resposta some da
 * tela e **o agente continua rodando e gastando no gateway até terminar**. O
 * comportamento que parecia seguro (opt-in) era o que desperdiçava.
 *
 * Fica aqui, e não no `chat-sender`, para poder ser testada sem levantar a
 * camada de rede junto — e porque a migração do nome antigo é assunto deste
 * arquivo: quem desligou como `dnos_flag_real_stop` continua desligado.
 */
export function cancelamentoRealLigado(): boolean {
  return lerChave("hsos_flag_real_stop") !== "off";
}
