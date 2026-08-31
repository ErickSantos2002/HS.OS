/**
 * Background chat sender – survives page navigation.
 *
 * Dispatches API calls from a module-level queue.  Results are written
 * to Supabase conversations table so data persists across browsers.
 * A global CustomEvent is emitted so an *already mounted* ChatPage
 * can update its React state in real-time.
 *
 * Now supports SSE streaming via /api/stream with fallback to /v1/responses.
 */

import { assinar } from "@/lib/realtime";
import { getAgentReadableImageContext } from "@/lib/chat-image-vision";
import { getModelForAgent } from "@/lib/active-agents";
import { appendToConversations, conversationRowToMessage } from "@/lib/chat-persistence";
import { getModelOverride } from "@/lib/agent-model-override";
import { enviarParaAgente } from "@/lib/agent-chat";
import { api, lerUsuarioDoToken } from "@/lib/api";
import { getAgentIdAliases, toCanonicalAgentId } from "@/lib/agent-id";
import type { ChatMessage, MediaAttachment } from "@/lib/mock-data";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createElement } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";
import { cancelamentoRealLigado, gravarChave, lerChave } from "@/lib/chaves-locais";

const RESET_COMMANDS = new Set(["/new", "/reset"]);
function isResetCommand(text: string) {
  return RESET_COMMANDS.has(text.trim().toLowerCase());
}
function isAbortLikeError(err: unknown) {
  const msg = String((err as any)?.message ?? err ?? "").toLowerCase();
  return (
    (err as any)?.name === "AbortError" ||
    msg.includes("signal has been aborted") ||
    msg.includes("signal is aborted") ||
    msg.includes("the operation was aborted")
  );
}

/* ── Agent status cache updater ── */

let _queryClient: QueryClient | null = null;

export function setQueryClientForSender(qc: QueryClient) {
  _queryClient = qc;
}

function emitAgentActive(agentId: string) {
  if (!_queryClient) return;
  _queryClient.setQueryData(["gateway-agents"], (prev: any[] | undefined) => {
    if (!prev) return prev;
    return prev.map((a: any) =>
      a.id === agentId
        ? { ...a, status: "active", lastStatusUpdate: Date.now() }
        : a
    );
  });
}

/* ── Active agent tracking ── */

let _activeAgentId: string | null = null;

const STOP_REASON = "manual-stop";
const AGENT_SESSION_VERSION = "v2";

// ── Per-agent session "generation" (client-side reset) ──
// O gateway NÃO expõe nenhum reset de sessão: /v1/sessions/reset → 404, não há
// método session.* no admin-rpc, e /new mandado ao /v1/chat/completions é tratado
// como texto comum (nunca reseta). O único jeito confiável de zerar o contexto é
// usar uma CHAVE DE SESSÃO NOVA — o gateway trata chave nova como sessão nova, do
// zero. Guardamos uma "geração" por agente no localStorage; /new e /reset a
// incrementam, e a próxima mensagem passa a usar a chave nova. A sessão antiga
// fica abandonada (inerte) no gateway. Geração 0 = chave legada SEM sufixo, então
// subir este deploy não reseta ninguém no meio de uma conversa — só quem pedir.
const sessionGenCache = new Map<string, number>();
function getSessionGen(canonicalAgentId: string): number {
  if (sessionGenCache.has(canonicalAgentId)) return sessionGenCache.get(canonicalAgentId)!;
  let value = 0;
  try {
    const raw = lerChave(`hsos:session-gen:${canonicalAgentId}`);
    const parsed = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(parsed) && parsed > 0) value = parsed;
  } catch {
    /* localStorage indisponível — segue com 0 */
  }
  sessionGenCache.set(canonicalAgentId, value);
  return value;
}
function bumpSessionGen(canonicalAgentId: string): number {
  const next = getSessionGen(canonicalAgentId) + 1;
  sessionGenCache.set(canonicalAgentId, next); // in-memory é autoritativo p/ esta aba
  try {
    gravarChave(`hsos:session-gen:${canonicalAgentId}`, String(next));
  } catch {
    /* falha de storage não impede o reset nesta aba */
  }
  return next;
}
// Monta a chave de sessão do gateway. Geração 0 → chave legada (sem sufixo), pra
// o deploy não resetar conversas existentes; geração N≥1 → chave nova (:gN).
function buildSessionUser(userId: string, canonicalAgentId: string): string {
  const base = `dm:${userId}:${canonicalAgentId}:${AGENT_SESSION_VERSION}`;
  const gen = getSessionGen(canonicalAgentId);
  return gen > 0 ? `${base}:g${gen}` : base;
}

