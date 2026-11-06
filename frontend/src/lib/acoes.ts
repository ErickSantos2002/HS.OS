/**
 * Ações que o bot pessoal preparou num sistema (TaskHS) e esperam o dono
 * (spec 2026-11-05-bot-sistemas-internos). O cartão mostra os CAMPOS do
 * payload — é exatamente o que o servidor executa ao confirmar.
 */
import { api } from "@/lib/api";

export interface Acao {
  id: string;
  status: string;
  sistema: string;
  acao: string;
  resumo: string;
  payload: Record<string, unknown>;
  resultado?: string | null;
  erro?: string | null;
}

export const verAcao = (id: string) => api<Acao>(`/acoes/${encodeURIComponent(id)}`);
export const confirmarAcao = (id: string) =>
  api<{ status: string; resultado?: string }>(`/acoes/${encodeURIComponent(id)}/confirmar`, { method: "POST" });
export const cancelarAcao = (id: string) =>
  api<{ status: string }>(`/acoes/${encodeURIComponent(id)}/cancelar`, { method: "POST" });
export const verMemoria = () => api<{ bot: string; bot_nome?: string; linhas: string[] }>("/bots/memoria");
export const apagarLinhaMemoria = (i: number) => api<{ linhas: string[] }>(`/bots/memoria/${i}`, { method: "DELETE" });
export const apagarMemoria = () => api<{ linhas: string[] }>("/bots/memoria", { method: "DELETE" });

const STATUS: Record<string, string> = {
  pendente: "Aguardando sua confirmação",
  feita: "✓ Feito",
  cancelada: "Cancelada",
  vencida: "Vencida",
  erro: "Não foi feito",
};
export const rotuloAcao = (s: string) => STATUS[s] ?? s;

const CAMPO: Record<string, string> = {
  done: "Concluída", due_date: "Prazo", priority: "Prioridade", title: "Título", due_date_completed: "Prazo cumprido",
};
const PRIORIDADE: Record<string, string> = { low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica" };
const v = (x: unknown) => (typeof x === "boolean" ? (x ? "sim" : "não") : String(x));
const prazo = (x: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(x);
};
const legivel = (k: string, x: unknown) =>
  k === "priority" ? PRIORIDADE[String(x)] ?? v(x) : k === "due_date" ? prazo(x) : v(x);

/** O cartão em partes separadas — tudo num bloco só confundia (06/11/2026).
 *  Os VALORES vêm do payload (o que o servidor executa); `_exibir` só dá nome
 *  ao que no payload é id (a lista, a tarefa, o item). */
export interface CartaoDaAcao {
  verbo: string;
  titulo: string;
  linhas: [string, string][];
  texto?: { rotulo: string; valor: string };
  checklist?: { titulo: string; itens: { texto: string; feito?: boolean }[] };
}

export function cartaoDaAcao(acao: string, p: Record<string, unknown>): CartaoDaAcao {
  const ex = (p._exibir as Record<string, unknown> | undefined) ?? {};
  const lista = (id: unknown, nome: unknown) => (nome ? String(nome) : `lista ${v(id)}`);
  const tarefa = ex.tarefa ? String(ex.tarefa) : `card ${v(p.card_id)}`;
  const cl = p.checklist as { title?: string; items?: string[] } | undefined;
  const checklist = cl?.items?.length
    ? { titulo: cl.title || "Checklist", itens: cl.items.map((texto) => ({ texto })) }
    : undefined;
  if (acao === "criar") {
    const linhas: [string, string][] = [["Lista", lista(p.list_id, ex.lista)], ["Membro", "você"]];
    if (p.priority) linhas.push(["Prioridade", legivel("priority", p.priority)]);
    if (p.due_date) linhas.push(["Prazo", legivel("due_date", p.due_date)]);
    return { verbo: "Nova tarefa", titulo: v(p.title), linhas, checklist,
             texto: p.description ? { rotulo: "Descrição", valor: v(p.description) } : undefined };
  }
  if (acao === "mover")
    return { verbo: "Mover tarefa", titulo: tarefa, linhas: [["Para", lista(p.para_list_id, ex.para_lista)]] };
  if (acao === "comentar")
    return { verbo: "Comentar", titulo: tarefa, linhas: [], texto: { rotulo: "Comentário", valor: v(p.texto) } };
  if (acao === "atualizar") {
    const linhas = Object.entries((p.campos as Record<string, unknown>) ?? {})
      .map(([k, x]) => [CAMPO[k] ?? k, legivel(k, x)] as [string, string]);
    const nomes = (ex.itens as Record<string, string> | undefined) ?? {};
    const marcar = (p.marcar_itens as { checklist_id: number; item_id: number; checked: boolean }[] | undefined) ?? [];
    const marcados = marcar.map((m) => ({
      texto: nomes[`${m.checklist_id}:${m.item_id}`] || `item ${m.item_id}`, feito: m.checked }));
    return {
      verbo: "Atualizar tarefa", titulo: tarefa, linhas,
      checklist: checklist ?? (marcados.length ? { titulo: "Marcar no checklist", itens: marcados } : undefined),
    };
  }
  return { verbo: acao, titulo: "", linhas: Object.entries(p).filter(([k]) => k !== "_exibir").map(([k, x]) => [k, v(x)]) };
}
