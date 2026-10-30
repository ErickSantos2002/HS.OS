/**
 * A fronteira do painel de parede: o que sai daqui é sempre desenhável.
 *
 * ⚠️ **Por que existe.** Em 01/09/2026 a War room subiu em produção mostrando
 * "Algo deu errado". O backend implantado era uma versão anterior do
 * `/warroom/feed`, sem o campo `filhos`, e a tela fazia `a.filhos.filter(...)`
 * direto — um campo ausente derrubou o ErrorBoundary e apagou a parede inteira.
 *
 * O erro não foi o campo faltar. Versão de front e de back descasa em todo
 * deploy que não é atômico, e numa TV que ninguém opera isso volta a acontecer.
 * O erro foi a tela confiar na forma da resposta em seis lugares diferentes:
 * espalhar `??` por todos eles é como se esquece de um.
 *
 * ⚠️ **Falta de dado não vira zero.** `contexto` e `diasNoAr` continuam nulos
 * quando ausentes — na parede, `0%` é lido como medição. Mesma régua do
 * `app/warroom.py` e do `coletor_metricas`.
 *
 * ⚠️ **TV pública desde 16/10/2026.** O contrato não tem mais `tarefa`: o
 * rótulo do agente era a pergunta em aberto. Se um backend antigo ainda mandar
 * `tarefa`, ela é descartada aqui — não chega a nenhum componente.
 */

export type Estado = "ocioso" | "pensando" | "longo";
export type StatusPessoa = "reuniao" | "foco" | "almoco" | "ausente";

export interface Pessoa {
  id: string; nome: string; setor: string;
  online: boolean; status: StatusPessoa | null;
}
export interface Agente {
  id: string; nome: string; papel: string; estado: Estado;
  desde: string | null; contexto: number | null; parceiroId: string | null;
  /** Respondeu a esta pessoa há menos de 10 min — a linha fica, sem partícula. */
  recenteCom: string | null;
}
export interface ConversaTime { a: string; b: string; ultima: string }
export interface Evento { ts: string; tipo: "entrega" | "agente" | "time"; texto: string }
export interface Numeros { entregas: number; atendidas: number; pessoasAtivas: number; conversasTime: number }
export interface Feed {
  ts: string; diasNoAr: number | null;
  setores: { nome: string; pessoas: string[] }[];
  pessoas: Pessoa[]; agentes: Agente[]; conversasTime: ConversaTime[];
  eventos: Evento[]; numeros: Numeros;
}

const ESTADOS: Estado[] = ["ocioso", "pensando", "longo"];
const STATUS: StatusPessoa[] = ["reuniao", "foco", "almoco", "ausente"];
const TIPOS: Evento["tipo"][] = ["entrega", "agente", "time"];

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objetos = (v: unknown) =>
  lista(v).filter((o): o is Record<string, unknown> => !!o && typeof o === "object");
const texto = (v: unknown): string => (typeof v === "string" ? v : "");
/** Número ou `null`. Não converte ausência em zero — ver o cabeçalho. */
const numeroOuNulo = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const numero = (v: unknown): number => numeroOuNulo(v) ?? 0;

export function normalizar(bruto: unknown): Feed {
  const f = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const n = (f.numeros && typeof f.numeros === "object" ? f.numeros : {}) as Record<string, unknown>;

  const pessoas: Pessoa[] = objetos(f.pessoas)
    .map((p) => ({
      id: texto(p.id),
      nome: texto(p.nome),
      setor: texto(p.setor) || "Time",
      online: p.online === true,
      status: STATUS.includes(texto(p.status) as StatusPessoa) ? (texto(p.status) as StatusPessoa) : null,
    }))
    .filter((p) => p.id);
  const ids = new Set(pessoas.map((p) => p.id));

  let setores = objetos(f.setores)
    .map((s) => ({ nome: texto(s.nome), pessoas: lista(s.pessoas).map(texto).filter((id) => ids.has(id)) }))
    .filter((s) => s.nome && s.pessoas.length);
  // Backend antigo não manda setores: um anel só, para a TV continuar de pé.
  if (!setores.length && pessoas.length) {
    const porSetor = new Map<string, string[]>();
    for (const p of pessoas) porSetor.set(p.setor, [...(porSetor.get(p.setor) ?? []), p.id]);
    setores = [...porSetor].map(([nome, ps]) => ({ nome, pessoas: ps }));
  }

  return {
    ts: texto(f.ts) || new Date().toISOString(),
    diasNoAr: numeroOuNulo(f.diasNoAr),
    setores,
    pessoas,
    agentes: objetos(f.agentes)
      .map((a): Agente => {
        const estado = texto(a.estado) as Estado;
        const parceiroId = texto(a.parceiroId);
        const recenteCom = texto(a.recenteCom);
        return {
          id: texto(a.id),
          nome: texto(a.nome) || texto(a.id),
          papel: texto(a.papel),
          estado: ESTADOS.includes(estado) ? estado : "ocioso",
          desde: texto(a.desde) || null,
          contexto: numeroOuNulo(a.contexto),
          parceiroId: ids.has(parceiroId) ? parceiroId : null,
          recenteCom: ids.has(recenteCom) ? recenteCom : null,
        };
      })
      .filter((a) => a.id),
    conversasTime: objetos(f.conversasTime)
      .map((c) => ({ a: texto(c.a), b: texto(c.b), ultima: texto(c.ultima) }))
      .filter((c) => c.a && c.b),
    eventos: objetos(f.eventos).map((e) => ({
      ts: texto(e.ts),
      tipo: TIPOS.includes(texto(e.tipo) as Evento["tipo"]) ? (texto(e.tipo) as Evento["tipo"]) : "agente",
      texto: texto(e.texto),
    })),
    numeros: {
      entregas: numero(n.entregas),
      atendidas: numero(n.atendidas),
      pessoasAtivas: numero(n.pessoasAtivas),
      conversasTime: numero(n.conversasTime),
    },
  };
}

/** HH:MM de um instante, ou `—` quando não há instante. `ts` ausente vira ""
 *  no `normalizar`, e `new Date("")` sairia na TV como "Invalid Date". */
export function horaMinuto(ms: number | string): string {
  const d = new Date(ms);
  if (ms === "" || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "N conversas agora": pessoa falando com agente ativo, mais DM vivo entre
 *  pessoas. Agente trabalhando sem ninguém (cron, delegação) não é conversa. */
export function contarConversas(f: Feed): number {
  const comAgente = f.agentes.filter(
    (a) => (a.estado !== "ocioso" && a.parceiroId) || (a.estado === "ocioso" && a.recenteCom));
  return comAgente.length + f.conversasTime.length;
}