type ActiveAgentRequest = {
  controller: AbortController;
  requestId: string;
};

const activeAgentRequests = new Map<string, ActiveAgentRequest>();
const manuallyStoppedRequestIds = new Set<string>();
const stoppedAgents = new Set<string>();

export function setActiveAgentId(agentId: string | null) {
  _activeAgentId = agentId;
  if (agentId) clearUnreadAgent(agentId);
}

export function wasAgentResponseStopped(agentId: string) {
  return stoppedAgents.has(agentId);
}

export function stopAgentResponse(agentId: string) {
  const activeRequest = activeAgentRequests.get(agentId);
  if (!activeRequest) return;

  stoppedAgents.add(agentId);
  manuallyStoppedRequestIds.add(activeRequest.requestId);
  pendingAgents.delete(agentId);
  activeRequest.controller.abort(STOP_REASON);
  emitStream(agentId, "");
  emitPending();

  // Cancelamento real: manda /stop pro gateway em paralelo, fire-and-forget —
  // não atrasa o feedback visual imediato (que já aconteceu acima). Se falhar,
  // o comportamento é idêntico ao de hoje (só o abort local).
  if (cancelamentoRealLigado()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    enviarComando(agentId, "/stop", controller.signal)
      .catch((err) => console.warn("[chat-sender] /stop ao gateway falhou:", err?.message))
      .finally(() => clearTimeout(timer));
  }
}

/* ── Unread agent tracking ── */

const unreadAgents = new Set<string>();
export const AGENT_UNREAD_EVENT = "agent-unread-update";

export function hasUnreadAgentMessage(agentId: string) {
  return getAgentIdAliases(agentId).some((alias) => unreadAgents.has(alias));
}

export function getUnreadAgentCount() {
  return getUnreadAgentIds().length;
}

export function getUnreadAgentIds(): string[] {
  return Array.from(new Set(Array.from(unreadAgents).map(toCanonicalAgentId).filter(Boolean)));
}

export function clearUnreadAgent(agentId: string) {
  let changed = false;
  for (const alias of getAgentIdAliases(agentId)) {
    if (unreadAgents.delete(alias)) changed = true;
  }
  if (changed) {
    window.dispatchEvent(new CustomEvent(AGENT_UNREAD_EVENT));
  }
}

function navigateToAgent(agentId: string) {
  window.dispatchEvent(
    new CustomEvent("navigate-to-agent", {
      detail: { agentId },
    })
  );
}
export function markAgentUnread(agentId: string) {
  const canonical = toCanonicalAgentId(agentId ?? "");
  // Guard against ghost entries: must be a sane id (no whitespace, reasonable length).
  if (!canonical || canonical.length > 64 || /\s/.test(canonical) || !/^[a-z0-9][a-z0-9_-]*$/i.test(canonical)) {
    console.warn("[chat-sender] markAgentUnread ignored invalid agentId:", agentId);
    return;
  }
  if (unreadAgents.has(canonical)) return; // dedupe — no duplicate events
  unreadAgents.add(canonical);
  window.dispatchEvent(new CustomEvent(AGENT_UNREAD_EVENT));
}

/**
 * Remove any unread entries that are not in the known canonical agent list.
 * Call this whenever the agent catalog is loaded/refreshed to evict ghosts.
 */
export function pruneUnreadAgents(knownAgentIds: string[]) {
  const known = new Set(knownAgentIds.map((id) => toCanonicalAgentId(id)).filter(Boolean));
  let changed = false;
  for (const entry of Array.from(unreadAgents)) {
    if (!known.has(toCanonicalAgentId(entry))) {
      unreadAgents.delete(entry);
      changed = true;
    }
  }
  if (changed) {
    console.warn("[chat-sender] pruneUnreadAgents removed ghost unread entries");
    window.dispatchEvent(new CustomEvent(AGENT_UNREAD_EVENT));
  }
}

function isSameAgentId(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  const leftAliases = getAgentIdAliases(left);
  return getAgentIdAliases(right).some((alias) => leftAliases.includes(alias));
}

/* ── Custom events for live React sync ── */

export const CHAT_UPDATE_EVENT = "chat-bg-update";
export const CHAT_STREAM_EVENT = "chat-bg-stream";
export const CHAT_PENDING_EVENT = "chat-bg-pending";
export const CHAT_HEARTBEAT_EVENT = "chat-bg-heartbeat";

// Re-export activity event for convenience
export { CHAT_ACTIVITY_EVENT } from "@/components/chat/StreamingActivityIndicator";
import { emitActivity, type ActivityItem } from "@/components/chat/StreamingActivityIndicator";


