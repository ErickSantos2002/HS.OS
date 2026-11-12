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
const SISTEMA: Record<string, string> = { taskhs: "TaskHS", gestorhs: "GestorHS", hsgrowth: "HSGrowth", hsgrowth_servicos: "HSGrowth" };
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
  if (acao === "gerar_certificado") {
    // Fase 2b (Laboratório). Cada número sai do payload — é o que vai para o
    // certificado; a média é a do servidor. Cliente, modelo e série, do `_exibir`.
    const ou = (x: unknown) => (x ? String(x) : "?");
    const data = !ex.data || ex.data === "hoje" ? "hoje" : prazo(ex.data);
    const linhas: [string, string][] = [
      ["Cliente", ou(ex.cliente)], ["Modelo", ou(ex.modelo)], ["Código", ou(p.calib_cert)],
      ["Temperatura", `${ou(p.calib_temp)} °C`], ["Pressão", `${ou(p.calib_pressao)} hPa`],
      ["Média", ou(p.calib_teste_media)], ["Situação", ou(p.calib_situacao)], ["Data", data]];
    const itens = [1, 2, 3, 4, 5].map((i) => ({ texto: `${i}ª: ${ou(p[`calib_teste${i}`])}` }));
    const avisos = ["gera o certificado e conclui o aparelho no laboratório"];
    if (ex.substitui) avisos.push("substitui o certificado já gerado");
    if (ex.manutencao)
      avisos.push("também gera o relatório de manutenção (o GestorHS recusa se a manutenção não estiver registrada)");
    return { verbo: "Gerar certificado", titulo: `OS ${v(p.ordem)} · série ${ou(ex.serie)}`, linhas,
             checklists: [{ titulo: "Leituras", itens }],
             texto: { rotulo: "Atenção", valor: avisos.join("; ") + "." } };
  }
  if (acao === "criar_proposta") {
    // Fase 2c (propostas). Preço, quantidade, frete e desconto saem do payload
    // (o que vai ao PDF do cliente); o total e os lembretes são do servidor.
    const itensP = (p.itens as ItemDaProposta[] | undefined) ?? [];
    const flags = (ex.itens as { fora_do_catalogo?: boolean }[] | undefined) ?? [];
    const linhas: [string, string][] = [["Total", reais(ex.total)], ["Frete", reais(p.frete)]];
    if (Number(p.desconto ?? 0) > 0) linhas.push(["Desconto", reais(p.desconto)]);
    linhas.push(["Pagamento", p.condicao_pagamento ? v(p.condicao_pagamento) : "em branco"]);
    if (p.validade_dias != null) linhas.push(["Validade", `${v(p.validade_dias)} dias`]);
    if (ex.modelo) linhas.push(["Modelo", v(ex.modelo)]);
    if (p.data_entrega) linhas.push(["Entrega", prazo(p.data_entrega)]);
    const entrega = (p.endereco_entrega as { texto?: string } | undefined)?.texto;
    if (entrega) linhas.push(["Endereço de entrega", entrega.replace(/\n/g, " · ")]);
    const checklists: CartaoDaAcao["checklists"] = [
      { titulo: "Itens", itens: itensP.map((it, i) => ({ texto: linhaDoItem(it, flags[i]?.fora_do_catalogo) })) }];
    const aparelhos = (ex.aparelhos as { modelo?: string; serie?: string }[] | undefined) ?? [];
    if (aparelhos.length)
      checklists.push({ titulo: "Aparelhos", itens: aparelhos.map((a) => ({
        texto: `${a.modelo || "aparelho"} · série ${a.serie || "?"}` })) });
    return { verbo: "Nova proposta", titulo: ex.cliente ? String(ex.cliente) : "Proposta", linhas, checklists,
             texto: lembretesDoCartao(ex) };
  }
  if (acao === "alterar_proposta") {
    // O `corpo` do payload é o que o PUT leva; o antes → depois e as listas do
    // que entra e sai vêm do `_exibir`, montados pelo servidor sobre ele.
    const linhas: [string, string][] = [["Total", `${reais(ex.total_antes)} → ${reais(ex.total_depois)}`]];
    for (const m of (ex.mudancas as [string, string, string][] | undefined) ?? [])
      linhas.push([String(m[0]), `${m[1]} → ${m[2]}`]);
    const strs = (x: unknown) => ((x as string[] | undefined) ?? []).map((texto) => ({ texto: String(texto) }));
    const entram = [...strs(ex.itens_entram), ...strs(ex.aparelhos_entram)];
    const saem = [...strs(ex.itens_saem), ...strs(ex.aparelhos_saem)];
    const checklists: CartaoDaAcao["checklists"] = [];
    if (entram.length) checklists.push({ titulo: "Entram", itens: entram });
    if (saem.length) checklists.push({ titulo: "Saem", itens: saem });
    const cliente = ex.cliente ? ` · ${String(ex.cliente)}` : "";
    return { verbo: "Alterar proposta", titulo: `Proposta ${v(ex.numero ?? p.proposta)}${cliente}`, linhas,
             checklists, texto: lembretesDoCartao(ex) };
  }
  return null;
}

