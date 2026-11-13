/** Cores e datas do app do celular — funções puras, fora dos componentes. */
import type { ChannelMessage } from "@/hooks/use-channels";
import type { Person } from "@/hooks/use-people";
import { normalizeAgentId } from "@/lib/active-agents";
import { getAgentDisplayName } from "@/lib/channel-agents";

const CORES = ["#1885c8", "#0f8f84", "#5a54c7", "#c2721a", "#b84a6a", "#7c5cc4", "#2f8a52", "#c0533a", "#3a6fb0"];
const CORES_DE_NOME = ["--n1", "--n2", "--n3", "--n4", "--n5"];

function hash(texto: string): number {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0;
  return h;
}

/** Cor de fundo do avatar com letra — a mesma pessoa tem sempre a mesma. */
export function corDoAvatar(chave: string): string {
  return CORES[hash(chave) % CORES.length];
}

/** Cor do nome do autor no canal (`--n1`…`--n5`, ajustadas ao tema). */
export function corDoNome(chave: string): string {
  return `var(${CORES_DE_NOME[hash(chave) % CORES_DE_NOME.length]})`;
}

/** Hora curta de uma mensagem ("09:41"). */
export function horaCurta(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "Hoje", "Ontem" ou a data — o separador de dia da conversa. */
export function rotuloDoDia(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  const zero = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((zero(agora) - zero(d)) / 864e5);
  if (dias <= 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias < 7) {
    const s = d.toLocaleDateString("pt-BR", { weekday: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: d.getFullYear() === agora.getFullYear() ? undefined : "numeric" });
}

export function mesmoDia(a: string, b: string | undefined): boolean {
  if (!b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** Nome de quem escreveu no canal: agente pelo nome de exibição, pessoa pelo cadastro. */
export function nomeDoAutorNoCanal(m: ChannelMessage, pessoaPorId: Map<string, Person>): string {
  if (m.author_type === "agent") return getAgentDisplayName(normalizeAgentId(m.author_id || ""));
  return pessoaPorId.get(m.author_id)?.full_name || m.author_name || "Alguém";
}