export interface ChatUpdateDetail {
  agentId: string;
  message: ChatMessage;
}

export interface ChatStreamDetail {
  agentId: string;
  partialText: string;
}

export interface ChatHeartbeatDetail {
  agentId: string;
  /** null clears the heartbeat list (task ended) */
  heartbeat: { id: string; content: string; timestamp: string } | null;
  /** when true, clears any previous heartbeats before adding */
  reset?: boolean;
}

function emitUpdate(agentId: string, message: ChatMessage) {
  window.dispatchEvent(
    new CustomEvent<ChatUpdateDetail>(CHAT_UPDATE_EVENT, {
      detail: { agentId, message },
    })
  );
}

function emitStream(agentId: string, partialText: string) {
  window.dispatchEvent(
    new CustomEvent<ChatStreamDetail>(CHAT_STREAM_EVENT, {
      detail: { agentId, partialText },
    })
  );
}

function emitHeartbeat(agentId: string, heartbeat: ChatHeartbeatDetail["heartbeat"], reset = false) {
  window.dispatchEvent(
    new CustomEvent<ChatHeartbeatDetail>(CHAT_HEARTBEAT_EVENT, {
      detail: { agentId, heartbeat, reset },
    })
  );
}

/**
 * Progress heartbeat heuristic: short single-line messages that start with a
 * progress emoji are treated as intermediate status updates, not the final
 * reply. Kept strict on purpose — misclassifying a real reply as heartbeat
 * causes the "🧠 Aguarde..." placeholder to hang indefinitely.
 */
const HEARTBEAT_EMOJI_RE = /^\s*(?:🔄|✅|⏳|🔍|⚙️|📥|📤|🎬|📝|🎯|🧠|🟢|🟡|🔴|▶️|⏱️|🚀|📊|💾|🔎|📡|⌛|✨|🛠️|🧪)/u;
function isHeartbeatMessage(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  // Strict: single short line, no paragraphs, no line breaks at all.
  if (trimmed.length > 180) return false;
  if (/\r|\n/.test(trimmed)) return false;
  return HEARTBEAT_EMOJI_RE.test(trimmed);
}

/** Max time to keep waiting after the last heartbeat before promoting it to
 *  the final reply. Prevents the placeholder from hanging when the agent
 *  emits only short progress pings and no clearly-final message. */
const STALE_HEARTBEAT_MS = 45_000;

/* ── Payload builders ── */

interface NormalizedImagePayload {
  mediaType: string;
  data: string;
  dataUri: string;
}

function normalizeImageData(input: string, fallbackMediaType = "image/jpeg"): NormalizedImagePayload {
  const trimmed = input.trim();
  const match = trimmed.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  const mediaType = match?.[1] ?? fallbackMediaType;
  const data = (match?.[2] ?? trimmed).replace(/\s/g, "");

  return {
    mediaType,
    data,
    dataUri: `data:${mediaType};base64,${data}`,
  };
}

function buildImageContentPart(payload: NormalizedImagePayload) {
  return {
    type: "image_url",
    image_url: { url: payload.dataUri },
    inline_data: {
      mime_type: payload.mediaType,
      data: payload.data,
    },
  };
}

