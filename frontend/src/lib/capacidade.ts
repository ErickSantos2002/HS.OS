/**
 * "Capacidade" do Guardi — o que ele alcança agora, com o login do dono.
 * Spec `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`.
 *
 * Quem diz o que o login pode é cada sistema; o backend só junta
 * (`GET /bots/capacidade/{agent_id}`). Aqui mora o que a tela precisa decidir
 * sem React: o texto de cada estado e o resumo da linha.
 */

export type EstadoDaCapacidade = "ok" | "sem_conta" | "fora_do_ar" | "sem_resposta_de_capacidade";

export interface ItemDaCapacidade {
  rotulo: string;
  exemplo?: string;
  /** Só em "fazer": `true` = vira cartão e espera o clique; `false` = sai na hora. */
  confirma?: boolean;
}

export interface SistemaDaCapacidade {
  sistema: string;
  nome: string;
  papel: string | null;
  estado: EstadoDaCapacidade;
  consultar: ItemDaCapacidade[];
  fazer: ItemDaCapacidade[];
}

export interface Capacidade {
  agent_id: string;
  sistemas: SistemaDaCapacidade[];
  /** Memória, agenda e e-mail: do próprio HS.OS, sem sistema externo. */
  no_hsos: SistemaDaCapacidade[];
}

/**
 * A linha de explicação de um estado que não é `ok`. ⚠️ Sistema sem resposta
 * de capacidade NUNCA mostra lista: seria afirmar o que o login pode não fazer.
 */
export function textoDoEstado(estado: EstadoDaCapacidade): string | null {
  switch (estado) {
    case "sem_conta":
      return "Você não tem conta ativa neste sistema — ou o acesso do Guardi ainda não foi ligado lá.";
    case "fora_do_ar":
      return "Fora do ar agora. Tente atualizar daqui a pouco.";
    case "sem_resposta_de_capacidade":
      return "Ainda não sei dizer o que o seu login permite aqui; pergunte ao Guardi.";
    default:
      return null;
  }
}

/** "consulta 12 · faz 3" — o que cabe na linha do sistema fechado. */
export function resumoDoSistema(s: SistemaDaCapacidade): string {
  if (s.estado !== "ok") {
    return { sem_conta: "sem conta", fora_do_ar: "fora do ar", sem_resposta_de_capacidade: "ainda sem resposta" }[s.estado];
  }
  const partes = [];
  if (s.consultar.length) partes.push(`consulta ${s.consultar.length}`);
  if (s.fazer.length) partes.push(`faz ${s.fazer.length}`);
  return partes.join(" · ") || "nada com o seu login";
}

/** Título da seção "Fazer": nos sistemas externos tudo vira cartão; no HS.OS, nem tudo. */
export function tituloDoFazer(itens: ItemDaCapacidade[]): string {
  return itens.length > 0 && itens.every((i) => i.confirma) ? "Fazer (com sua confirmação)" : "Fazer";
}

export function urlDaCapacidade(agentId: string, atualizar = false): string {
  return `/bots/capacidade/${encodeURIComponent(agentId)}${atualizar ? "?atualizar=true" : ""}`;
}
