/**
 * A lista do Início — spec 2026-11-03 (app do celular), item 1.
 *
 * Uma lista só, filtrada pelos chips Pessoas · Agentes · Canais (não existe
 * "Tudo" nem "Não lidas": o sistema principal não tem esses filtros). Ordem do
 * WhatsApp: a última mensagem manda. Diferente da lateral do desktop
 * (`lista-de-conversas.ts`), não lida não sobe para o topo — no celular o
 * contador já salta aos olhos e a conversa não muda de lugar ao ser lida.
 */
import { casaBusca } from "@/lib/lista-de-conversas";

export type TipoItem = "pessoa" | "agente" | "canal";
/** `pessoal`: a conversa consigo mesmo (10/11/2026), fixa no topo de Pessoas. */
export type TipoDoItem = TipoItem | "pessoal";

export interface PreviaCelular {
  texto: string;
  /** Epoch em ms. */
  quando: number;
  minha: boolean;
  /** Visto da minha última mensagem (✓✓ azul). */
  lida?: boolean;
  /** Nome de quem escreveu — só aparece em canal. */
  autor?: string | null;
}

export interface ItemCelular {
  chave: string;
  tipo: TipoDoItem;
  /** agent_id, id da pessoa ou id do canal. */
  id: string;
  /** Canal da conversa: DM da pessoa, o próprio canal; agente fica `null`. */
  canalId: string | null;
  nome: string;
  /** "Orquestradora", "RH" — vai para o cabeçalho da conversa. */
  subtitulo: string;
  previa: PreviaCelular | null;
  naoLidas: number;
  silenciado: boolean;
  pensando: boolean;
  /** Foto — hoje só a da conversa pessoal (a própria). */
  foto?: string | null;
}

export function montarLista(itens: ItemCelular[], filtro: TipoItem, busca: string): ItemCelular[] {
  const doFiltro = (i: ItemCelular) => i.tipo === filtro || (i.tipo === "pessoal" && filtro === "pessoa");
  return itens
    .filter((i) => doFiltro(i) && casaBusca([i.nome, i.previa?.texto], busca))
    .sort((a, b) => {
      // A conversa consigo mesmo não desce com a ordem do WhatsApp.
      if ((a.tipo === "pessoal") !== (b.tipo === "pessoal")) return a.tipo === "pessoal" ? -1 : 1;
      const qa = a.previa?.quando ?? 0;
      const qb = b.previa?.quando ?? 0;
      if (qa !== qb) return qb - qa;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
}

/** Em canal, "Rafael: o laudo saiu"; em DM, só o texto. */
export function linhaDaPrevia(item: ItemCelular): { autor: string | null; texto: string } {
  const p = item.previa;
  if (!p) return { autor: null, texto: "" };
  const autor = item.tipo === "canal" && !p.minha && p.autor ? p.autor.split(" ")[0] : null;
  return { autor, texto: p.texto };
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function inicioDoDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function horaDaLista(quando: number, agora: Date = new Date()): string {
  if (!quando) return "";
  const d = new Date(quando);
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(d)) / 864e5);
  if (dias <= 0) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (dias === 1) return "ontem";
  if (dias < 7) return DIAS[d.getDay()];
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