const ROTULO_CARD_HSG: Record<string, string> = {
  title: "Título", description: "Descrição", value: "Valor", due_date: "Previsão", deal_type: "Tipo de negócio",
  modality: "Modalidade", acquisition_channel: "Canal de aquisição", acquisition_channel_detail: "Detalhe do canal",
  has_implementation: "Implantação", has_personnel: "Pessoal próprio",
  name: "Nome", document: "Documento", sector: "Setor", relationship_type: "Relacionamento",
  employee_count: "Funcionários", commercial_activity: "Atividade comercial",
  email: "E-mail", phone: "Telefone", position: "Cargo", area: "Área",
};
const TIPO_TAREFA_HSG: Record<string, string> = {
  call: "Ligação", meeting: "Reunião", task: "Tarefa", follow_up: "Follow-up", deadline: "Prazo",
  email: "E-mail", lunch: "Almoço", other: "Outro",
};
const PRIORIDADE_HSG: Record<string, string> = { normal: "Normal", high: "Alta", urgent: "Urgente" };

/** Instante UTC (ISO) → `DD/MM/AAAA HH:MM` em Brasília. Sem deslocamento fixo:
 *  o fuso vem do `Intl`. Sem fuso no texto, assume UTC (o payload é UTC). */
export function dataBrasilia(x: unknown): string {
  const t = String(x);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : `${t}Z`);
  if (Number.isNaN(d.getTime())) return t;
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const o = Object.fromEntries(f.formatToParts(d).map((q) => [q.type, q.value]));
  return `${o.day}/${o.month}/${o.year} ${o.hour}:${o.minute}`;
}

const vazioHSG = (x: unknown) => (x === null || x === undefined || x === "" ? "(vazio)" : v(x));
// `due_date` é instante UTC: o dia certo é o de Brasília (02:00Z do dia 20 é 19, 23:00).
const valorHSG = (k: string, x: unknown) => (k === "due_date" && x ? dataBrasilia(x) : vazioHSG(x));
const rotuloHSG = (k: string) => ROTULO_CARD_HSG[k] ?? k;

interface TarefaHSG {
  op: string; task_id?: number; title?: string; task_type?: string; priority?: string; due_date?: string;
  description?: string; duration_minutes?: number; valida?: boolean;
}

function linhaDaTarefaHSG(o: TarefaHSG, nome: string): [string, string] {
  const partes: string[] = [];
  if (o.op === "concluir")
    return ["Concluir", `${nome} · ${o.valida ? "realizada" : "tentativa sem resultado"}`];
  if (o.op === "criar") {
    partes.push(TIPO_TAREFA_HSG[String(o.task_type)] ?? v(o.task_type));
  } else partes.push(nome);
  if (o.op === "alterar" && o.title) partes.push(`título: ${o.title}`);
  if (o.op === "alterar" && o.task_type) partes.push(`tipo: ${TIPO_TAREFA_HSG[o.task_type] ?? o.task_type}`);
  if (o.priority) partes.push(`prioridade ${PRIORIDADE_HSG[o.priority] ?? o.priority}`);
  if (o.due_date) partes.push(dataBrasilia(o.due_date));
  if (o.duration_minutes != null) partes.push(`${o.duration_minutes} min`);
  if (o.description) partes.push(`obs.: ${o.description}`);
  if (o.op === "criar") partes.splice(1, 0, nome);
  return [o.op === "criar" ? "Nova tarefa" : "Alterar tarefa", partes.join(" · ")];
}

