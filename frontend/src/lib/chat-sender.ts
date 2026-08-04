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

import { getAgentReadableImageContext } from "@/lib/chat-image-vision";
import { getModelForAgent } from "@/lib/active-agents";
import { appendToConversations, conversationRowToMessage } from "@/lib/chat-persistence";
import { getModelOverride } from "@/lib/agent-model-override";
import { getAgentIdAliases, toCanonicalAgentId } from "@/lib/agent-id";
import type { ChatMessage, MediaAttachment } from "@/lib/mock-data";
import { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { createElement } from "react";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

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
    const raw = localStorage.getItem(`dnos:session-gen:${canonicalAgentId}`);
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
    localStorage.setItem(`dnos:session-gen:${canonicalAgentId}`, String(next));
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

/**
 * Feature flag (cancelamento real): quando ligada, "parar" também envia /stop
 * ao gateway em vez de só abortar o fetch local (que hoje só esconde a resposta
 * da tela — o agente continua rodando e gastando no servidor). Testar com:
 * localStorage.setItem('dnos_flag_real_stop','on'). OFF = comportamento atual.
 */
function isRealStopEnabled(): boolean {
  try {
    return localStorage.getItem("dnos_flag_real_stop") === "on";
  } catch {
    return false;
  }
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
  if (isRealStopEnabled()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    runSlashCommandViaEdge(agentId, "/stop", controller.signal)
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
- Cores dn.ia: azul #3D61FF, vermelho #E41A11
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
 * Feature flag (V3 — cache da DeepSeek): quando ligada, os blocos de sistema
 * DINÂMICOS (tarefa pendente, status, pasta, artefatos) vão para o FIM do prompt
 * (logo antes da mensagem atual) em vez do topo. Isso mantém o prefixo estável
 * (prompt estático + histórico) para a DeepSeek cachear a conversa acumulada, em
 * vez de reprocessar tudo a cada turno. Testar com: localStorage.setItem(
 * 'dnos_flag_reorder_prompt','on'). OFF por padrão = comportamento atual idêntico.
 */
function isReorderPromptEnabled(): boolean {
  try {
    return localStorage.getItem("dnos_flag_reorder_prompt") === "on";
  } catch {
    return false;
  }
}

/**
 * Feature flag (A3 — erro estruturado): quando ligada, o cliente reconhece o erro
 * do gateway (que vem disfarçado de HTTP 200 com JSON {error, detail}) e mostra
 * "Falhou: <motivo>" na hora, em vez de tentar ler como stream e cair no poll de
 * 15 minutos ("trabalhando…" mentiroso). Testar: localStorage.setItem(
 * 'dnos_flag_structured_errors','on'). OFF por padrão = comportamento atual.
 */
function isStructuredErrorsEnabled(): boolean {
  try {
    return localStorage.getItem("dnos_flag_structured_errors") === "on";
  } catch {
    return false;
  }
}

async function toChatMessages(messages: ChatMessage[], agentId?: string): Promise<any[]> {
  const reorder = isReorderPromptEnabled();
  const results: any[] = [
    { role: "system", content: ARTIFACT_SYSTEM_PROMPT },
  ];
  // Blocos dinâmicos coletados aqui; posicionados no topo (flag OFF) ou logo
  // antes da mensagem atual (flag ON) mais abaixo.
  const dynamicBlocks: any[] = [];

  // Loop Architecture: inject a reminder about any pending long-running task
  // for this agent so it resumes before doing anything else, even if its
  // SOUL.md was truncated in the previous session.
  if (agentId) {
    try {
      const { getPendingAgentTask, buildPendingTaskSystemPrompt } = await import("@/lib/pending-agent-task");
      const pending = getPendingAgentTask(agentId);
      if (pending) dynamicBlocks.push({ role: "system", content: buildPendingTaskSystemPrompt(pending) });
    } catch {
      /* ignore */
    }
  }

  // Inject current user status (if any) so the agent knows the user may be away
  try {
    const { getSelfStatusCache, formatStatusForAgentContext } = await import("@/lib/user-status");
    const statusLine = formatStatusForAgentContext(getSelfStatusCache());
    if (statusLine) dynamicBlocks.push({ role: "system", content: statusLine });
  } catch {
    /* ignore */
  }

  // Inject local folder context when the user authorized a folder via File System Access API
  try {
    const { getActiveLocalFolder, buildLocalFolderSystemPrompt } = await import("@/lib/file-system-state");
    const folder = getActiveLocalFolder();
    if (folder) dynamicBlocks.push({ role: "system", content: buildLocalFolderSystemPrompt(folder) });
  } catch {
    /* ignore */
  }

  // Inject live-artifacts format + user's existing live artifacts + available data integrations
  try {
    const { buildLiveArtifactsSystemBlocks } = await import("@/lib/live-artifacts-context");
    const blocks = await buildLiveArtifactsSystemBlocks();
    for (const block of blocks) dynamicBlocks.push({ role: "system", content: block });
  } catch {
    /* ignore */
  }

  // Flag OFF (padrão): mantém a ordem atual — dinâmicos logo após o prompt estático.
  if (!reorder) results.push(...dynamicBlocks);

  // Limit prior context to the 30 most recent turns. Artifact HTML (~15KB per
  // <live_artifact>) was being replayed on every follow-up, blowing the model
  // window and causing timeouts. We strip artifacts + cap size on history
  // turns (see below); the current user turn (last message) is left intact.
  const contextMessages = messages.slice(-30);
  const lastIndex = contextMessages.length - 1;
  let dynamicsPlaced = !reorder; // flag OFF: já colocados acima

  for (let i = 0; i < contextMessages.length; i++) {
    const msg = contextMessages[i];
    const role = msg.role === "agent" ? "assistant" : "user";
    const text = msg.content?.trim() ?? "";
    const images = (msg.media ?? []).filter((m) => m.type === "image");
    const docs = (msg.media ?? []).filter(
      (m) => m.type === "file" && m.extractedText && !isExtractionPlaceholder(m.extractedText)
    );

    let contextText = "";
    if (docs.length > 0) {
      contextText = docs
        .map((d) => `[Arquivo: ${d.name}]\n\n${d.extractedText}`)
        .join("\n\n---\n\n");

      if (contextText) {
        contextText += "\n\n---\n\n";
      }
    }

    if (images.length > 0) {
      const imageContexts = await Promise.all(
        images.map(async (image, index) => {
          try {
            const summary = await getAgentReadableImageContext(image);
            return summary ? `[Imagem ${index + 1}${image.name ? ` - ${image.name}` : ""}]\n${summary}` : null;
          } catch (error) {
            console.warn("[chat-sender] Failed to extract readable image context:", error);
            return null;
          }
        })
      );

      const mergedImageContext = imageContexts.filter(Boolean).join("\n\n");
      if (mergedImageContext) {
        contextText += `${mergedImageContext}\n\n`;
      }
    }

    // Always send as plain text — image context is already extracted above.
    // Sending raw base64 data causes 413 errors on the gateway (nginx payload limit).
    let content = contextText + (text || (role === "assistant" ? "[resposta]" : "[mensagem]"));

    if (i < lastIndex) {
      content = capMessage(stripArtifacts(content));
    } else {
      content = stripArtifacts(content);
    }

    // Flag ON (V3): insere os blocos dinâmicos logo antes da mensagem atual,
    // fechando o prefixo estável (prompt + histórico) que a DeepSeek cacheia.
    if (reorder && !dynamicsPlaced && i === lastIndex) {
      results.push(...dynamicBlocks);
      dynamicsPlaced = true;
    }
    results.push({ role, content });
  }
  // Fallback (histórico vazio): garante que os dinâmicos não se percam.
  if (reorder && !dynamicsPlaced) results.push(...dynamicBlocks);
  return results;
}


interface ExtractedReply {
  text: string;
  media?: MediaAttachment[];
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

function extractImagesFromPayload(data: any): MediaAttachment[] | undefined {
  const images: MediaAttachment[] = [];

  // Format: data.images (array of {url, base64, b64_json, mime_type})
  const topImages = data?.images;
  if (Array.isArray(topImages)) {
    for (const img of topImages) {
      const src = img.url || img.b64_json || img.base64;
      if (!src) continue;
      images.push({
        type: "image",
        url: src.startsWith("http") ? src : undefined,
        base64: src.startsWith("http") ? undefined : src,
        mimeType: img.mime_type || "image/png",
        name: img.name || "generated-image.png",
      });
    }
  }

  // Format: choices[0].message.images
  const choiceImages = data?.choices?.[0]?.message?.images;
  if (Array.isArray(choiceImages)) {
    for (const img of choiceImages) {
      const src = img.url || img.b64_json || img.base64;
      if (!src) continue;
      images.push({
        type: "image",
        url: src.startsWith("http") ? src : undefined,
        base64: src.startsWith("http") ? undefined : src,
        mimeType: img.mime_type || "image/png",
        name: img.name || "generated-image.png",
      });
    }
  }

  // Format: output[].content[].image (inline_data)
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (part?.type === "image" && part?.image) {
            const src = part.image.url || part.image.b64_json || part.image.base64;
            if (src) {
              images.push({
                type: "image",
                url: src.startsWith("http") ? src : undefined,
                base64: src.startsWith("http") ? undefined : src,
                mimeType: part.image.mime_type || "image/png",
                name: "generated-image.png",
              });
            }
          }
          // inline_data format (Gemini)
          if (part?.inline_data?.data && part?.inline_data?.mime_type?.startsWith("image/")) {
            images.push({
              type: "image",
              base64: part.inline_data.data,
              mimeType: part.inline_data.mime_type,
              name: "generated-image.png",
            });
          }
        }
      }
    }
  }

  // Format: choices[0].message.content as array with inline_data parts
  const choiceContent = data?.choices?.[0]?.message?.content;
  if (Array.isArray(choiceContent)) {
    for (const part of choiceContent) {
      if (part?.inline_data?.data && part?.inline_data?.mime_type?.startsWith("image/")) {
        images.push({
          type: "image",
          base64: part.inline_data.data,
          mimeType: part.inline_data.mime_type,
          name: "generated-image.png",
        });
      }
    }
  }

  return images.length > 0 ? images : undefined;
}

