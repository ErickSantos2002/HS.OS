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

/** Nome do sistema no cabeçalho do cartão. */
const SISTEMA: Record<string, string> = { taskhs: "TaskHS", gestorhs: "GestorHS" };
export const nomeDoSistema = (s?: string) => (s ? SISTEMA[s] ?? s : "");

const TIPO_SERVICO: Record<string, string> = { C: "calibração", M: "manutenção", A: "calibração e manutenção" };
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

interface AparelhoDoLote {
  equipamento_cliente: number; tipo_servico: string; condicao_chegada?: string | null;
  checklist?: number[]; pilhas?: number; bocais?: number; observacoes?: string | null;
}
interface LinhaDoLote { cliente?: string; modelo?: string; serie?: string; acessorios?: string[] }

/** GestorHS, fase 2a (Expedição, 12/11/2026). Os nomes de ação não colidem com
 *  os do TaskHS — o despacho daqui é pelo nome. O que vai em cada OS sai do
 *  `payload` (o que executa); cliente, modelo e série vêm do `_exibir`. */
function cartaoDoGestorHS(acao: string, p: Record<string, unknown>, ex: Record<string, unknown>): CartaoDaAcao | null {
  const caixa = (id: unknown) => `Caixa ${v(id)}`;
  if (acao === "receber") {
    const aparelhos = (p.aparelhos as AparelhoDoLote[] | undefined) ?? [];
    const rotulos = (ex.linhas as LinhaDoLote[] | undefined) ?? [];
    const linhas: [string, string][] = [["Aparelhos", String(aparelhos.length)]];
    const clientes = Number(ex.clientes ?? 1);
    // ⚠️ Série falada pode ser de aparelho de outro cliente: com mais de um
    // cliente no lote, o cartão chama a atenção para conferir linha a linha.
    if (clientes > 1) linhas.push(["Clientes", `${clientes} — confira`]);
    if (p.data_chegada) linhas.push(["Chegada", prazo(p.data_chegada)]);
    const itens = aparelhos.map((a, i) => {
      const r = rotulos[i] ?? {};
      const partes = [r.modelo || "aparelho", `série ${r.serie || `id ${a.equipamento_cliente}`}`,
                      r.cliente || "cliente ?", TIPO_SERVICO[a.tipo_servico] ?? a.tipo_servico];
      if (a.condicao_chegada) partes.push(a.condicao_chegada);
      const acess = r.acessorios?.length ? r.acessorios : (a.checklist ?? []).map((n) => `acessório ${n}`);
      if (acess.length) partes.push(acess.join(", "));
      if (a.pilhas) partes.push(plural(a.pilhas, "pilha", "pilhas"));
      if (a.bocais) partes.push(plural(a.bocais, "bocal", "bocais"));
      if (a.observacoes) partes.push(`obs.: ${a.observacoes}`);
      return { texto: partes.join(" · ") };
    });
    return {
      verbo: "Receber aparelhos", titulo: p.caixa ? caixa(p.caixa) : "Caixa nova", linhas,
      checklists: itens.length ? [{ titulo: "Uma OS por aparelho", itens }] : [],
      texto: ex.aviso ? { rotulo: "Atenção", valor: String(ex.aviso) } : undefined,
    };
  }
  if (acao === "avancar_caixa") {
    const linhas: [string, string][] = [["Fase atual", v(ex.fase ?? "?")], ["OS", v(ex.total_os ?? "?")]];
    if (ex.cliente_principal) linhas.push(["Cliente principal", String(ex.cliente_principal)]);
    return { verbo: "Avançar caixa", titulo: caixa(p.caixa), linhas, checklists: [],
             texto: p.obs ? { rotulo: "Observação", valor: v(p.obs) } : undefined };
  }
  if (acao === "fechar_caixa") {
    const linhas: [string, string][] = [["Rastreio", v(p.cod_retorno)]];
    if (ex.total_os != null) linhas.push(["OS", v(ex.total_os)]);
    const clientes = (ex.clientes as string[] | undefined) ?? [];
    if (clientes.length) linhas.push([clientes.length === 1 ? "Cliente" : "Clientes", clientes.join(", ")]);
    return { verbo: "Fechar caixa", titulo: caixa(p.caixa), linhas, checklists: [],
             texto: p.obs ? { rotulo: "Observação", valor: v(p.obs) } : undefined };
  }
  if (acao === "cadastrar_aparelho") {
    const linhas: [string, string][] = [
      ["Cliente", ex.cliente ? String(ex.cliente) : `cliente ${v(p.cliente)}`],
      ["Modelo", ex.modelo ? String(ex.modelo) : `modelo ${v(p.equipamento)}`]];
    if (p.patrimonio) linhas.push(["Patrimônio", v(p.patrimonio)]);
    if (p.datacompra) linhas.push(["Compra", prazo(p.datacompra)]);
    if (p.ult_calibragem) linhas.push(["Última calibração", prazo(p.ult_calibragem)]);
    if (p.prox_calibragem) linhas.push(["Próxima calibração", prazo(p.prox_calibragem)]);
    return { verbo: "Cadastrar aparelho", titulo: `Série ${v(p.serie)}`, linhas, checklists: [] };
  }
  return null;
}

