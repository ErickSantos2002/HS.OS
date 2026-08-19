/**
 * Chat persistence via Supabase conversations table.
 * Uses pagination + module-level cache for instant rendering.
 * All queries are scoped to the current user via user_id.
 */

import { api } from "@/lib/api";

/** Uma linha de `conversations` como a nossa API devolve. */
interface ConversationRow {
  id: string;
  agent_id: string;
  role: string;
  content: string;
  media: unknown[] | null;
  created_at: string;
}

interface PaginaApi {
  messages: ConversationRow[];
  has_more: boolean;
}
import type { ChatMessage, MediaAttachment } from "@/lib/mock-data";

const INITIAL_PAGE_SIZE = 50;
const LOAD_MORE_SIZE = 50;

export interface PaginatedHistory {
  messages: ChatMessage[];
  hasMore: boolean;
}

/* ── Module-level cache ─────────────────────────────── */

// Cache key = `${userId}:${agentId}`
const historyCache: Record<string, PaginatedHistory> = {};

function cacheKey(userId: string, agentId: string) {
  return `${userId}:${agentId}`;
}

/** Synchronous read from cache — returns null if not cached yet */
export function getCachedHistory(userId: string, agentId: string): PaginatedHistory | null {
  return historyCache[cacheKey(userId, agentId)] ?? null;
}

/** Prefetch history for an agent into cache (no-op if already cached) */
export async function prefetchAgentHistory(userId: string, agentId: string): Promise<void> {
  if (historyCache[cacheKey(userId, agentId)]) return;
  await loadPersistedHistory(userId, agentId);
}

/* ── Helpers ─────────────────────────────────────────── */

function normalizeRole(role: string): "user" | "agent" {
  if (role === "user") return "user";
  return "agent"; // treats "agent", "assistant", or any other role as agent
}

export function conversationRowToMessage(row: any, agentId: string): ChatMessage {
  const content = row.content ?? "";
  const role = normalizeRole(row.role);
  const isError = role === "agent" && typeof content === "string" && content.startsWith("[error]");
  return {
    id: row.id,
    agentId,
    role,
    content,
    timestamp: row.created_at,
    channel: "web",
    isError: isError || undefined,
    media: row.media
      ? Array.isArray(row.media)
        ? (row.media as unknown as MediaAttachment[])
        : [row.media as unknown as MediaAttachment]
      : undefined,
  };
}

