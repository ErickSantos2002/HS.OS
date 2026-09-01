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
 * ⚠️ **Falta de dado não vira zero.** `contexto` e `cacheTaxa` continuam nulos
 * quando ausentes — na parede, `0%` é lido como medição. Mesma régua do
 * `app/warroom.py` e do `coletor_metricas`.
 */

export interface Filho { nome: string; vivo: boolean }
export type Estado = "ocioso" | "pensando" | "longo";

export interface Agente {
  id: string; nome: string; papel: string; estado: Estado;
  tarefa: string | null; desde: string | null;
  contexto: number | null; filhos: Filho[];
  parceiro: string | null; parceiroAgente: string | null;
}
export interface Evento { ts: string; tipo: "entrega" | "autonomo" | "conversa"; texto: string }
export interface Numeros {
  entregas: number; conversas: number; tokens: number;
  custo: number; cacheTaxa: number | null;
}
export interface Feed {
  ts: string; diasNoAr: number | null;
  pessoas: { id: string; nome: string }[];
  agentes: Agente[]; eventos: Evento[]; numeros: Numeros; avisos?: string[];
}

const ESTADOS: Estado[] = ["ocioso", "pensando", "longo"];

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string => (typeof v === "string" ? v : "");
/** Número ou `null`. Não converte ausência em zero — ver o cabeçalho. */
const numeroOuNulo = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const numero = (v: unknown): number => numeroOuNulo(v) ?? 0;

function normalizarAgente(bruto: Record<string, unknown>): Agente | null {
  const id = texto(bruto.id);
  if (!id) return null; // sem id não há onde desenhar o nó
  const estado = texto(bruto.estado) as Estado;
  return {
    id,
    nome: texto(bruto.nome) || id,
    papel: texto(bruto.papel),
    estado: ESTADOS.includes(estado) ? estado : "ocioso",
    tarefa: texto(bruto.tarefa) || null,
    desde: texto(bruto.desde) || null,
    contexto: numeroOuNulo(bruto.contexto),
    filhos: lista(bruto.filhos)
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .map((f) => ({ nome: texto(f.nome), vivo: f.vivo !== false })),
    parceiro: texto(bruto.parceiro) || null,
    parceiroAgente: texto(bruto.parceiroAgente) || null,
  };
}

export function normalizar(bruto: unknown): Feed {
  const f = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const n = (f.numeros && typeof f.numeros === "object"
    ? f.numeros : {}) as Record<string, unknown>;
  return {
    ts: texto(f.ts) || new Date().toISOString(),
    diasNoAr: numeroOuNulo(f.diasNoAr),
    pessoas: lista(f.pessoas)
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p) => ({ id: texto(p.id), nome: texto(p.nome) }))
      .filter((p) => p.id),
    agentes: lista(f.agentes)
      .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
      .map(normalizarAgente)
      .filter((a): a is Agente => a !== null),
    eventos: lista(f.eventos)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        ts: texto(e.ts),
        tipo: (["entrega", "autonomo", "conversa"].includes(texto(e.tipo))
          ? texto(e.tipo) : "conversa") as Evento["tipo"],
        texto: texto(e.texto),
      })),
    numeros: {
      entregas: numero(n.entregas),
      conversas: numero(n.conversas),
      tokens: numero(n.tokens),
      custo: numero(n.custo),
      cacheTaxa: numeroOuNulo(n.cacheTaxa),
    },
    avisos: lista(f.avisos).map(texto).filter(Boolean),
  };
}
