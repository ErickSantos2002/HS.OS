/**
 * Agenda do Guardi: lembretes e eventos do Outlook (spec
 * 2026-11-09-agenda-lembretes). As contas de dia são em hora de BRASÍLIA,
 * como no servidor: `proximo_em` já vem com `-03:00` e o "hoje" do
 * navegador é convertido antes de comparar.
 *
 * ⚠️ Dia da semana é 0 = segunda, como em `app/agenda/regras.py`. O
 * `getDay()` do JavaScript começa no domingo — misturar os dois muda o dia
 * de todo lembrete semanal.
 */
import { api } from "@/lib/api";

export type RegraLembrete =
  | { tipo: "unico"; em: string }
  | { tipo: "diario"; hora: string }
  | { tipo: "dias_uteis"; hora: string }
  | { tipo: "semanal"; dias: number[]; hora: string }
  | { tipo: "mensal"; dia: number; hora: string };

export type StatusLembrete = "entregue" | "entregue_sem_agente" | "perdido" | "erro";

export interface Lembrete {
  id: string;
  titulo: string;
  instrucao: string | null;
  regra: RegraLembrete;
  /** ISO em Brasília; nulo quando o único já disparou. */
  proximo_em: string | null;
  ativo: boolean;
  criado_por: "pessoa" | "guardi";
  ultimo_disparo_em: string | null;
  ultimo_status: StatusLembrete | null;
}

export interface EventoOutlook {
  titulo: string;
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  local: string;
  ocupado: boolean;
}

export type EstadoOutlook = "ok" | "sem_conta" | "sem_permissao" | "erro";

// ── datas em Brasília ───────────────────────────────────────────────────

const FMT_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});

/** "AAAA-MM-DD" do instante em Brasília. */
export const diaEmBrasilia = (d: Date): string => FMT_DIA.format(d);

const paraUTC = (dia: string) => {
  const [a, m, d] = dia.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
};
const diferencaEmDias = (de: string, ate: string) => Math.round((paraUTC(ate) - paraUTC(de)) / 86_400_000);
/** 0 = segunda … 6 = domingo. */
const diaDaSemana = (dia: string) => (new Date(paraUTC(dia)).getUTCDay() + 6) % 7;
const ultimoDiaDoMes = (dia: string) => {
  const [a, m] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};
export const somarDias = (dia: string, n: number): string =>
  new Date(paraUTC(dia) + n * 86_400_000).toISOString().slice(0, 10);

/** Chave de ordem: o próximo disparo, ou o marcado se já passou; sem data vai
 *  para o fim (como o `NULLS LAST` do servidor). */
const momento = (l: Lembrete): string =>
  (l.proximo_em ?? (l.regra.tipo === "unico" ? l.regra.em : "\uffff")).slice(0, 16);

// ── agrupamento da lista ────────────────────────────────────────────────

export interface Grupos {
  hoje: Lembrete[];
  amanha: Lembrete[];
  /** Depois de amanhã até o domingo desta semana. */
  semana: Lembrete[];
  depois: Lembrete[];
  recorrentes: Lembrete[];
  pausados: Lembrete[];
  /** Únicos que já dispararam: ficam visíveis com o status do disparo. */
  passados: Lembrete[];
}

export type Periodo = "passado" | "hoje" | "amanha" | "semana" | "depois";

/** Em que grupo da lista cai um dia ("AAAA-MM-DD"), visto de `hoje`. */
export function periodoDoDia(dia: string, hoje: Date): Periodo {
  const ref = diaEmBrasilia(hoje);
  const n = diferencaEmDias(ref, dia);
  if (n < 0) return "passado";
  if (n === 0) return "hoje";
  if (n === 1) return "amanha";
  return n <= 6 - diaDaSemana(ref) ? "semana" : "depois";
}

export function agruparPorPeriodo(lembretes: Lembrete[], hoje: Date): Grupos {
  const g: Grupos = { hoje: [], amanha: [], semana: [], depois: [], recorrentes: [], pausados: [], passados: [] };
  for (const l of [...lembretes].sort((a, b) => momento(a).localeCompare(momento(b)))) {
    if (!l.ativo) g.pausados.push(l);
    else if (l.regra.tipo !== "unico") g.recorrentes.push(l);
    else if (!l.proximo_em) g.passados.push(l);
    else {
      // `proximo_em` no passado ainda não disparou (o disparador está para
      // passar): fica em "hoje", não em "passados".
      const p = periodoDoDia(l.proximo_em.slice(0, 10), hoje);
      g[p === "passado" ? "hoje" : p].push(l);
    }
  }
  return g;
}

// ── frases ──────────────────────────────────────────────────────────────

const DIAS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const emLista = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);

export function descreverRegra(r: RegraLembrete): string {
  switch (r.tipo) {
    case "unico": {
      const [d, h] = r.em.split("T");
      const [, m, dd] = d.split("-");
      return `${dd}/${m} às ${h}`;
    }
    case "diario":
      return `Todo dia às ${r.hora}`;
    case "dias_uteis":
      return `Dias úteis às ${r.hora}`;
    case "semanal": {
      const dias = [...new Set(r.dias)].sort((a, b) => a - b);
      if (dias.length === 7) return `Todo dia às ${r.hora}`;
      if (dias.length === 1) return `${dias[0] >= 5 ? "Todo" : "Toda"} ${DIAS[dias[0]]} às ${r.hora}`;
      return `${maiuscula(emLista(dias.map((d) => DIAS[d])))} às ${r.hora}`;
    }
    case "mensal":
      return `Dia ${r.dia} de todo mês às ${r.hora}`;
  }
}

