/**
 * "Capacidade" do Guardi — o que ele alcança agora, com o login do dono.
 * Spec `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`.
 *
 * Quem diz o que o login pode é cada sistema; o backend junta e agrupa por
 * ASSUNTO (`GET /bots/capacidade/{agent_id}`, `app/capacidade_assuntos.py`).
 * Aqui mora o que a tela decide sem React: o texto de cada estado, o resumo do
 * cartão e as cores de cada assunto.
 */

export type EstadoDaCapacidade = "ok" | "sem_conta" | "fora_do_ar" | "sem_resposta_de_capacidade";

export interface AssuntoDaCapacidade {
  chave: string;
  titulo: string;
  /** Nome do ícone (lucide), da lista `ICONES` do backend. */
  icone: string;
  /** Nome de cor do Tailwind, da lista `CORES` do backend. */
  cor: string;
  /** Frases curtas do que ele consulta. */
  ve: string[];
  /** Frases curtas do que ele faz. Nos sistemas externos tudo vira cartão de confirmação. */
  faz: string[];
  /** Os itens de `faz` que saem na hora, sem cartão (só no HS.OS). */
  na_hora: string[];
  /** Até dois "Experimente: …", só de item que o login alcança. */
  exemplos: string[];
}

export interface SistemaDaCapacidade {
  sistema: string;
  nome: string;
  papel: string | null;
  estado: EstadoDaCapacidade;
  assuntos: AssuntoDaCapacidade[];
}

export interface Capacidade {
  agent_id: string;
  sistemas: SistemaDaCapacidade[];
  /** Memória, lembretes e e-mail: do próprio HS.OS, sem sistema externo. */
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

/** "3 assuntos · vê 12 · faz 4" — o que cabe no cartão fechado. */
export function resumoDoSistema(s: SistemaDaCapacidade): string {
  if (s.estado !== "ok") {
    return { sem_conta: "sem conta", fora_do_ar: "fora do ar", sem_resposta_de_capacidade: "ainda sem resposta" }[s.estado];
  }
  if (s.assuntos.length === 0) return "nada com o seu login";
  const ve = s.assuntos.reduce((n, a) => n + a.ve.length, 0);
  const faz = s.assuntos.reduce((n, a) => n + a.faz.length, 0);
  const partes = [s.assuntos.length === 1 ? "1 assunto" : `${s.assuntos.length} assuntos`];
  if (ve) partes.push(`vê ${ve}`);
  if (faz) partes.push(`faz ${faz}`);
  return partes.join(" · ");
}

/** Algo deste sistema vira cartão de confirmação? (a nota abaixo do título) */
export function temConfirmacao(s: SistemaDaCapacidade): boolean {
  return s.assuntos.some((a) => a.faz.some((f) => !a.na_hora.includes(f)));
}

/**
 * As classes de cada cor. ⚠️ Escritas por extenso de propósito: o Tailwind só
 * gera classe que aparece inteira no código — `bg-${cor}-500` nunca chegaria ao
 * CSS. Cor que o backend mandar e não estiver aqui cai no neutro.
 *
 * Contraste: o texto de destaque é 700 no claro e 300 no escuro, sobre fundo
 * 500 a 10–15% de opacidade — legível nos dois temas.
 */
export interface ClassesDaCor {
  /** a faixa da esquerda do bloco */
  faixa: string;
  /** o quadradinho do ícone */
  icone: string;
  /** o chip do "Faz" */
  chip: string;
  /** o ponto no cartão do sistema */
  ponto: string;
}

const CORES: Record<string, ClassesDaCor> = {
  sky: { faixa: "border-l-sky-500", icone: "bg-sky-500/15 text-sky-700 dark:text-sky-300", chip: "bg-sky-500/10 text-sky-800 ring-sky-500/30 dark:text-sky-200", ponto: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  emerald: { faixa: "border-l-emerald-500", icone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", chip: "bg-emerald-500/10 text-emerald-800 ring-emerald-500/30 dark:text-emerald-200", ponto: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  amber: { faixa: "border-l-amber-500", icone: "bg-amber-500/15 text-amber-700 dark:text-amber-300", chip: "bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-200", ponto: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  violet: { faixa: "border-l-violet-500", icone: "bg-violet-500/15 text-violet-700 dark:text-violet-300", chip: "bg-violet-500/10 text-violet-800 ring-violet-500/30 dark:text-violet-200", ponto: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  rose: { faixa: "border-l-rose-500", icone: "bg-rose-500/15 text-rose-700 dark:text-rose-300", chip: "bg-rose-500/10 text-rose-800 ring-rose-500/30 dark:text-rose-200", ponto: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  teal: { faixa: "border-l-teal-500", icone: "bg-teal-500/15 text-teal-700 dark:text-teal-300", chip: "bg-teal-500/10 text-teal-800 ring-teal-500/30 dark:text-teal-200", ponto: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  indigo: { faixa: "border-l-indigo-500", icone: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", chip: "bg-indigo-500/10 text-indigo-800 ring-indigo-500/30 dark:text-indigo-200", ponto: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  orange: { faixa: "border-l-orange-500", icone: "bg-orange-500/15 text-orange-700 dark:text-orange-300", chip: "bg-orange-500/10 text-orange-800 ring-orange-500/30 dark:text-orange-200", ponto: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  cyan: { faixa: "border-l-cyan-500", icone: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", chip: "bg-cyan-500/10 text-cyan-800 ring-cyan-500/30 dark:text-cyan-200", ponto: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300" },
  fuchsia: { faixa: "border-l-fuchsia-500", icone: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", chip: "bg-fuchsia-500/10 text-fuchsia-800 ring-fuchsia-500/30 dark:text-fuchsia-200", ponto: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300" },
};

const NEUTRA: ClassesDaCor = {
  faixa: "border-l-border",
  icone: "bg-muted text-muted-foreground",
  chip: "bg-muted text-foreground ring-border",
  ponto: "bg-muted text-muted-foreground",
};

/** As cores que a tela sabe desenhar — a mesma lista de `CORES` no backend. */
export const CORES_CONHECIDAS = Object.keys(CORES);

export function classesDaCor(cor: string): ClassesDaCor {
  return CORES[cor] ?? NEUTRA;
}

export function urlDaCapacidade(agentId: string, atualizar = false): string {
  return `/bots/capacidade/${encodeURIComponent(agentId)}${atualizar ? "?atualizar=true" : ""}`;
}