async function urlToDataUri(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

function isExtractionPlaceholder(text?: string | null) {
  const normalized = text?.trim().toLowerCase() ?? "";
  return (
    !normalized ||
    (normalized.startsWith("[arquivo anexado:") && normalized.includes("não foi possível extrair o conteúdo"))
  );
}


interface PreparedFileAttachment {
  promptText?: string;
}

async function prepareFileAttachmentForAgent(att: MediaAttachment): Promise<PreparedFileAttachment | null> {
  const rawFile = (att as any)._rawFile as File | undefined;
  const filename = att.name || rawFile?.name || "arquivo";
  const fileUrl = att.url || att.base64 || "";

  // Send only a reference with signed URL — never inject file content
  if (!fileUrl) return null;

  return {
    promptText: `O usuário enviou o arquivo "${filename}".\nAcesse em: ${fileUrl}\nUse web_fetch para ler o conteúdo quando necessário.`,
  };
}

const ARTIFACT_SYSTEM_PROMPT = `Quando o usuário pedir algo que pode ser visualizado ou interagido, SEMPRE gere um artefato HTML sem precisar ser solicitado explicitamente.

Exemplos: calculadora, tabela de dados, gráfico (chart.js), formulário, dashboard, comparativo, cronograma, checklist, análise.

REGRA: Se a resposta pode ser mais útil como algo visual/interativo, gere o código HTML dentro de um bloco \`\`\`html ALÉM da explicação em texto.

IMPORTANTE — REGRAS OBRIGATÓRIAS DE ARTEFATOS:
- NUNCA retorne apenas o nome do arquivo ou URL do artefato (ex: "dash-cpa.html", "relatório.html")
- NUNCA use ferramentas como files_create, files_upload ou similares como substituto do código inline
- SEMPRE inclua o código HTML COMPLETO e FUNCIONAL dentro de um bloco \`\`\`html na mensagem
- Mesmo que você salve o arquivo em outro lugar, o código completo DEVE estar na resposta
- Se o artefato for grande, ainda assim inclua o código completo — não resuma nem omita partes

Sempre use nestes artefatos:
- Cores HS.OS: azul #3D61FF, vermelho #E41A11
- Dark mode: fundo #0a0a0a, texto branco
- Fonte: sans-serif
- Design limpo e profissional
- HTML completo e funcional (inclua <script> e <style> inline)`;

/**
 * Strip <live_artifact> and <artifact> HTML from context messages so the model
 * doesn't re-ingest 15KB+ of markup on every follow-up turn. The artifact
 * still renders in the chat UI — this only affects the payload sent upstream.
 */
function stripArtifacts(text: string): string {
  if (!text) return text;
  let out = text.replace(/<live_artifact([^>]*)>[\s\S]*?<\/live_artifact>/gi, (_m, attrs: string) => {
    const t = attrs.match(/title="([^"]+)"/);
    return t ? `[Artifact: ${t[1]}]` : "[Artifact]";
  });
  out = out.replace(/<artifact([^>]*)>[\s\S]*?<\/artifact>/gi, (_m, attrs: string) => {
    const t = attrs.match(/title="([^"]+)"/);
    return t ? `[Artifact: ${t[1]}]` : "[Artifact]";
  });
  return out;
}

/** Cap a context message to ~2KB so no single turn dominates the window. */
function capMessage(text: string, maxBytes = 2048): string {
  if (!text) return text;
  if (new Blob([text]).size <= maxBytes) return text;
  return text.slice(0, maxBytes) + "...";
}

/** Build chat-completions style messages array for /api/stream */
/**
 * As instruções que o agente precisa saber uma vez por conversa.
 *
 * Junta o formato de artefato, os artefatos que a pessoa já tem, as integrações
 * disponíveis, a tarefa longa pendente (se houver), o status dela e a pasta
 * local autorizada. Tudo isto ia como blocos `role: "system"` no caminho antigo.
 *
 * ⚠️ **Vai como texto, não como system prompt.** O `chat.send` não tem canal de
 * system — o agente já tem o dele, montado no OpenClaw. Isto aqui é contexto da
 * plataforma, e chega como a primeira coisa que a pessoa "diz".
 */
async function montarInstrucoesDaSessao(agentId?: string): Promise<string> {
  const blocos: string[] = [ARTIFACT_SYSTEM_PROMPT];

  if (agentId) {
    try {
      const { getPendingAgentTask, buildPendingTaskSystemPrompt } = await import("@/lib/pending-agent-task");
      const pending = getPendingAgentTask(agentId);
      if (pending) blocos.push(buildPendingTaskSystemPrompt(pending));
    } catch { /* tarefa pendente é extra */ }
  }

  try {
    const { getSelfStatusCache, formatStatusForAgentContext } = await import("@/lib/user-status");
    const statusLine = formatStatusForAgentContext(getSelfStatusCache());
    if (statusLine) blocos.push(statusLine);
  } catch { /* status é extra */ }

  try {
    const { getActiveLocalFolder, buildLocalFolderSystemPrompt } = await import("@/lib/file-system-state");
    const folder = getActiveLocalFolder();
    if (folder) blocos.push(buildLocalFolderSystemPrompt(folder));
  } catch { /* pasta local é extra */ }

  try {
    const { buildLiveArtifactsSystemBlocks } = await import("@/lib/live-artifacts-context");
    blocos.push(...(await buildLiveArtifactsSystemBlocks()));
  } catch { /* artefatos vivos são extra */ }

  return blocos.filter(Boolean).join("\n\n");
}

/**
 * Descreve em texto as imagens e documentos anexados nesta mensagem.
 *
 * ⚠️ **Sem isto o anexo não existe para o agente.** Ele recebe texto; a imagem
 * fica no navegador e na tela, e o agente responde "não recebi nenhuma imagem" —
 * foi exatamente o que aconteceu no teste de 10/08/2026.
 *
 * A descrição vem de `/ia/descrever-imagem` (OpenAI). Falha ali não bloqueia a
 * mensagem: a pessoa ainda manda o anexo e conversa, o agente é que fica sem
 * saber o que a imagem mostra.
 */