/** O cartão em partes separadas — tudo num bloco só confundia (06/11/2026).
 *  Os VALORES vêm do payload (o que o servidor executa); `_exibir` só dá nome
 *  ao que no payload é id (a lista, a tarefa, o item). */
export interface CartaoDaAcao {
  verbo: string;
  titulo: string;
  linhas: [string, string][];
  texto?: { rotulo: string; valor: string };
  /** Lista: um checklist novo E itens a marcar podem vir juntos, e o dono
   *  tem que ver os dois — esconder um aprovaria o que não foi mostrado. */
  checklists: { titulo: string; itens: { texto: string; feito?: boolean }[] }[];
}

export function cartaoDaAcao(acao: string, p: Record<string, unknown>): CartaoDaAcao {
  const ex = (p._exibir as Record<string, unknown> | undefined) ?? {};
  const lista = (id: unknown, nome: unknown) => (nome ? String(nome) : `lista ${v(id)}`);
  const tarefa = ex.tarefa ? String(ex.tarefa) : `card ${v(p.card_id)}`;
  const cl = p.checklist as { title?: string; items?: string[] } | undefined;
  const checklists = cl?.items?.length
    ? [{ titulo: cl.title || "Checklist", itens: cl.items.map((texto) => ({ texto })) }]
    : [];
  if (acao === "criar") {
    const linhas: [string, string][] = [["Lista", lista(p.list_id, ex.lista)], ["Membro", "você"]];
    if (p.priority) linhas.push(["Prioridade", legivel("priority", p.priority)]);
    if (p.due_date) linhas.push(["Prazo", legivel("due_date", p.due_date)]);
    return { verbo: "Nova tarefa", titulo: v(p.title), linhas, checklists,
             texto: p.description ? { rotulo: "Descrição", valor: v(p.description) } : undefined };
  }
  if (acao === "mover")
    return { verbo: "Mover tarefa", titulo: tarefa, linhas: [["Para", lista(p.para_list_id, ex.para_lista)]], checklists: [] };
  if (acao === "membros") {
    // Os nomes vêm do `_exibir`, na mesma ordem dos ids do payload (o que executa).
    const nomes = (ids: unknown, rot: unknown) => ((ids as number[] | undefined) ?? [])
      .map((id, i) => ((rot as string[] | undefined) ?? [])[i] || `user_id ${id}`).join(", ");
    const linhas: [string, string][] = [];
    const entram = nomes(p.adicionar, ex.adicionar), saem = nomes(p.remover, ex.remover);
    if (entram) linhas.push(["Entram", entram]);
    if (saem) linhas.push(["Saem", saem]);
    return { verbo: "Membros da tarefa", titulo: tarefa, linhas, checklists: [] };
  }
  if (acao === "comentar")
    return { verbo: "Comentar", titulo: tarefa, linhas: [], checklists: [], texto: { rotulo: "Comentário", valor: v(p.texto) } };
  if (acao === "atualizar") {
    const campos = (p.campos as Record<string, unknown>) ?? {};
    const linhas = Object.entries(campos).filter(([k]) => k !== "description")
      .map(([k, x]) => [CAMPO[k] ?? k, legivel(k, x)] as [string, string]);
    const texto = "description" in campos
      ? { rotulo: "Nova descrição (substitui a atual)", valor: v(campos.description) || "(apagar a descrição)" }
      : undefined;
    const nomes = (ex.itens as Record<string, string> | undefined) ?? {};
    const marcar = (p.marcar_itens as { checklist_id: number; item_id: number; checked: boolean }[] | undefined) ?? [];
    const marcados = marcar.map((m) => ({
      texto: nomes[`${m.checklist_id}:${m.item_id}`] || `item ${m.item_id}`, feito: m.checked }));
    const add = p.adicionar_itens as { items?: string[] } | undefined;
    const acrescentar = add?.items?.length
      ? [{ titulo: `Acrescentar em ${ex.adicionar_em ? `“${String(ex.adicionar_em)}”` : "checklist"}`,
           itens: add.items.map((texto) => ({ texto })) }]
      : [];
    const excluir = ex.excluir as { titulo?: string; itens?: number } | undefined;
    if (p.excluir_checklist != null)
      linhas.push(["Excluir checklist", excluir?.titulo
        ? `${excluir.titulo} (${excluir.itens ?? 0} ${excluir.itens === 1 ? "item" : "itens"})`
        : `checklist ${v(p.excluir_checklist)}`]);
    return {
      verbo: "Atualizar tarefa", titulo: tarefa, linhas, texto,
      checklists: [...checklists, ...acrescentar,
                   ...(marcados.length ? [{ titulo: "Marcar no checklist", itens: marcados }] : [])],
    };
  }
  const gestor = cartaoDoGestorHS(acao, p, ex);
  if (gestor) return gestor;
  return { verbo: acao, titulo: "", checklists: [],
           linhas: Object.entries(p).filter(([k]) => k !== "_exibir").map(([k, x]) => [k, JSON.stringify(x)]) };
}