/** HSGrowth (12/11/2026). O vendedor confirma o que está aqui e o servidor
 *  executa o `payload` gravado: todo VALOR sai do payload; o `_exibir` só dá
 *  nome ao que lá é id (tarefa, campo personalizado, etapa) e o "antes". */
function cartaoDoHSGrowth(acao: string, p: Record<string, unknown>, ex: Record<string, unknown>): CartaoDaAcao | null {
  const card = ex.card ? String(ex.card) : `card ${v(p.card_id)}`;
  const comCliente = (l: [string, string][]) => { if (ex.cliente) l.unshift(["Cliente", String(ex.cliente)]); return l; };
  if (acao === "hsgrowth_registrar") {
    const linhas: [string, string][] = [];
    const antes = (ex.antes as Record<string, unknown> | undefined) ?? {};
    for (const [k, x] of Object.entries((p.campos as Record<string, unknown> | undefined) ?? {}))
      linhas.push([rotuloHSG(k), k in antes ? `${valorHSG(k, x)} (antes: ${valorHSG(k, antes[k])})` : valorHSG(k, x)]);
    const nomes = (ex.campos_personalizados as string[] | undefined) ?? [];
    ((p.campos_personalizados as { field_definition_id: number; value: unknown }[] | undefined) ?? [])
      .forEach((c, i) => linhas.push([nomes[i] || `campo ${c.field_definition_id}`, vazioHSG(c.value)]));
    const nomesT = (ex.tarefas as string[] | undefined) ?? [];
    ((p.tarefas as TarefaHSG[] | undefined) ?? []).forEach((o, i) =>
      linhas.push(linhaDaTarefaHSG(o, o.op === "criar" ? (o.title || "tarefa")
        : nomesT[i] || (o.task_id != null ? `tarefa ${o.task_id}` : "tarefa"))));
    if (p.mover_para != null)
      linhas.push(["Mover para", ex.etapa_para ? String(ex.etapa_para) : `etapa ${v(p.mover_para)}`]);
    if (ex.aviso) linhas.push(["Atenção", String(ex.aviso)]);
    return { verbo: "Atualizar card", titulo: card, linhas: comCliente(linhas), checklists: [],
             texto: p.nota ? { rotulo: "Nota", valor: v(p.nota) } : undefined };
  }
  if (acao === "hsgrowth_cliente") {
    const linhas: [string, string][] = [];
    const antes = (ex.antes as Record<string, Record<string, unknown>> | undefined) ?? {};
    for (const [quem, rot] of [["cliente", "Cliente"], ["contato", "Contato"]] as const) {
      const campos = (p[quem] as { campos?: Record<string, unknown> } | undefined)?.campos;
      for (const [k, x] of Object.entries(campos ?? {}))
        linhas.push([`${rot} · ${rotuloHSG(k)}`, `${vazioHSG(antes[quem]?.[k])} → ${vazioHSG(x)}`]);
    }
    return { verbo: "Completar cadastro", titulo: card, linhas: comCliente(linhas), checklists: [] };
  }
  if (acao === "hsgrowth_criar_lead") {
    const linhas: [string, string][] = [["Etapa", ex.etapa ? String(ex.etapa) : `etapa ${v(p.list_id)}`]];
    const cli = p.cliente as { id?: number; campos?: Record<string, unknown> } | undefined;
    const nomeCli = ex.cliente ? String(ex.cliente) : cli?.id != null ? `cliente ${cli.id}` : v(cli?.campos?.name ?? "?");
    linhas.push([cli?.id != null ? "Cliente (já existe)" : "Cliente (novo)", nomeCli]);
    if (ex.documento) linhas.push(["Documento", String(ex.documento)]);
    if (ex.cliente_existente && Number(ex.cards_abertos ?? 0) > 0) {
      const donos = (ex.donos as string[] | undefined) ?? [];
      linhas.push(["Cards abertos do cliente", `${v(ex.cards_abertos)}${donos.length ? ` — ${donos.join(", ")}` : ""}`]);
    }
    if (cli?.id == null)
      for (const [k, x] of Object.entries(cli?.campos ?? {})) if (k !== "name") linhas.push([`Cliente · ${rotuloHSG(k)}`, vazioHSG(x)]);
    const con = p.contato as { id?: number; campos?: Record<string, unknown> } | undefined;
    if (con?.id != null) linhas.push(["Contato (já existe)", ex.contato ? String(ex.contato) : `contato ${con.id}`]);
    else {
      linhas.push(["Contato (novo)", ex.contato ? String(ex.contato) : v(con?.campos?.name)]);
      for (const [k, x] of Object.entries(con?.campos ?? {})) if (k !== "name") linhas.push([`Contato · ${rotuloHSG(k)}`, vazioHSG(x)]);
    }
    for (const [k, x] of Object.entries((p.campos_do_card as Record<string, unknown> | undefined) ?? {}))
      linhas.push([rotuloHSG(k), valorHSG(k, x)]);
    return { verbo: "Novo lead", titulo: v(p.titulo), linhas, checklists: [] };
  }
  if (acao === "hsgrowth_ganhar") {
    const linhas: [string, string][] = [];
    if (ex.valor != null) linhas.push(["Valor", reais(ex.valor)]);
    if (ex.modalidade) linhas.push(["Modalidade", String(ex.modalidade)]);
    return { verbo: "Marcar como GANHO", titulo: card, linhas: comCliente(linhas), checklists: [] };
  }
  if (acao === "hsgrowth_perder")
    return { verbo: "Marcar como PERDIDO", titulo: card, linhas: comCliente([["Motivo", v(p.motivo)]]), checklists: [] };
  if (acao === "hsgrowth_noshow") {
    const linhas: [string, string][] = [["Reunião", ex.reuniao ? String(ex.reuniao) : `tarefa ${v(p.task_id)}`]];
    if (ex.quando) linhas.push(["Marcada para", dataBrasilia(ex.quando)]);
    return { verbo: "Cliente não compareceu", titulo: card, linhas: comCliente(linhas), checklists: [] };
  }
  return null;
}