function extractResponsesReply(data: any): ExtractedReply {
  const media = extractImagesFromPayload(data);
  
  let text = "";
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item.type === "message" && item.role === "assistant") {
        if (typeof item.content === "string") { text = item.content; break; }
        if (Array.isArray(item.content)) {
          const texts = item.content
            .filter((c: any) => c.type === "output_text" || c.type === "text")
            .map((c: any) => c.text)
            .filter(Boolean);
          if (texts.length > 0) { text = texts.join("\n"); break; }
        }
      }
    }
  }
  if (!text && typeof data?.output_text === "string") text = data.output_text;
  if (!text && typeof data?.content === "string") text = data.content;
  
  // For choices format, extract text
  if (!text && Array.isArray(data?.choices)) {
    const content = data.choices[0]?.message?.content;
    if (typeof content === "string") text = content;
    else if (Array.isArray(content)) {
      text = content
        .filter((p: any) => p.type === "text" || typeof p.text === "string")
        .map((p: any) => p.text)
        .filter(Boolean)
        .join("\n");
    }
  }
  
  // Don't fabricate a placeholder "Sem resposta do agente." text — that gets
  // persisted as a real reply and hides the fact that the agent is still
  // working. Empty payloads are routed to the extended-polling path instead.
  return { text: text ?? "", media };
}

/* ── OpenClaw preview line detection ── */

const OPENCLAW_PREVIEW_PATTERNS = [
  /pesquisando/i,
  /buscando/i,
  /\blendo\b/i,
  /executando/i,
  /chamando/i,
  /acessando/i,
  /processando/i,
  /analisando/i,
  /consultando/i,
  /searching/i,
  /reading/i,
  /running/i,
  /fetching/i,
  /calling/i,
  /thinking/i,
];

