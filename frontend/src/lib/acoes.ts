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
export const verMemoria = () => api<{ bot: string; linhas: string[] }>("/bots/memoria");
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
const v = (x: unknown) => (typeof x === "boolean" ? (x ? "sim" : "não") : String(x));

export function camposDaAcao(acao: string, p: Record<string, unknown>): [string, string][] {
  const tarefa: [string, string] = ["Tarefa", `card ${p.card_id} (lista ${p.list_id})`];
  if (acao === "mover") return [tarefa, ["Para a lista", v(p.para_list_id)]];
  if (acao === "comentar") return [tarefa, ["Comentário", v(p.texto)]];
  if (acao === "atualizar")
    return [tarefa, ...Object.entries((p.campos as Record<string, unknown>) ?? {}).map(([k, x]) => [CAMPO[k] ?? k, v(x)] as [string, string])];
  if (acao === "criar") {
    const out: [string, string][] = [["Na lista", v(p.list_id)], ["Título", v(p.title)], ["Membro", "você"]];
    if (p.description) out.push(["Descrição", v(p.description)]);
    if (p.priority) out.push(["Prioridade", v(p.priority)]);
    if (p.due_date) out.push(["Prazo", v(p.due_date)]);
    return out;
  }
  return Object.entries(p).map(([k, x]) => [k, v(x)]);
}