const ROTULO_NEGOCIO_SV: Record<string, string> = {
  collection_type: "Tipo de cobrança", service_type: "Tipo de serviço", acquisition_channel: "Canal de aquisição",
  form_answered: "Formulário respondido", closing_type: "Tipo de fechamento", proposal_number: "Nº da proposta",
  order_number: "Nº do pedido", from_collection: "Veio da cobrança", shipping_confirmed: "Envio confirmado",
};
const VALOR_NEGOCIO_SV: Record<string, string> = {
  a_vencer: "A vencer", atrasados: "Atrasados", recalibracao: "Recalibração", manutencao: "Manutenção",
  ambos: "Ambos", faturamento_direto: "Faturamento direto", pedido: "Pedido", sim: "Sim", nao: "Não",
};
const TIPO_ATIVIDADE_SV: Record<string, string> = {
  call: "Ligação", task: "Tarefa", follow_up: "Follow-up", email: "E-mail", whatsapp: "WhatsApp",
  linkedin: "LinkedIn", other: "Outro",
};
// Ganho e perda no HSGrowth concluem as atividades pendentes, menos follow-up
// (`_complete_pending_activities` de lá). Texto fixo: não vem do `_exibir`.
const FECHA_ATIVIDADES_SV: [string, string] = ["Atividades", "as pendentes são concluídas, menos follow-up"];
const valorNegocioSV = (x: unknown) =>
  x === null || x === undefined || x === "" ? "(vazio)" : VALOR_NEGOCIO_SV[String(x)] ?? v(x);

/** HSGrowth Serviços e Cobrança (12/11/2026). Mesma regra do Vendas: todo VALOR
 *  sai do payload (o que o servidor executa); `_exibir` só nomeia ids e dá o "antes". */