function isOpenClawPreviewChunk(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 120) return false;
  // Markdown / code fences / lists are real content
  if (/[`{}<>]/.test(trimmed)) return false;
  if (trimmed.includes("\n\n")) return false;
  return OPENCLAW_PREVIEW_PATTERNS.some((p) => p.test(trimmed));
}

/* ── Gateway error detection ── */

const GATEWAY_ERROR_PATTERNS = [
  "temporarily overloaded",
  "service is temporarily",
  "rate limit",
  "server is overloaded",
  "too many requests",
  "503 service unavailable",
  "502 bad gateway",
];

function isGatewayOverloadError(text: string): boolean {
  const lower = text.toLowerCase();
  return GATEWAY_ERROR_PATTERNS.some((p) => lower.includes(p));
}

/* ── Context overflow auto-reset ── */

const CONTEXT_OVERFLOW_PATTERNS = [
  "context overflow",
  "prompt too large",
  "context length",
  "context window",
  "maximum context",
  "token limit",
  "too many tokens",
  "request too large",
  "input too long",
  "context_length_exceeded",
];

function isContextOverflowError(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return CONTEXT_OVERFLOW_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Feature flag (A1 — fim do falso-positivo de overflow): quando ligada, para
 * de checar essas palavras-chave dentro de RESPOSTAS BEM-SUCEDIDAS do agente
 * (reply.text). Hoje, se o agente só MENCIONA "context window"/"rate limit"
 * numa resposta normal (ex.: debugando um problema de tokens), a sessão é
 * resetada no meio do trabalho — foi o gatilho do rabbit hole do incidente
 * original. A checagem sobre ERROS DE VERDADE (exceção lançada, err.message)
 * continua ativa sempre — é legítima e agora reforçada pelo A3 (erro
 * estruturado do gateway). Testar: localStorage.setItem(
 * 'dnos_flag_fix_overflow_falsepositive','on'). OFF = comportamento atual.
 */
function isOverflowFalsePositiveFixEnabled(): boolean {
  try {
    return localStorage.getItem("dnos_flag_fix_overflow_falsepositive") === "on";
  } catch {
    return false;
  }
}

/* ── Empty / placeholder reply detection ── */

const EMPTY_REPLY_PATTERNS = [
  "sem resposta do agente",
  "no response from openclaw",
  "no response from",
];

function isEmptyReply(reply: ExtractedReply | undefined): boolean {
  if (!reply) return true;
  const txt = (reply.text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const hasMedia = Array.isArray(reply.media) && reply.media.length > 0;
  if (!txt) return !hasMedia;
  if (hasMedia) return false;
  return EMPTY_REPLY_PATTERNS.some((p) => txt === p || txt === `${p}.`);
}

/**
 * Attempt to reset the agent session at the gateway.
 * Best-effort: if the endpoint isn't available, we still proceed —
 * the next request will start a fresh session-id naturally.
 */
async function resetAgentSession(agentId: string): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const url = `${supabaseUrl}/functions/v1/gateway-chat`;

    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token || anonKey}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "reset_session", agentId }),
    }).catch((err) => {
      console.warn("[chat-sender] Session reset endpoint unavailable:", err?.message);
    });
  } catch (err) {
    console.warn("[chat-sender] resetAgentSession failed:", err);
  }
}

async function runSlashCommandViaEdge(agentId: string, commandText: string, signal: AbortSignal): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Sessão expirada. Recarregue a página e faça login novamente.");
  const canonicalAgentId = toCanonicalAgentId(agentId);
  const sessionUser = session.user?.id ? buildSessionUser(session.user.id, canonicalAgentId) : undefined;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const url = `${supabaseUrl}/functions/v1/gateway-chat`;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "command_session", agentId: canonicalAgentId, commandText, sessionUser }),
        signal,
      });

      const raw = await res.text().catch(() => "");
      let json: any = null;
      try {
        json = raw ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        throw new Error(json?.error || raw || `Backend respondeu ${res.status}`);
      }
      if (json?.ok === false) {
        if (isResetCommand(commandText)) {
          // Reset commands succeed on the gateway even when the ack fails/aborts
          return "Nova sessão iniciada.";
        }
        return `Comando falhou: ${json.error || json.raw || "gateway indisponível"}`;
      }

      const data = json?.data;
      return data?.text || data?.message || data?.reply || json?.raw || `✅ Comando ${commandText} executado.`;
    } catch (err: any) {
      lastError = err;
      const transient = err?.name === "AbortError" || err instanceof TypeError || /failed to fetch|network|timeout/i.test(String(err?.message ?? ""));
      if (!transient || attempt === 2 || signal.aborted) break;
      await wait(750 * (attempt + 1));
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "Erro desconhecido");
  throw new Error(/failed to fetch/i.test(message) ? "Falha de comunicação com o backend do comando. Tente novamente." : message);
}


/* ── Pending requests tracker ── */

const pendingAgents = new Set<string>();
const contextResetInFlight = new Set<string>();

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

function limitHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= MAX_HISTORY) return messages;
  return messages.slice(-MAX_HISTORY);
}

/* ── SSE Stream reader ── */

async function streamFromEdgeFunction(
  body: any,
  agentId: string,
  controller: AbortController,
  timeoutMs: number,
  accumulatedRef?: { current: string },
  onFirstToken?: () => void,
): Promise<ExtractedReply> {
  const tid = setTimeout(() => controller.abort("stream-timeout"), timeoutMs);

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const url = `${supabaseUrl}/functions/v1/gateway-chat`;

    console.log('[chat-sender] Chamando edge function proxy para stream');

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token || anonKey}`,
        apikey: anonKey,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error('[chat-sender] Edge function stream erro:', res.status, errText);
      throw new Error(`Erro ${res.status}: ${errText}`);
    }

    // A3 (flag): o gateway-chat devolve erro como HTTP 200 + JSON {error, detail}.
    // Se o Content-Type não é event-stream, é um erro disfarçado — extrai o motivo
    // real e lança um erro DEFINITIVO, em vez de tentar ler como stream (o que
    // levava ao STREAM_EMPTY → poll de 15 min mostrando "trabalhando…").
    if (isStructuredErrorsEnabled()) {
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/event-stream")) {
        const errBody = await res.json().catch(() => null);
        const detail = errBody?.detail || errBody?.error || "Falha do gateway";
        const gatewayErr: any = new Error(String(detail));
        gatewayErr.gatewayError = true; // erro definitivo — não faz fallback/poll
        throw gatewayErr;
      }
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("Stream não suportado pelo navegador");

    const decoder = new TextDecoder();
    let accumulated = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            // Detect tool_use / tool_calls events
            if (parsed?.type === "tool_use" || parsed?.tool_calls || parsed?.choices?.[0]?.delta?.tool_calls) {
              const toolCalls = parsed.tool_calls || parsed?.choices?.[0]?.delta?.tool_calls || [parsed];
              for (const tc of (Array.isArray(toolCalls) ? toolCalls : [toolCalls])) {
                const toolName = tc.name || tc.function?.name || tc.type || "tool";
                const toolId = tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
                let parsedArgs: Record<string, unknown> | undefined = tc.input;
                if (!parsedArgs && tc.function?.arguments) {
                  try { parsedArgs = JSON.parse(tc.function.arguments); } catch { parsedArgs = undefined; }
                }
                let desc = toolName;
                if (parsedArgs?.path) desc = `${toolName}: ${parsedArgs.path}`;
                else if (parsedArgs?.query) desc = `${toolName}: "${parsedArgs.query}"`;
                const lname = String(toolName).toLowerCase();
                const actType: ActivityItem["type"] =
                  /search|web|perplexity|fetch|url|browse/.test(lname) ? "search" :
                  /read|file|memory|workspace|document/.test(lname) ? "read_file" :
                  /code|execute|run|bash|python/.test(lname) ? "executing" :
                  /api|http|request|post|call/.test(lname) ? "calling" :
                  "tool_use";
                emitActivity(agentId, { id: toolId, type: actType, description: desc, status: "running", timestamp: Date.now() });

              }
            }

            // Detect tool results (mark as done)
            if (parsed?.type === "tool_result" && parsed?.tool_use_id) {
              emitActivity(agentId, { id: parsed.tool_use_id, type: "tool_use", description: "", status: "done", timestamp: Date.now() });
            }



            let chunk: string | undefined;
            if (typeof parsed?.delta === "string") chunk = parsed.delta;
            else if (typeof parsed?.delta?.content === "string") chunk = parsed.delta.content;
            else if (typeof parsed?.choices?.[0]?.delta?.content === "string") chunk = parsed.choices[0].delta.content;
            else if (typeof parsed?.text === "string") chunk = parsed.text;
            else if (typeof parsed?.content === "string") chunk = parsed.content;

            // Multi-message support: when the gateway signals end-of-message
            // mid-stream (finish_reason: stop / end_turn) and more content
            // arrives afterwards, insert MSG_BREAK_TOKEN so the final text
            // splits into multiple bubbles.
            const finishReason =
              parsed?.choices?.[0]?.finish_reason ||
              parsed?.finish_reason ||
              parsed?.stop_reason;
            const isFinish = typeof finishReason === "string" && /stop|end_turn|complete/i.test(finishReason);
            if (isFinish && accumulated && !accumulated.endsWith(MSG_BREAK_TOKEN)) {
              accumulated += `\n${MSG_BREAK_TOKEN}\n`;
              if (accumulatedRef) accumulatedRef.current = accumulated;
            }

            if (chunk) {
              // Detect OpenClaw preview lines (status hints) before real content starts.
              // These should appear in the activity indicator, NOT in the message text.
              if (!accumulated && isOpenClawPreviewChunk(chunk)) {
                emitActivity(agentId, {
                  id: "preview",
                  type: "preview",
                  description: chunk.trim().replace(/^[\s>•\-*]+/, "").slice(0, 120),
                  status: "running",
                  timestamp: Date.now(),
                });
                continue;
              }
              if (!accumulated) { emitStream(agentId, ""); onFirstToken?.(); }
              accumulated += chunk;
              if (accumulatedRef) accumulatedRef.current = accumulated;
              emitStream(agentId, accumulated);
            }
          } catch {
            if (data && data !== "[DONE]") {
              accumulated += data;
              if (accumulatedRef) accumulatedRef.current = accumulated;
              emitStream(agentId, accumulated);
            }
          }
        }
      }
    }

    if (accumulated) {
      // Strip a trailing dangling break (last message had no content after stop)
      const cleaned = accumulated.replace(/(\s*\[\[MSG_BREAK\]\]\s*)+$/g, "").trim();
      return { text: cleaned };
    }

    try {
      const fullText = decoder.decode();
      if (fullText) {
        const json = JSON.parse(fullText);
        return extractResponsesReply(json);
      }
    } catch { /* ignore */ }

    throw new Error("STREAM_EMPTY");
  } finally {
    clearTimeout(tid);
  }
}

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
  const realtimeChannel = supabase
    .channel(`bg-reply-${agentId}-${userId}-${start}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "conversations",
        filter: `agent_id=eq.${agentId}`,
      },
      (payload) => {
        const row = payload.new as { user_id?: string; role?: string };
        if (row?.user_id === userId && row?.role === "agent") {
          realtimeTick++;
        }
      },
    )
    .subscribe();

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
      const { data } = await supabase
        .from("conversations")
        .select("id, content, created_at, media")
        .eq("agent_id", agentId)
        .eq("user_id", userId)
        .eq("role", "agent")
        .gt("created_at", cursor)
        .order("created_at", { ascending: true });

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
      supabase.removeChannel(realtimeChannel);
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

const PENDING_STORAGE_KEY = "dnos:pending-long-tasks";

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
    return JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY) || "[]");
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
    const { data } = await supabase
      .from("conversations")
      .select("id, content, created_at, media")
      .eq("agent_id", t.agentId)
      .eq("user_id", t.userId)
      .eq("role", "agent")
      .gt("created_at", t.sinceTimestamp)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0 && data[0].content) {
      removePendingTask(t.agentId, t.userId);
      emitUpdate(t.agentId, conversationRowToMessage(data[0], t.agentId));
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

    // Tracks streamed text so we can preserve it on timeout/abort
    const accumulatedRef = { current: "" };

    // Instrumentação (Bloco 2): mede a decomposição do tempo do turno (pré-voo →
    // 1º token → total) para diagnosticar os 7-20s. Só console, fire-and-forget,
    // sem alterar comportamento.
    const timings = { t0: Date.now(), prevoo: 0, firstToken: 0 };

    let _userId: string | undefined;
    let _userMessageTimestamp = new Date().toISOString();


    // ── Slash command interception ──
    // Commands like /compact, /new, /reset must go to the command endpoint,
    // not the chat completions endpoint.
    const lastMsg = fullHistory[fullHistory.length - 1];
    const lastText = lastMsg?.role === "user" ? (lastMsg.content ?? "").trim() : "";
    if (lastText.startsWith("/")) {
      const resetCmd = isResetCommand(lastText);

      // ── Reset (/new, /reset): 100% client-side, sem tocar no gateway ──
      // Antes isso ia como mensagem de chat pro gateway e NÃO resetava nada (só
      // voltava uma resposta do modelo — o /new "mentia"). Agora incrementamos a
      // geração da sessão: a próxima mensagem usa uma chave nova e o gateway abre
      // uma sessão zerada. A sessão antiga fica inerte. Não apaga memória nem
      // identidade do agente — é o mesmo agente, só a conversa recomeça.
      if (resetCmd) {
        const canonicalAgentId = toCanonicalAgentId(agentId);
        const gen = bumpSessionGen(canonicalAgentId);
        console.log(`[chat-sender] Reset ${lastText} — geração da sessão de ${canonicalAgentId} agora é g${gen}`);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const userId = session?.user?.id;
          toast("Nova sessão iniciada", {
            icon: createElement(RefreshCw, { className: "h-4 w-4" }),
          });
          const cmdMsg: ChatMessage = {
            id: `m${Date.now()}reset`,
            agentId,
            channel: "dm",
            role: "agent",
            content: "Nova sessão iniciada. Contexto anterior arquivado — recomeçamos do zero.",
            timestamp: new Date().toISOString(),
          };
          // Emitir a mensagem PERSISTIDA (com id do banco), não o cmdMsg local:
          // a subscription realtime de conversas também renderiza a linha inserida,
          // e a UI deduplica por id. Emitir o cmdMsg (id diferente) duplicaria.
          let emittedReset = cmdMsg;
          if (userId) {
            try {
              emittedReset = await appendToConversations(userId, agentId, cmdMsg);
            } catch (e) {
              console.warn("[chat-sender] persist reset reply failed:", e);
            }
          }
          emitStream(agentId, "");
          emitUpdate(agentId, emittedReset);
        } finally {
          pendingAgents.delete(agentId);
          activeAgentRequests.delete(agentId);
          emitPending();
        }
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        console.log("[chat-sender] Slash command detected — routing via gateway-chat", {
          agentId: toCanonicalAgentId(agentId),
          text: lastText,
          resetCmd,
        });

        let replyText: string;
        try {
          replyText = await runSlashCommandViaEdge(agentId, lastText, controller.signal);
        } catch (innerErr) {
          // Reset commands intentionally tear the session down on the gateway,
          // which frequently aborts the in-flight request. Treat abort-like
          // errors as success — the reset already happened server-side.
          if (resetCmd && isAbortLikeError(innerErr)) {
            replyText = "Nova sessão iniciada.";
          } else {
            throw innerErr;
          }
        }

        // For /new and /reset, normalize gateway "Comando falhou" into a
        // clean success — the reset routinely closes the connection before
        // the ack lands, but the session on the gateway is already fresh.
        if (resetCmd) {
          if (typeof replyText === "string" && replyText.includes("Comando falhou")) {
            replyText = "Nova sessão iniciada.";
          }
          toast("Nova sessão iniciada", {
            icon: createElement(RefreshCw, { className: "h-4 w-4" }),
          });
        } else {
          // Catch-all for any other slash command (e.g. /compact).
          // Success → confirmation toast. Unknown/failed → warning toast.
          const failed =
            typeof replyText === "string" &&
            (/comando falhou/i.test(replyText) ||
              /unknown command|not recognized|não reconhecido|não encontrado/i.test(replyText));
          if (failed) {
            toast(`Comando não reconhecido: ${lastText}`, {
              icon: createElement(AlertCircle, { className: "h-4 w-4" }),
            });
          } else {
            toast("Comando executado", {
              icon: createElement(Check, { className: "h-4 w-4" }),
            });
          }
        }

        const cmdMsg: ChatMessage = {
          id: `m${Date.now()}cmd`,
          agentId,
          channel: "dm",
          role: "agent",
          content: replyText,
          timestamp: new Date().toISOString(),
        };
        if (userId) {
          await appendToConversations(userId, agentId, cmdMsg).catch((e) =>
            console.warn("[chat-sender] persist slash reply failed:", e)
          );
        }
        emitStream(agentId, "");
        emitUpdate(agentId, cmdMsg);
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          console.error("[chat-sender] Slash command error:", err);
          const errMsg: ChatMessage = {
            id: `m${Date.now()}cmderr`,
            agentId,
            channel: "dm",
            role: "agent",
            content: `Erro ao executar comando: ${err?.message ?? String(err)}`,
            timestamp: new Date().toISOString(),
          };
          emitStream(agentId, "");
          emitUpdate(agentId, errMsg);
        }
      } finally {
        pendingAgents.delete(agentId);
        activeAgentRequests.delete(agentId);
        emitPending();
      }
      return;
    }

    let _retryChatMessages: any[] = [];
    let _retryModelId = "";
    let _retrySessionUser: string | undefined;
    let _retryModelOverride: string | undefined;
    try {
      const modelId = getModelForAgent(agentId);
      _retryModelId = modelId;
      const timeoutMs = 180_000;

      const limited = limitHistory(fullHistory);
      const chatMessages = await toChatMessages(limited, agentId);
      timings.prevoo = Date.now();
      _retryChatMessages = chatMessages;

      // Include authenticated user ID in the request body
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      _userId = userId;

      // Register a "normal" pending task so the placeholder survives a refresh.
      // It's removed in the finally block or upgraded to a "long" task on timeout.
      if (userId) {
        addPendingTask({
          kind: "normal",
          agentId,
          userId,
          sinceTimestamp: _userMessageTimestamp,
          startedAt: Date.now(),
        });
      }

      // ── Prepare file references (signed URLs) for agent ──
      const lastUserMsg = fullHistory[fullHistory.length - 1];
      if (lastUserMsg?.role === "user" && lastUserMsg.media?.length) {
        const fileAttachments = lastUserMsg.media.filter((m) => m.type === "file");
        if (fileAttachments.length > 0) {
          const preparedFiles = (
            await Promise.all(fileAttachments.map((attachment) => prepareFileAttachmentForAgent(attachment)))
          ).filter((attachment): attachment is PreparedFileAttachment => Boolean(attachment));

          if (chatMessages.length > 0 && preparedFiles.length > 0) {
            const lastChat = chatMessages[chatMessages.length - 1];
            const textBlocks = preparedFiles.flatMap((file) => (file.promptText ? [file.promptText] : []));

            if (lastChat.role === "user" && textBlocks.length > 0) {
              if (typeof lastChat.content === "string") {
                lastChat.content = [lastChat.content, ...textBlocks].filter(Boolean).join("\n\n---\n\n");
              } else if (Array.isArray(lastChat.content)) {
                lastChat.content.push(...textBlocks.map((text) => ({ type: "text", text })));
              }
            }
          }
        }
      }

      const sessionUser = userId ? buildSessionUser(userId, toCanonicalAgentId(agentId)) : undefined;
      _retrySessionUser = sessionUser;
      // Override de LLM da conversa. Vai nos DOIS caminhos de envio (streaming
      // aqui e fallback dm-agent-reply abaixo) — se só um mandasse, um turno
      // longo cairia no fallback e seria respondido por um modelo diferente do
      // escolhido, sem nada na tela indicando.
      const modelOverride = getModelOverride(toCanonicalAgentId(agentId)) ?? undefined;
      _retryModelOverride = modelOverride;
      // O agente não tem como SENTIR em qual LLM roda: perguntado, ele
      // consulta a config da sessão (o padrão) e responde errado — caso real
      // de 01/08, GPT-5-mini afirmando "estou usando deepseek-v4-flash".
      // Com override ativo, o turno leva a verdade junto. No FIM das
      // mensagens, de propósito: mexer no prefixo estouraria o cache.
      if (modelOverride && chatMessages.length > 0) {
        chatMessages.push({
          role: "system",
          content: `[dn.os] Este turno está sendo executado no modelo ${modelOverride}, escolhido pelo usuário no seletor da conversa (sobrepõe o padrão da sessão). Se perguntarem qual modelo/LLM você está usando, a resposta correta é: ${modelOverride}.`,
        });
      }
      const body = {
        model: modelId,
        messages: chatMessages,
        ...(userId && { userId }),
        ...(sessionUser && { sessionUser }),
        ...(modelOverride && { modelOverride }),
      };

      // Fire background Edge Function with keepalive so the request survives tab close
      const userMessageTimestamp = _userMessageTimestamp;
      if (userId) {
        try {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          fetch(`${supabaseUrl}/functions/v1/dm-agent-reply`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session?.access_token || anonKey}`,
              apikey: anonKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agentId,
              userId,
              messages: chatMessages,
              model: modelId,
              userMessageTimestamp,
              ...(sessionUser && { sessionUser }),
              ...(modelOverride && { modelOverride }),
            }),
            keepalive: true,
          }).catch((err) => {
            // Non-critical: the local streaming path is the primary UX
            console.warn("[chat-sender] Background dm-agent-reply fire-and-forget failed:", err.message);
          });
        } catch (e) {
          console.warn("[chat-sender] Failed to dispatch background edge function:", e);
        }
      }

      // Emit working indicator immediately
      emitStream(agentId, "[working]");

      const MAX_OVERLOAD_RETRIES = 2;
      const OVERLOAD_RETRY_DELAY = 3000;

      let reply: ExtractedReply | undefined;

      for (let overloadAttempt = 0; overloadAttempt <= MAX_OVERLOAD_RETRIES; overloadAttempt++) {
        reply = undefined;

        // Try streaming via edge function
        try {
          reply = await streamFromEdgeFunction(
            body,
            agentId,
            controller,
            timeoutMs,
            accumulatedRef,
            () => { if (!timings.firstToken) timings.firstToken = Date.now(); },
          );
        } catch (streamErr: any) {
          // A3 (flag): erro DEFINITIVO do gateway → mostra o motivo na hora e
          // encerra. Não faz fallback sync nem poll de 15 min ("trabalhando…").
          if (isStructuredErrorsEnabled() && streamErr?.gatewayError) {
            console.warn("[chat-sender] Erro definitivo do gateway:", streamErr.message);
            reply = { text: `⚠️ Falhou: ${streamErr.message}` };
            break;
          }
          // Fallback to sync via edge function
          console.warn("[chat-sender] Stream failed, falling back to sync:", streamErr.message);
          emitStream(agentId, "");

          const doFetch = async (reqBody: any): Promise<string> => {
            const { data: { session } } = await supabase.auth.getSession();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
            const url = `${supabaseUrl}/functions/v1/gateway-chat`;

            console.log('[chat-sender] Fallback chamando edge function proxy');
            const res = await fetch(url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session?.access_token || anonKey}`,
                apikey: anonKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(reqBody),
              signal: controller.signal,
            });
            if (!res.ok) {
              const errText = await res.text().catch(() => "");
              console.error('[chat-sender] Fallback erro:', res.status, errText);
              throw new Error(`Erro ${res.status}: ${errText}`);
            }
            return await res.text();
          };

          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

          let lastErr: any;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const raw = await doFetch(body);
              reply = extractResponsesReply(JSON.parse(raw));
              break;
            } catch (err: any) {
              lastErr = err;
              const isTransient = err?.name === "AbortError" || err instanceof TypeError || /Failed to fetch/i.test(String(err?.message ?? ""));
              if (!isTransient) throw err;
              if (attempt < 2) await wait(1000 * (attempt + 1));
            }
          }

          if (!reply) {
            if (lastErr?.name === "AbortError") throw new Error(`Tempo limite (${Math.round(timeoutMs / 1000)}s). Tente uma mensagem menor.`);
            throw new Error("Falha de conexão com o gateway. Verifique sua internet e tente novamente.");
          }
        }

        // Auto-reset on context overflow returned as a normal reply
        if (!isOverflowFalsePositiveFixEnabled() && reply && isContextOverflowError(reply.text) && !contextResetInFlight.has(agentId)) {
          console.warn("[chat-sender] Context overflow detected in reply — auto-resetting session", { agentId });
          contextResetInFlight.add(agentId);
          try {
            toast("♻️ Sessão renovada automaticamente. Continuando...", {
              description: `Limite de contexto atingido em ${agentId}. Reenviando sua mensagem.`,
              duration: 4000,
            });
            await resetAgentSession(agentId);
            emitStream(agentId, "");
            sendMessageInBackground(agentId, fullHistory.slice(-6));
          } finally {
            setTimeout(() => contextResetInFlight.delete(agentId), 2000);
          }
          return;
        }

        if (!isOverflowFalsePositiveFixEnabled() && reply && isGatewayOverloadError(reply.text)) {
          console.warn(`[chat-sender] Gateway overload detected (attempt ${overloadAttempt + 1}/${MAX_OVERLOAD_RETRIES + 1})`);
          if (overloadAttempt < MAX_OVERLOAD_RETRIES) {
            emitStream(agentId, "[retrying]");
            await new Promise((r) => setTimeout(r, OVERLOAD_RETRY_DELAY * (overloadAttempt + 1)));
            emitStream(agentId, "");
            continue;
          }
          // All retries exhausted — persist as error message so it survives reloads.
          const errorMsg: ChatMessage = {
            id: `m${Date.now()}oe`,
            agentId,
            role: "agent",
            content: "[error] O serviço está temporariamente sobrecarregado. Tente novamente em alguns instantes.",
            timestamp: new Date().toISOString(),
            channel: "web",
            isError: true,
          };
          const { data: { session: oeSession } } = await supabase.auth.getSession();
          const oeUserId = oeSession?.user?.id;
          let emittedOverloadError = errorMsg;
          if (oeUserId) {
            try {
              emittedOverloadError = await appendToConversations(oeUserId, agentId, errorMsg);
              emittedOverloadError = { ...emittedOverloadError, isError: true };
            } catch (persistErr) {
              console.warn("[chat-sender] Failed to persist overload error:", persistErr);
            }
          }
          emitUpdate(agentId, emittedOverloadError);
          return;
        }

        // Valid reply — break out of overload retry loop
        break;
      }

      // Reject empty/placeholder replies — route through extended polling
      // so the user sees "ainda estou trabalhando…" instead of a fake bubble.
      if (isEmptyReply(reply)) {
        console.warn("[chat-sender] Empty/placeholder reply detected — switching to extended polling");
        throw new Error("STREAM_EMPTY");
      }

      // Multi-message support: split the reply by MSG_BREAK_TOKEN. If the
      // agent (or gateway) signalled multiple messages, each becomes its
      // own bubble persisted as a separate row.
      const replyParts = splitIntoMessages(reply!.text);
      const baseTs = Date.now();

      const { data: { session: persistSession } } = await supabase.auth.getSession();
      const senderId = persistSession?.user?.id;

      // Background-reply dedup: if the edge function already persisted
      // anything for this turn, trust it and skip the client-side insert.
      let bgAlreadyPersisted = false;
      if (senderId) {
        const { data: bgReply } = await supabase
          .from("conversations")
          .select("id, content, created_at")
          .eq("agent_id", agentId)
          .eq("user_id", senderId)
          .eq("role", "agent")
          .gt("created_at", userMessageTimestamp)
          .order("created_at", { ascending: true });

        if (bgReply && bgReply.length > 0) {
          console.log(`[chat-sender] Background reply already persisted (${bgReply.length} msg), using it`);
          for (const row of bgReply) {
            emitUpdate(agentId, conversationRowToMessage(row, agentId));
          }
          bgAlreadyPersisted = true;
        }
      }

      if (!bgAlreadyPersisted) {
        for (let i = 0; i < replyParts.length; i++) {
          const partText = replyParts[i];
          // Sequential timestamps preserve order in the UI
          const partTs = new Date(baseTs + i).toISOString();
          const partMsg: ChatMessage = {
            id: `stream-${agentId}-${userMessageTimestamp}-${i}`,
            agentId,
            role: "agent",
            content: partText,
            timestamp: partTs,
            channel: "web",
            // Only attach media to the last bubble to avoid duplicates
            media: i === replyParts.length - 1 ? reply!.media : undefined,
          };

          let emittedPart = partMsg;
          if (senderId) {
            try {
              emittedPart = await appendToConversations(senderId, agentId, partMsg);
            } catch (persistErr) {
              console.warn(`[chat-sender] Failed to persist part ${i + 1}/${replyParts.length}:`, persistErr);
            }
          }
          emitUpdate(agentId, emittedPart);
        }
      }

      // Notify if user is not viewing this agent (badge only — toast/sound handled by use-notifications)
      if (!isSameAgentId(_activeAgentId, agentId)) {
        markAgentUnread(agentId);
      }

      // Mark agent as active in react-query cache immediately
      emitAgentActive(agentId);
    } catch (err: any) {
      const isManualStop = manuallyStoppedRequestIds.has(requestId)
        || controller.signal.reason === STOP_REASON;
      if (isManualStop) {
        manuallyStoppedRequestIds.delete(requestId);
        return;
      }

      const errMessage = String(err?.message ?? "");


      // ── Auto-reset on context overflow ──
      if (isContextOverflowError(errMessage) && !contextResetInFlight.has(agentId)) {
        console.warn("[chat-sender] Context overflow detected — auto-resetting session", { agentId });
        contextResetInFlight.add(agentId);
        try {
          toast("♻️ Sessão renovada automaticamente. Continuando...", {
            description: `Limite de contexto atingido em ${agentId}. Reenviando sua mensagem.`,
            duration: 4000,
          });
          await resetAgentSession(agentId);
          // Trim history aggressively for the retry to avoid the same overflow
          const trimmed = fullHistory.slice(-6);
          emitStream(agentId, "");
          // Re-dispatch with trimmed history; the user's last message is preserved
          sendMessageInBackground(agentId, trimmed);
        } finally {
          // Clear flag shortly after — the new run owns its own pending state
          setTimeout(() => contextResetInFlight.delete(agentId), 2000);
        }
        return;
      }

      // If streaming timed out / failed connection / returned empty, fall back
      // to extended polling. We never persist a [error] bubble — the gateway
      // often delivers the answer minutes later as an inter-session message,
      // and a red error bubble would mislead the user. The UI shows a live
      // "ainda estou trabalhando…" placeholder instead.
      const isBackgroundable =
        /tempo limite|timeout|aborted|stream_empty|stream-timeout|service_unavailable|falha de conex|failed to fetch|networkerror|load failed/i.test(errMessage)
        || err?.name === "AbortError"
        || controller.signal.reason === "stream-timeout";

      if (isBackgroundable && _userId) {
        console.log("[chat-sender] Stream unavailable, switching to extended background poll...", { reason: errMessage });
        const pollStart = Date.now();
        // Snapshot any partial streamed text so it's not lost
        const partialText = (accumulatedRef.current || "").trim();

        // Fresh controller for the extended poll — original was aborted by timeout
        const pollController = new AbortController();
        // Re-register so manual stop still cancels the poll
        activeAgentRequests.set(agentId, { controller: pollController, requestId });

        // Persist this long-task so it survives a page refresh.
        addPendingTask({
          kind: "long",
          agentId,
          userId: _userId,
          sinceTimestamp: _userMessageTimestamp,
          startedAt: pollStart,
        });

        // No text placeholder — the animated StreamingActivityIndicator
        // (shimmer + activity chips) + heartbeat panel already convey
        // "working" without a fake message bubble. Just make sure any
        // partial stream text is cleared so it doesn't stay frozen.
        emitStream(agentId, "");

        try {
          const bgMsg = await pollForBackgroundReply(agentId, _userId, _userMessageTimestamp, {
            timeoutMs: EXTENDED_POLL_TIME_MS,
            intervalMs: EXTENDED_POLL_INTERVAL_MS,
            signal: pollController.signal,
            emitHeartbeats: true,
          });
          if (bgMsg) {
            console.log("[chat-sender] Background reply found via extended polling");
            emitStream(agentId, "");
            emitHeartbeat(agentId, null, true);
            emitUpdate(agentId, bgMsg);
            if (!isSameAgentId(_activeAgentId, agentId)) markAgentUnread(agentId);
            emitAgentActive(agentId);
            return;
          }
          console.warn("[chat-sender] Extended polling exhausted (15 min). No reply.");

          // If we captured partial text, persist it so it doesn't disappear.
          if (partialText) {
            const partialMsg: ChatMessage = {
              id: `m${Date.now()}p`,
              agentId,
              role: "agent",
              content: `${partialText}\n\n_⌛ Resposta interrompida — o agente pode continuar processando em background._`,
              timestamp: new Date().toISOString(),
              channel: "web",
            };
            try {
              const persisted = await appendToConversations(_userId, agentId, partialMsg);
              emitStream(agentId, "");
              emitHeartbeat(agentId, null, true);
              emitUpdate(agentId, persisted);
              return;
            } catch (persistErr) {
              console.warn("[chat-sender] Failed to persist partial reply:", persistErr);
            }
          }

          emitStream(
            agentId,
            "⌛ O agente não respondeu nos últimos 15 minutos. Sua próxima mensagem reabre a conversa.",
          );
          emitHeartbeat(agentId, null, true);
          setTimeout(() => emitStream(agentId, ""), 8_000);
          return;
        } finally {
          if (_userId) removePendingTask(agentId, _userId);
        }
      }




      console.error('[chat-sender] Erro final detalhado:', err.message, err.status, err.response, err.stack);
      // Do NOT persist a red [error] bubble — show a transient inline warning
      // and let the user retry. Persisted errors used to "stick" in the DM
      // even after the agent eventually delivered the real answer.
      emitStream(
        agentId,
        `⚠️ Não consegui concluir agora: ${err.message || "erro inesperado"}.\n_Retentando automaticamente em 5s…_`,
      );

      // Auto-retry once via the background edge function. The edge function
      // performs its own duplicate-check (skips insert if an agent reply was
      // already persisted after the user's message), so this is safe.
      if (_userId) {
        setTimeout(async () => {
          try {
            const { data: existing } = await supabase
              .from("conversations")
              .select("id")
              .eq("agent_id", agentId)
              .eq("user_id", _userId)
              .eq("role", "agent")
              .gt("created_at", _userMessageTimestamp)
              .limit(1);
            if (existing && existing.length > 0) {
              emitStream(agentId, "");
              return;
            }
            const { data: { session: retrySession } } = await supabase.auth.getSession();
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
            const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
            console.log("[chat-sender] Auto-retry: re-invoking dm-agent-reply");
            emitStream(agentId, "🔄 Reentrando em contato com o agente…");
            await fetch(`${supabaseUrl}/functions/v1/dm-agent-reply`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${retrySession?.access_token || anonKey}`,
                apikey: anonKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                agentId,
                userId: _userId,
                messages: _retryChatMessages,
                model: _retryModelId,
                userMessageTimestamp: _userMessageTimestamp,
                ...(_retrySessionUser && { sessionUser: _retrySessionUser }),
                // O retry também precisa do override — senão a re-tentativa de
                // um turno escolhido em Claude voltaria no modelo padrão.
                ...(_retryModelOverride && { modelOverride: _retryModelOverride }),
              }),
              keepalive: true,
            });
            setTimeout(() => emitStream(agentId, ""), 6_000);
          } catch (retryErr) {
            console.warn("[chat-sender] Auto-retry failed:", retryErr);
            emitStream(agentId, "⚠️ Não foi possível reconectar automaticamente. Reenvie a mensagem.");
            setTimeout(() => emitStream(agentId, ""), 8_000);
          }
        }, 5_000);
      } else {
        setTimeout(() => emitStream(agentId, ""), 8_000);
      }
    } finally {
      // Instrumentação (Bloco 2): decomposição do tempo do turno.
      // pré-voo = montar o payload no cliente; 1º token = até a 1ª palavra do
      // agente (prefill+reasoning+rede); total = fim. "—" = caiu no fallback sync.
      const prevooMs = timings.prevoo ? timings.prevoo - timings.t0 : 0;
      const ttftMs = timings.firstToken ? timings.firstToken - timings.t0 : 0;
      const totalMs = Date.now() - timings.t0;
      console.info(
        `[timing] ${agentId} | pré-voo ${prevooMs}ms | 1º token ${ttftMs || "—"}ms | total ${totalMs}ms`,
      );

      const activeRequest = activeAgentRequests.get(agentId);
      if (activeRequest?.requestId === requestId) {
        activeAgentRequests.delete(agentId);
      }
      manuallyStoppedRequestIds.delete(requestId);
      pendingAgents.delete(agentId);
      if (_userId) removePendingTask(agentId, _userId);
      emitPending();
    }
  };

  run();
}
