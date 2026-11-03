/**
 * A aba Atividade — spec 2026-11-03 (app do celular), item 8.
 *
 * Fonte: o que alimenta o sininho (`/notificacoes`), sem consulta nova. Entram
 * só três tipos: menção, resposta em thread e agente que respondeu. Mensagem
 * comum de canal fica de fora — ela já está na lista, com contador.
 *
 * Como cada um é reconhecido, no formato que o servidor já grava:
 * - agente: a linha tem `agent_id` (resposta do agente na conversa direta);
 * - thread: o `notifyChannelRecipients` de resposta em thread grava o autor
 *   como "Fulano (em conversa)" e a prévia começando por 💬;
 * - menção: `@<meu nome>` ou `@todos` na prévia, sem diferenciar maiúscula —
 *   a mesma regra do push (`push_regras.py`).
 */
import type { Notification } from "@/hooks/use-notifications";

export type TipoAtividade = "mencao" | "thread" | "agente";

const MARCA_THREAD = "(em conversa)";

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function classificarAtividade(n: Pick<Notification, "agent_id" | "author_name" | "content_preview">, meuNome: string): TipoAtividade | null {
  if (n.agent_id && n.agent_id.trim()) return "agente";
  if ((n.author_name || "").includes(MARCA_THREAD) || (n.content_preview || "").startsWith("💬")) return "thread";
  const previa = normalizar(n.content_preview || "");
  if (/@todos\b/.test(previa)) return "mencao";
  const nome = normalizar(meuNome.trim());
  if (nome && (previa.includes(`@${nome}`) || previa.includes(`@${nome.split(" ")[0]}`))) return "mencao";
  return null;
}

/** "Rafael Lima (em conversa)" → "Rafael Lima". */
export function nomeDoAutor(n: Pick<Notification, "author_name">): string {
  return (n.author_name || "").replace(MARCA_THREAD, "").trim() || "Alguém";
}

/** A prévia sem o 💬 de thread que o servidor põe na frente. */
export function textoDaAtividade(n: Pick<Notification, "content_preview">): string {
  return (n.content_preview || "").replace(/^💬\s*/, "");
}