function cartaoDoHSGrowthServicos(acao: string, p: Record<string, unknown>, ex: Record<string, unknown>): CartaoDaAcao | null {
  if (!acao.startsWith("hsgrowth_servicos_")) return null;
  const card = ex.card ? String(ex.card) : `card ${v(p.card_id)}`;
  const comCliente = (l: [string, string][]) => { if (ex.cliente) l.unshift(["Cliente", String(ex.cliente)]); return l; };
  const etapa = (id: unknown, nome: unknown) => (nome ? String(nome) : `etapa ${v(id)}`);
  const trecho = (de: unknown, para: unknown): [string, string] =>
    ["Etapa", `${etapa(de, ex.etapa_de)} → ${etapa(para, ex.etapa_para)}`];
  const avisoLinha = (l: [string, string][]) => { if (ex.aviso) l.push(["Atenção", String(ex.aviso)]); return l; };
  const quadro = ex.quadro ? ` · ${String(ex.quadro)}` : "";
  if (acao === "hsgrowth_servicos_registrar") {
    const linhas: [string, string][] = [];
    const camposP = (p.campos as Record<string, unknown> | undefined) ?? {};
    if ("client_id" in camposP) linhas.push(["Cliente do card", ex.cliente_novo ? String(ex.cliente_novo) : `cliente ${v(camposP.client_id)}`]);
    if ("person_id" in camposP) linhas.push(["Contato do card", ex.contato_novo ? String(ex.contato_novo) : `contato ${v(camposP.person_id)}`]);
    for (const [k, x] of Object.entries(camposP))
      if (k !== "client_id" && k !== "person_id") linhas.push([rotuloHSG(k), valorHSG(k, x)]);
    const antes = (ex.negocio_antes as Record<string, unknown> | undefined) ?? {};
    for (const [k, x] of Object.entries((p.negocio as Record<string, unknown> | undefined) ?? {}))
      linhas.push([ROTULO_NEGOCIO_SV[k] ?? k, `${valorNegocioSV(antes[k])} → ${valorNegocioSV(x)}`]);
    const prop = ex.proposta as { numero?: unknown; cliente?: unknown; valor?: unknown } | undefined;
    if (prop && (p.negocio as Record<string, unknown> | undefined)?.proposal_number != null)
      linhas.push(["Proposta no GestorHS", [prop.cliente, prop.valor != null ? reais(prop.valor) : ""].filter(Boolean).join(" · ") || "(achada)"]);
    const nomes = (ex.atividades_nomes as Record<string, string> | undefined) ?? {};
    for (const o of (p.atividades as Record<string, unknown>[] | undefined) ?? []) {
      if (o.op === "concluir")
        linhas.push(["Concluir atividade", `${nomes[String(o.activity_id)] || `atividade ${v(o.activity_id)}`} · ${o.valida ? "realizada" : "tentativa sem resultado"}`]);
      else if (o.category === "anotacao") linhas.push(["Anotação", v(o.description)]);
      else {
        const partes = [TIPO_ATIVIDADE_SV[String(o.activity_type)] ?? v(o.activity_type), v(o.title)];
        if (o.priority) partes.push(`prioridade ${PRIORIDADE_HSG[String(o.priority)] ?? v(o.priority)}`);
        if (o.due_date) partes.push(dataBrasilia(o.due_date));
        if (o.description) partes.push(`obs.: ${v(o.description)}`);
        linhas.push(["Nova atividade", partes.join(" · ")]);
      }
    }
    const mov = p.mover as { de?: unknown; para?: unknown } | undefined;
    if (mov) linhas.push(trecho(mov.de, mov.para));
    return { verbo: "Atualizar card", titulo: card + quadro, linhas: avisoLinha(comCliente(linhas)), checklists: [] };
  }
  if (acao === "hsgrowth_servicos_itens") {
    const nomes = (ex.itens_nomes as string[] | undefined) ?? [];
    const rot: Record<string, string> = { por: "Pôr", alterar: "Alterar", tirar: "Tirar" };
    const itens = ((p.ops as Record<string, unknown>[] | undefined) ?? []).map((o, i) => {
      const c = (o.corpo as Record<string, unknown> | undefined) ?? {};
      const partes = [`${rot[String(o.acao)] ?? v(o.acao)} ${o.tipo === "aparelho" ? "aparelho" : "serviço"}`,
        nomes[i] || (o.item_id != null ? `item ${v(o.item_id)}` : "item")];
      if (c.quantity != null) partes.push(`${v(c.quantity)} un.`);
      if (c.unit_price != null) partes.push(`${reais(c.unit_price)} cada`);
      if (c.discount != null) partes.push(`desconto ${v(c.discount)}`);
      if (c.notes) partes.push(`obs.: ${v(c.notes)}`);
      return { texto: partes.join(" · ") };
    });
    return { verbo: "Itens do card", titulo: card + quadro, linhas: comCliente([]),
             checklists: [{ titulo: "Itens", itens }] };
  }
  if (acao === "hsgrowth_servicos_ganhar") {
    const linhas: [string, string][] = [trecho(p.de, p.para)];
    if (ex.valor != null) linhas.push(["Valor", reais(ex.valor)]);
    const prop = ex.proposta as { numero?: unknown } | undefined;
    if (prop?.numero != null) linhas.push(["Proposta", v(prop.numero)]);
    linhas.push(FECHA_ATIVIDADES_SV);
    return { verbo: "Marcar como GANHO", titulo: card + quadro, linhas: avisoLinha(comCliente(linhas)), checklists: [] };
  }
  if (acao === "hsgrowth_servicos_perder")
    return { verbo: "Marcar como PERDIDO", titulo: card + quadro,
             linhas: comCliente([["Motivo", v(p.motivo)], trecho(p.de, p.para), FECHA_ATIVIDADES_SV]), checklists: [] };
  if (acao === "hsgrowth_servicos_anexar_proposta") {
    const prop = ex.proposta as { cliente?: unknown; valor?: unknown } | undefined;
    const linhas: [string, string][] = [["Proposta", v(p.numero)]];
    if (prop?.cliente) linhas.push(["Cliente da proposta", String(prop.cliente)]);
    if (prop?.valor != null) linhas.push(["Valor", reais(prop.valor)]);
    if (p.nome_arquivo) linhas.push(["Arquivo", v(p.nome_arquivo)]);
    if (ex.substitui) linhas.push(["Substitui", String(ex.substitui)]);
    return { verbo: "Anexar proposta (PDF)", titulo: card + quadro, linhas: avisoLinha(comCliente(linhas)), checklists: [] };
  }
  return null;
}