async function descreverImagensDoTurno(msg: ChatMessage | undefined): Promise<string> {
  if (!msg) return "";
  const midia = msg.media ?? [];
  const partes: string[] = [];

  const documentos = midia.filter(
    (m) => m.type === "file" && m.extractedText && !isExtractionPlaceholder(m.extractedText),
  );
  for (const d of documentos) {
    partes.push(`[Arquivo anexado: ${d.name}]\n\n${d.extractedText}`);
  }

  const imagens = midia.filter((m) => m.type === "image");
  for (const img of imagens) {
    try {
      const descricao = await getAgentReadableImageContext(img);
      if (descricao) partes.push(`[Imagem anexada${img.name ? `: ${img.name}` : ""}]\n\n${descricao}`);
    } catch (e) {
      console.warn("[chat-sender] descrição de imagem falhou:", (e as Error).message);
    }
  }

  return partes.join("\n\n---\n\n");
}



/**
 * Convention separator that splits a single completion into multiple
 * chat bubbles. Emitted by the stream reader whenever the gateway signals
 * `finish_reason: "stop"` mid-stream, or already present in the text when
 * the agent (or the gateway) deliberately bursts a response.
 */
export const MSG_BREAK_TOKEN = "[[MSG_BREAK]]";
const MSG_BREAK_SPLIT_RE = /\[\[MSG_BREAK\]\]|\n?<<<MSG_BREAK>>>\n?/g;