export function appendMessageToHistoryCache(userId: string, agentId: string, message: ChatMessage) {
  const key = cacheKey(userId, agentId);
  const current = historyCache[key] ?? { messages: [], hasMore: false };

  if (current.messages.some((existing) => existing.id === message.id)) return;

  historyCache[key] = {
    ...current,
    messages: [...current.messages, message].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

export function replaceMessageInHistoryCache(
  userId: string,
  agentId: string,
  targetId: string,
  message: ChatMessage
) {
  const key = cacheKey(userId, agentId);
  const current = historyCache[key] ?? { messages: [], hasMore: false };
  const withoutTarget = current.messages.filter(
    (existing) => existing.id !== targetId && existing.id !== message.id
  );

  historyCache[key] = {
    ...current,
    messages: [...withoutTarget, message].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ),
  };
}

export function removeMessageFromHistoryCache(userId: string, agentId: string, messageId: string) {
  const key = cacheKey(userId, agentId);
  const current = historyCache[key];
  if (!current) return;

  historyCache[key] = {
    ...current,
    messages: current.messages.filter((message) => message.id !== messageId),
  };
}

/* ── Load / paginate ────────────────────────────────── */

/**
 * Traz de volta a resposta que ficou só no gateway.
 *
 * ⚠️ **Não é zelo: houve perda observada em produção.** Em 17 e 18/08/2026 o
 * CEO fez perguntas que pareceram não respondidas. Os agentes tinham respondido
 * — "Bom dia! Sou a Nina…", 1.023 caracteres de faturamento na Iris — mas a
 * gravação só acontece enquanto esta tela está perguntando em `/reply`. Ele
 * mandou outra mensagem antes de a primeira voltar, e a resposta ficou órfã.
 *
 * Falha aqui é silenciosa de propósito: recuperar é melhoria, e não abrir a
 * conversa por causa dela seria trocar um defeito por outro pior.
 */
async function recuperarOrfas(agentId: string): Promise<void> {
  try {
    await api(`/conversations/${encodeURIComponent(agentId)}/recuperar`, { method: "POST" });
  } catch (error) {
    console.warn("[chat-persistence] recuperação de respostas órfãs falhou:", error);
  }
}

export async function loadPersistedHistory(userId: string, agentId: string): Promise<PaginatedHistory> {
  const key = cacheKey(userId, agentId);

  // Antes de ler: importa o que o gateway tem e nós não. Sequencial de
  // propósito — em paralelo a leitura sairia sem o que acabou de ser gravado.
  await recuperarOrfas(agentId);

  let data: ConversationRow[];
  try {
    const pagina = await api<PaginaApi>(
      `/conversations/${encodeURIComponent(agentId)}?limite=${INITIAL_PAGE_SIZE}`,
    );
    data = pagina.messages;
  } catch (error) {
    console.error("[chat-persistence] Failed to load history:", error);
    return historyCache[key] ?? { messages: [], hasMore: false };
  }

  // Protect cache: don't overwrite valid cached data with empty results (transient failures)
  if (data.length === 0 && historyCache[key]?.messages.length) {
    return historyCache[key];
  }

  const hasMore = data.length === INITIAL_PAGE_SIZE;
  const messages = [...data].reverse().map((row) => conversationRowToMessage(row, agentId));

  // Merge with existing cache to preserve paginated history
  const existing = historyCache[key]?.messages ?? [];
  const byId = new Map(existing.map(m => [m.id, m]));
  for (const m of messages) byId.set(m.id, m);
  const merged = [...byId.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const cleaned = filterOrphanErrors(merged);
  const result = { messages: cleaned, hasMore: hasMore || existing.length > merged.length };
  historyCache[key] = result;
  return result;
}

/**
 * Hide [error] bubbles that were followed by a real agent reply within 30 min.
 * The gateway sometimes delivers the actual answer as a late inter-session
 * message after a synthetic timeout — the earlier error was a false alarm.
 * We don't delete from DB, we just stop rendering it.
 */
function filterOrphanErrors(messages: ChatMessage[]): ChatMessage[] {
  const ORPHAN_WINDOW_MS = 60 * 60_000;
  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isErr = m.isError || (typeof m.content === "string" && m.content.startsWith("[error]"));
    if (m.role === "agent" && isErr) {
      const ts = new Date(m.timestamp).getTime();
      const supersededBy = messages.slice(i + 1).find((later) => {
        if (later.role !== "agent") return false;
        const laterIsErr = later.isError || (typeof later.content === "string" && later.content.startsWith("[error]"));
        if (laterIsErr) return false;
        const dt = new Date(later.timestamp).getTime() - ts;
        return dt > 0 && dt <= ORPHAN_WINDOW_MS;
      });
      if (supersededBy) continue;
    }
    out.push(m);
  }
  return out;
}

export async function loadOlderMessages(
  userId: string,
  agentId: string,
  beforeTimestamp: string,
  limit: number = LOAD_MORE_SIZE
): Promise<PaginatedHistory> {
  let data: ConversationRow[];
  try {
    const pagina = await api<PaginaApi>(
      `/conversations/${encodeURIComponent(agentId)}`
      + `?limite=${limit}&antes_de=${encodeURIComponent(beforeTimestamp)}`,
    );
    data = pagina.messages;
  } catch (error) {
    console.error("[chat-persistence] Failed to load older messages:", error);
    return { messages: [], hasMore: false };
  }

  const hasMore = data.length === limit;
  const messages = [...data].reverse().map((row) => conversationRowToMessage(row, agentId));

  return { messages, hasMore };
}

export async function appendToConversations(userId: string, agentId: string, msg: ChatMessage): Promise<ChatMessage> {
  // O `user_id` sai do token no servidor — mandá-lo daqui não teria efeito e
  // daria a impressão errada de que o cliente escolhe de quem é a mensagem.
  const data = await api<ConversationRow>(`/conversations/${encodeURIComponent(agentId)}`, {
    method: "POST",
    body: {
      role: msg.role,
      content: msg.content,
      media: msg.media ?? null,
      created_at: msg.timestamp,
    },
  });

  const persistedMessage = conversationRowToMessage(data, agentId);
  appendMessageToHistoryCache(userId, agentId, persistedMessage);
  return persistedMessage;
}

export async function clearConversationHistory(userId: string, agentId: string) {
  delete historyCache[cacheKey(userId, agentId)];
  await api(`/conversations/${encodeURIComponent(agentId)}`, { method: "DELETE" });
}

/**
 * Load messages containing previewable artifacts directly from DB,
 * independent of the main chat pagination (INITIAL_PAGE_SIZE).
 */
export async function loadConversationArtifacts(
  userId: string,
  agentId: string
): Promise<ChatMessage[]> {
  // O `.or()` com cinco `ilike` virou o parâmetro `com_codigo` — a lista dos
  // tipos que a tela sabe renderizar vive no servidor agora.
  const data = await api<any[]>(
    `/conversations/${encodeURIComponent(agentId)}/respostas?com_codigo=true`,
  ).catch((e: Error) => {
    console.error("[chat-persistence] Failed to load artifacts:", e);
    return null;
  });
  if (!data) return [];

  return (data ?? []).map((row) => conversationRowToMessage(row, agentId));
}

/**
 * Load custom artifact titles for a set of message ids.
 * Returns a map of message_id -> title.
 */
export async function loadArtifactTitles(
  messageIds: string[]
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (messageIds.length === 0) return map;

  // O endpoint devolve todos os títulos desta pessoa de uma vez: são poucos, e
  // a tela precisava montar a lista de ids antes de saber se havia algum.
  const linhas = await api<{ message_id: string; title: string }[]>(
    "/artefatos/titulos",
  ).catch(() => null);
  if (!linhas) return map;

  const pedidos = new Set(messageIds);
  for (const row of linhas) {
    if (pedidos.has(row.message_id)) map[row.message_id] = row.title;
  }
  return map;
}

/**
 * Save (upsert) a custom artifact title for the current user.
 */
export async function saveArtifactTitle(
  messageId: string,
  title: string
): Promise<void> {
  // O dono sai do token no servidor.
  await api("/artefatos/titulos", {
    method: "PUT",
    body: { message_id: messageId, title },
  });
}

/**
 * Fetch the last message per agent for a specific user using RPC.
 */
export async function loadLastMessagesPerAgent(
  userId: string,
  agentIds: string[]
): Promise<Record<string, { content: string; created_at: string }>> {
  if (agentIds.length === 0) return {};

  // A agregação continua na função do banco; só o transporte mudou.
  const data = await api<any[]>(
    `/conversations/ultimas/por-agente?agent_ids=${encodeURIComponent(agentIds.join(","))}`,
  ).catch((e: Error) => {
    console.error("[chat-persistence] Failed to load last messages:", e);
    return null;
  });

  const map: Record<string, { content: string; created_at: string }> = {};
  if (data) {
    for (const row of data as any[]) {
      const content = row.last_content ?? "";
      map[row.agent_id] = {
        content: content.length > 120 ? content.slice(0, 120) + "…" : content,
        created_at: row.last_active,
      };
    }
  }
  return map;
}