const STATUS: Record<StatusLembrete, string> = {
  entregue: "Entregue",
  entregue_sem_agente: "Entregue (sem o Guardi agir)",
  perdido: "Perdido",
  erro: "Erro",
};
export const rotuloStatus = (s: StatusLembrete) => STATUS[s] ?? s;

/** "09/11 às 14:05" de um ISO de Brasília. */
export const quandoLegivel = (iso: string) => descreverRegra({ tipo: "unico", em: iso.slice(0, 16) });

// ── calendário ──────────────────────────────────────────────────────────

/** A regra cai neste dia ("AAAA-MM-DD")? */
export function ocorreNoDia(r: RegraLembrete, dia: string): boolean {
  switch (r.tipo) {
    case "unico":
      return r.em.slice(0, 10) === dia;
    case "diario":
      return true;
    case "dias_uteis":
      return diaDaSemana(dia) < 5;
    case "semanal":
      return r.dias.includes(diaDaSemana(dia));
    case "mensal":
      return Number(dia.slice(8, 10)) === Math.min(r.dia, ultimoDiaDoMes(dia));
  }
}

/** Lembrete aparece no dia: único pelo dia marcado, recorrente pela regra. */
export const lembreteNoDia = (l: Lembrete, dia: string) => l.ativo && ocorreNoDia(l.regra, dia);

/** Dias de `de` a `ate` (inclusive) com algum lembrete ativo. */
export function diasComLembrete(lembretes: Lembrete[], de: string, ate: string): Set<string> {
  const dias = new Set<string>();
  for (let d = de; d <= ate; d = somarDias(d, 1)) {
    if (lembretes.some((l) => lembreteNoDia(l, d))) dias.add(d);
  }
  return dias;
}

/** Dias que um evento cobre (o `fim` de dia inteiro é exclusivo, como no Graph). */
export function diasDoEvento(e: EventoOutlook): string[] {
  const ini = e.inicio.slice(0, 10);
  let fim = e.fim.slice(0, 10);
  if (fim > ini && (e.dia_inteiro || e.fim.slice(11, 16) === "00:00")) fim = somarDias(fim, -1);
  const dias: string[] = [];
  for (let d = ini; d <= fim && dias.length < 62; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

// ── formulário ──────────────────────────────────────────────────────────

export type TipoRepeticao = "diario" | "dias_uteis" | "semanal" | "mensal";

export interface CamposQuando {
  modo: "unico" | "repetir";
  data: string;
  hora: string;
  tipo: TipoRepeticao;
  dias: number[];
  dia: number;
}

/** O que o formulário manda: `quando` OU `repetir`, nunca os dois. */
export function regraDoFormulario(c: CamposQuando): { quando: string } | { repetir: RegraLembrete } {
  if (c.modo === "unico") return { quando: `${c.data}T${c.hora}` };
  if (c.tipo === "semanal") return { repetir: { tipo: "semanal", dias: [...new Set(c.dias)].sort((a, b) => a - b), hora: c.hora } };
  if (c.tipo === "mensal") return { repetir: { tipo: "mensal", dia: c.dia, hora: c.hora } };
  return { repetir: { tipo: c.tipo, hora: c.hora } };
}

/** Campos do formulário a partir de um lembrete (edição). */
export function camposDaRegra(r: RegraLembrete): CamposQuando {
  const base: CamposQuando = { modo: "repetir", data: "", hora: "09:00", tipo: "diario", dias: [], dia: 1 };
  if (r.tipo === "unico") return { ...base, modo: "unico", data: r.em.slice(0, 10), hora: r.em.slice(11, 16) };
  if (r.tipo === "semanal") return { ...base, tipo: "semanal", dias: r.dias, hora: r.hora };
  if (r.tipo === "mensal") return { ...base, tipo: "mensal", dia: r.dia, hora: r.hora };
  return { ...base, tipo: r.tipo, hora: r.hora };
}

// ── API ─────────────────────────────────────────────────────────────────

export interface NovoLembrete {
  titulo: string;
  quando?: string;
  repetir?: RegraLembrete;
  instrucao?: string | null;
}

const janela = (de?: string, ate?: string) => {
  const q = new URLSearchParams();
  if (de) q.set("de", de);
  if (ate) q.set("ate", ate);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const listarLembretes = (de?: string, ate?: string) =>
  api<{ lembretes: Lembrete[] }>(`/agenda/lembretes${janela(de, ate)}`).then((r) => r.lembretes);
export const criarLembrete = (dados: NovoLembrete) =>
  api<Lembrete>("/agenda/lembretes", { method: "POST", body: dados });
export const editarLembrete = (id: string, dados: Partial<NovoLembrete> & { pausado?: boolean }) =>
  api<Lembrete>(`/agenda/lembretes/${encodeURIComponent(id)}`, { method: "PATCH", body: dados });
export const apagarLembrete = (id: string) =>
  api<void>(`/agenda/lembretes/${encodeURIComponent(id)}`, { method: "DELETE" });
/** `ate` é inclusivo quando é data pura; a janela vai até 62 dias. */
export const eventosOutlook = (de: string, ate: string) =>
  api<{ estado: EstadoOutlook; eventos: EventoOutlook[] }>(`/agenda/outlook${janela(de, ate)}`);