export function splitIntoMessages(text: string): string[] {
  if (!text) return [];
  const parts = text
    .split(MSG_BREAK_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [text.trim()].filter(Boolean);
}



/**
 * Comando de barra (`/stop`, `/new`, `/compact`) para a sessão do agente.
 *
 * O backend não espera a resposta do gateway e nem nós: o `/stop` só serve se
 * chegar depressa, e o efeito aparece na conversa, não no retorno.
 */
async function enviarComando(agentId: string, comando: string, signal: AbortSignal): Promise<void> {
  await api(`/conversations/${encodeURIComponent(agentId)}/comando`, {
    method: "POST",
    body: { comando },
    signal,
  });
}

/* ── Pending requests tracker ── */

const pendingAgents = new Set<string>();

export function isAgentPending(agentId: string) {
  return pendingAgents.has(agentId);
}

export function getPendingAgentIds(): ReadonlySet<string> {
  return pendingAgents;
}

function emitPending() {
  window.dispatchEvent(new CustomEvent(CHAT_PENDING_EVENT));
}

/* ── History limiter ── */

const MAX_HISTORY = 30;


/* ── Polling for background reply ── */

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_TIME_MS = 180_000;
// Extended poll used when the streaming request timed out — keeps the UI in
// "processing" mode (no red error bubble) while we wait for the gateway's
// late inter-session reply to land in `conversations`.
const EXTENDED_POLL_TIME_MS = 15 * 60_000;
const EXTENDED_POLL_INTERVAL_MS = 10_000;

async function pollForBackgroundReply(
  agentId: string,
  userId: string,
  sinceTimestamp: string,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    onTick?: (elapsedMs: number) => void;
    signal?: AbortSignal;
    /** When true, intermediate heartbeat-shaped messages are emitted via
     *  CHAT_HEARTBEAT_EVENT and polling continues until a final reply arrives.
     *  A stale heartbeat older than STALE_HEARTBEAT_MS is promoted to final. */
    emitHeartbeats?: boolean;
  },
): Promise<ChatMessage | null> {
  const timeoutMs = options?.timeoutMs ?? MAX_POLL_TIME_MS;
  const intervalMs = options?.intervalMs ?? POLL_INTERVAL_MS;
  const start = Date.now();
  let cursor = sinceTimestamp;
  let lastHeartbeatRow: { id: string; content: string; created_at: string; media?: unknown } | null = null;
  let lastHeartbeatAt = 0;

  // Realtime co-signal: any INSERT in conversations for this (agent,user) wakes
  // the polling loop immediately instead of waiting up to intervalMs.
  let realtimeTick = 0;
  // Tópico da pessoa: o backend roteia `conversations` por `user_id`, então só
  // as sessões dela recebem — o que o `filter` fazia, agora do lado do servidor.
  //
  // ⚠️ O sinal aqui é **só um cutucão**, não a resposta. O evento não diz se a
  // linha é do agente ou da pessoa (não carrega conteúdo), então acordar o laço
  // por uma mensagem que o próprio usuário acabou de mandar é aceitável: o
  // `pollOnce` logo abaixo confere. Filtrar por `role` custaria uma busca a mais
  // para economizar uma iteração que já ia acontecer em `intervalMs`.
  const cancelarRealtime = assinar(`usuario:${userId}`, (_tipo, dados) => {
    const m = dados as { tabela?: string; agent_id?: string | null };
    if (m?.tabela !== "conversations") return;
    if (m.agent_id && m.agent_id !== agentId) return;
    realtimeTick++;
  });

  const waitTick = async () => {
    const startTick = realtimeTick;
    const deadline = Date.now() + intervalMs;
    while (Date.now() < deadline) {
      if (options?.signal?.aborted) return;
      if (realtimeTick !== startTick) return;
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  try {
    while (Date.now() - start < timeoutMs) {
      if (options?.signal?.aborted) return null;
      const data = await api<any[]>(
        `/conversations/${encodeURIComponent(agentId)}/respostas` +
          `?depois=${encodeURIComponent(cursor)}`,
      ).catch(() => null);

      if (data && data.length > 0) {
        if (options?.emitHeartbeats) {
          // Walk messages in order: emit heartbeats, return on first "final".
          for (const row of data as Array<{ id: string; content: string; created_at: string; media?: unknown }>) {
            if (!row.content) continue;
            if (isHeartbeatMessage(row.content)) {
              emitHeartbeat(agentId, {
                id: row.id,
                content: row.content,
                timestamp: row.created_at,
              });
              lastHeartbeatRow = row;
              lastHeartbeatAt = Date.now();
              cursor = row.created_at;
              continue;
            }
            return conversationRowToMessage(row, agentId);
          }
          // All were heartbeats — check staleness before continuing to wait.
          if (lastHeartbeatRow && Date.now() - lastHeartbeatAt >= STALE_HEARTBEAT_MS) {
            console.warn("[chat-sender] Promoting stale heartbeat to final reply", {
              agentId,
              staleMs: Date.now() - lastHeartbeatAt,
            });
            return conversationRowToMessage(lastHeartbeatRow, agentId);
          }
        } else {
          const last = data[data.length - 1];
          if (last.content) return conversationRowToMessage(last, agentId);
        }
      } else if (
        options?.emitHeartbeats &&
        lastHeartbeatRow &&
        Date.now() - lastHeartbeatAt >= STALE_HEARTBEAT_MS
      ) {
        // No new rows AND the last heartbeat is stale — promote it.
        console.warn("[chat-sender] Promoting stale heartbeat to final reply (no new rows)", {
          agentId,
          staleMs: Date.now() - lastHeartbeatAt,
        });
        return conversationRowToMessage(lastHeartbeatRow, agentId);
      }

      options?.onTick?.(Date.now() - start);
      await waitTick();
    }
    return null;
  } finally {
    try {
      cancelarRealtime();
    } catch {
      /* ignore */
    }
  }
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

/* ── Pending long-task registry (survives page refresh) ── */

const PENDING_STORAGE_KEY = "hsos:pending-long-tasks";

type PendingTaskKind = "normal" | "long";

interface PendingLongTask {
  agentId: string;
  userId: string;
  sinceTimestamp: string;
  startedAt: number;
  kind?: PendingTaskKind; // defaults to "long" for backward compat
}

// Max time a "normal" pending task remains valid after a refresh.
// After this window we assume the request truly failed and drop the placeholder.
const NORMAL_PENDING_BUDGET_MS = 5 * 60_000;

function loadPendingTasks(): PendingLongTask[] {
  try {
    return JSON.parse(lerChave(PENDING_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePendingTasks(tasks: PendingLongTask[]) {
  try {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    /* ignore quota */
  }
}

function addPendingTask(t: PendingLongTask) {
  const list = loadPendingTasks().filter(
    (x) => !(x.agentId === t.agentId && x.userId === t.userId)
  );
  list.push(t);
  savePendingTasks(list);
}

function removePendingTask(agentId: string, userId: string) {
  savePendingTasks(
    loadPendingTasks().filter(
      (x) => !(x.agentId === agentId && x.userId === userId)
    )
  );
}

const resumingAgents = new Set<string>();

function buildLongTaskPlaceholder(elapsedMs: number, partialText = ""): string {
  const elapsed = formatElapsed(elapsedMs);
  const header = `🧠 Aguarde, ainda estou trabalhando nisso… • ${elapsed} decorridos\n_Tarefa longa em andamento. Você pode continuar usando o app — vou avisar aqui assim que terminar._`;
  return partialText ? `${partialText}\n\n---\n${header}` : header;
}

function buildNormalPlaceholder(elapsedMs: number): string {
  const elapsed = formatElapsed(elapsedMs);
  return `⏳ Processando sua mensagem… • ${elapsed} decorridos`;
}

/**
 * Resume any pending placeholders (normal or long-task) that were active
 * before the page refreshed. Reads from localStorage and re-starts polling
 * + visual placeholder, picking up from the original startedAt timestamp.
 */
export function resumePendingBackgroundTasks(userId: string) {
  const tasks = loadPendingTasks().filter((t) => t.userId === userId);
  const now = Date.now();
  for (const t of tasks) {
    const kind: PendingTaskKind = t.kind ?? "long";
    const budget = kind === "normal" ? NORMAL_PENDING_BUDGET_MS : EXTENDED_POLL_TIME_MS;
    const elapsed = now - t.startedAt;
    if (elapsed >= budget) {
      removePendingTask(t.agentId, userId);
      continue;
    }
    if (resumingAgents.has(t.agentId) || pendingAgents.has(t.agentId)) continue;
    resumingAgents.add(t.agentId);
    runResumePoll({ ...t, kind }, elapsed, budget).finally(() =>
      resumingAgents.delete(t.agentId),
    );
  }
}

async function runResumePoll(t: PendingLongTask, initialElapsed: number, budget: number) {
  const kind: PendingTaskKind = t.kind ?? "long";

  // If a real reply already landed while the page was closed, surface it and bail.
  try {
    // O endpoint devolve em ordem crescente; a última é a mais recente.
    const data = await api<any[]>(
      `/conversations/${encodeURIComponent(t.agentId)}/respostas` +
        `?depois=${encodeURIComponent(t.sinceTimestamp)}`,
    ).catch(() => null);
    const ultima = data?.length ? data[data.length - 1] : null;
    if (ultima?.content) {
      removePendingTask(t.agentId, t.userId);
      emitUpdate(t.agentId, conversationRowToMessage(ultima, t.agentId));
      return;
    }
  } catch (err) {
    console.warn("[chat-sender] resume preflight failed", err);
  }

  pendingAgents.add(t.agentId);
  emitPending();
  const controller = new AbortController();
  const requestId = `resume-${t.agentId}-${t.startedAt}`;
  activeAgentRequests.set(t.agentId, { controller, requestId });

  // No text placeholder — the animated StreamingActivityIndicator + heartbeat
  // panel already communicate "working" without a fake message bubble.
  emitStream(t.agentId, "");

  try {
    const remaining = Math.max(budget - initialElapsed, 30_000);
    const bgMsg = await pollForBackgroundReply(t.agentId, t.userId, t.sinceTimestamp, {
      timeoutMs: remaining,
      intervalMs: kind === "normal" ? POLL_INTERVAL_MS : EXTENDED_POLL_INTERVAL_MS,
      signal: controller.signal,
      emitHeartbeats: kind === "long",
    });
    if (bgMsg) {
      emitStream(t.agentId, "");
      emitHeartbeat(t.agentId, null, true);
      emitUpdate(t.agentId, bgMsg);
    } else if (kind === "long") {
      // Budget exhausted with no reply — surface a brief transient notice, then clear.
      emitStream(
        t.agentId,
        "⌛ O agente não respondeu nos últimos 15 minutos. Sua próxima mensagem reabre a conversa.",
      );
      emitHeartbeat(t.agentId, null, true);
      setTimeout(() => emitStream(t.agentId, ""), 8_000);
    } else {
      emitStream(t.agentId, "");
      emitHeartbeat(t.agentId, null, true);
    }
  } catch (err) {
    console.warn("[chat-sender] resume poll failed", err);
    emitStream(t.agentId, "");
    emitHeartbeat(t.agentId, null, true);
  } finally {
    removePendingTask(t.agentId, t.userId);
    pendingAgents.delete(t.agentId);
    emitPending();
    const ar = activeAgentRequests.get(t.agentId);
    if (ar?.requestId === requestId) activeAgentRequests.delete(t.agentId);
  }
}


/* ── Fire-and-forget sender ── */

export function sendMessageInBackground(
  agentId: string,
  fullHistory: ChatMessage[],
) {
  stoppedAgents.delete(agentId);
  pendingAgents.add(agentId);
  emitPending();

  const run = async () => {
    const controller = new AbortController();
    const requestId = `${agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeAgentRequests.set(agentId, { controller, requestId });

    let userId: string | undefined;
    try {
      userId = lerUsuarioDoToken() ?? undefined;

      // O texto do turno é a ÚLTIMA mensagem do usuário, só ela. O histórico
      // inteiro não vai mais junto: quem guarda a conversa é a sessão do agente
      // no gateway, e reenviar o passado duplicaria o contexto.
      const ultima = [...fullHistory].reverse().find((m) => m.role === "user");
      const texto = typeof ultima?.content === "string" ? ultima.content.trim() : "";
      if (!texto) {
        console.warn("[chat-sender] Nada a enviar — turno sem mensagem de usuário.");
        return;
      }

      // ⚠️ **O `chat.send` do gateway carrega só texto.** O caminho antigo
      // mandava um array `messages` com blocos `role: "system"` e partes de
      // imagem — e quando o envio foi reescrito, o montador desses blocos ficou
      // órfão sem ninguém notar. O efeito: a agente não sabia o formato de
      // artefato (usava o `[embed]` nativo do OpenClaw) e não recebia anexo
      // nenhum. Aqui o que era `messages` vira prefixo do texto.
      //
      // As duas coisas têm naturezas diferentes e por isso são tratadas
      // separadamente:
      //
      // - **A imagem é do turno.** Vai sempre que houver anexo, porque descreve
      //   o que a pessoa acabou de mandar.
      // - **As instruções são da sessão.** O gateway guarda o histórico, então
      //   repeti-las a cada mensagem gastaria contexto à toa. Vão só na
      //   primeira mensagem da conversa.
      const prefixos: string[] = [];

      const ehPrimeiraDaConversa = !fullHistory.some((m) => m.role === "agent");
      if (ehPrimeiraDaConversa) {
        try {
          const blocos = await montarInstrucoesDaSessao(agentId);
          if (blocos) prefixos.push(blocos);
        } catch (e) {
          // Instrução é acabamento: sem ela o agente responde, só não sabe
          // gerar artefato. Não vale bloquear a mensagem.
          console.warn("[chat-sender] instruções da sessão falharam:", (e as Error).message);
        }
      }

      const descricoes = await descreverImagensDoTurno(ultima);
      if (descricoes) prefixos.push(descricoes);

      const textoParaOAgente = prefixos.length
        ? `${prefixos.join("\n\n")}\n\n---\n\n${texto}`
        : texto;

      if (userId) {
        addPendingTask({
          kind: "normal",
          agentId,
          userId,
          sinceTimestamp: new Date().toISOString(),
          startedAt: Date.now(),
        });
      }

      const resposta = await enviarParaAgente(agentId, textoParaOAgente, controller.signal);

      if (manuallyStoppedRequestIds.has(requestId)) {
        // O usuário mandou parar enquanto esperávamos. A resposta pode ter
        // chegado mesmo assim e já está gravada; só não empurramos para a tela.
        return;
      }

      if (resposta.status === "erro") {
        const errMsg: ChatMessage = {
          id: `erro-${Date.now()}`,
          agentId,
          role: "agent",
          content: `[error] ${resposta.detalhe ?? "Falha ao falar com o agente."}`,
          timestamp: new Date().toISOString(),
          channel: "web",
          isError: true,
        };
        emitUpdate(agentId, errMsg);
        return;
      }

      // A resposta JÁ foi gravada pelo backend, junto com a espera — por isso
      // aqui não há `appendToConversations`. Gravar de novo duplicaria.
      const partes = splitIntoMessages(resposta.content ?? "");
      partes.forEach((parte, i) => {
        emitUpdate(agentId, {
          // Só a primeira parte corresponde à linha persistida; as demais são
          // recorte de exibição do mesmo texto.
          id: i === 0 ? (resposta.messageId ?? `resp-${Date.now()}`) : `${resposta.messageId}-p${i}`,
          agentId,
          role: "agent",
          content: parte,
          timestamp: resposta.createdAt ?? new Date().toISOString(),
          channel: "web",
        });
      });

      if (!isSameAgentId(_activeAgentId, agentId)) {
        markAgentUnread(agentId);
      }
    } catch (err) {
      console.error("[chat-sender] Falha no turno:", err);
      emitUpdate(agentId, {
        id: `erro-${Date.now()}`,
        agentId,
        role: "agent",
        content: `[error] ${(err as Error)?.message ?? "Erro inesperado."}`,
        timestamp: new Date().toISOString(),
        channel: "web",
        isError: true,
      });
    } finally {
      const activeRequest = activeAgentRequests.get(agentId);
      if (activeRequest?.requestId === requestId) {
        activeAgentRequests.delete(agentId);
      }
      manuallyStoppedRequestIds.delete(requestId);
      pendingAgents.delete(agentId);
      if (userId) removePendingTask(agentId, userId);
      emitPending();
    }
  };

  run();
}