interface ItemDaProposta { descricao?: string; sku?: string; quantidade?: number; preco_un?: number }

/** `1335` → `R$ 1.335,00`, sem `Intl` (o espaço dele é NBSP e varia por ambiente). */
export function reais(x: unknown): string {
  const n = Number(x ?? 0);
  if (!Number.isFinite(n)) return "R$ ?";
  const [int, cent] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cent}`;
}

function linhaDoItem(it: ItemDaProposta, fora?: boolean): string {
  const q = Number(it.quantidade ?? 0), pu = Number(it.preco_un ?? 0);
  const qtd = Number.isInteger(q) ? String(q) : String(q).replace(".", ",");
  return `${qtd} × ${it.descricao || it.sku || "item"} — ${reais(pu)} = ${reais(Math.round(q * pu * 100) / 100)}`
    + (fora ? " (≠ catálogo)" : "");
}

function lembretesDoCartao(ex: Record<string, unknown>): CartaoDaAcao["texto"] {
  const l = (ex.lembretes as string[] | undefined) ?? [];
  return l.length ? { rotulo: "Lembretes", valor: l.join("\n") } : undefined;
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
  const growth = cartaoDoHSGrowth(acao, p, ex);
  if (growth) return growth;
  const servicos = cartaoDoHSGrowthServicos(acao, p, ex);
  if (servicos) return servicos;
  return { verbo: acao, titulo: "", checklists: [],
           linhas: Object.entries(p).filter(([k]) => k !== "_exibir").map(([k, x]) => [k, JSON.stringify(x)]) };
}
