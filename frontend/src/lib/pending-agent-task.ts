// Store + helpers for pending long-running agent tasks (Loop Architecture).
// Populated by the ChatPage banner hook on session open; consumed by the
// chat-sender to inject a system-level reminder for the agent to resume.

import type { AgentTask } from "@/hooks/use-agent-tasks";

const store = new Map<string, AgentTask>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

export function setPendingAgentTask(agentId: string, task: AgentTask | null) {
  if (!agentId) return;
  const prev = store.get(agentId) ?? null;
  if (!task) {
    if (!prev) return;
    store.delete(agentId);
    notify();
    return;
  }
  if (prev && prev.id === task.id && prev.status === task.status) return;
  store.set(agentId, task);
  notify();
}

export function getPendingAgentTask(agentId: string): AgentTask | null {
  if (!agentId) return null;
  return store.get(agentId) ?? null;
}

export function clearPendingAgentTask(agentId: string) {
  setPendingAgentTask(agentId, null);
}

export function subscribePendingAgentTask(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Campos já exibidos por nome próprio (notes/currentChunk) ou verbosos demais
// para o prompt (progress é um array grande, mostrado à parte).
const CHECKPOINT_PROMPT_OMIT = new Set(["notes", "currentChunk", "lastChunkDone", "progress"]);
const CHECKPOINT_EXTRA_CAP = 1500; // por campo, para não estourar o prompt

/**
 * Correção B5 (checkpoint raso): o backend do agent-task já aceita e MESCLA
 * qualquer campo extra que o agente escreva em checkpoint_data (artifacts,
 * file_path, decisions, next_action, ...) — mas o resume prompt só exibia
 * `notes` e `currentChunk`, descartando em silêncio tudo o mais que já estava
 * salvo. Sem mudança de backend/schema: só passa a mostrar o que já existe.
 */
export function buildPendingTaskSystemPrompt(task: AgentTask): string {
  // O tipo declarado de checkpoint_data é estreito, mas o backend (agent-task
  // action=checkpoint) já mescla qualquer campo extra que o agente escreva —
  // o dado real em runtime pode ter mais chaves do que o tipo declara.
  const data = (task.checkpoint_data ?? {}) as Record<string, any>;
  const notes = String(data.notes ?? "").trim() || "sem notas";
  const chunk = data.currentChunk ?? "n/d";

  const lines = [
    `[HS.OS] Task pendente encontrada: "${task.title}" (ID: ${task.id}).`,
    `Status atual: ${task.status}. Chunk atual: ${chunk}.`,
    `Checkpoint: ${notes}`,
  ];

  const extraKeys = Object.keys(data).filter(
    (k) => !CHECKPOINT_PROMPT_OMIT.has(k) && data[k] !== undefined && data[k] !== null && data[k] !== "",
  );
  if (extraKeys.length > 0) {
    lines.push("Dados salvos no checkpoint (não refaça o que já está aqui):");
    for (const key of extraKeys) {
      const raw = typeof data[key] === "string" ? data[key] : JSON.stringify(data[key]);
      const value = raw.length > CHECKPOINT_EXTRA_CAP ? `${raw.slice(0, CHECKPOINT_EXTRA_CAP)}…` : raw;
      lines.push(`- ${key}: ${value}`);
    }
  }
  if (Array.isArray(data.progress) && data.progress.length > 0) {
    lines.push(`Progresso já registrado: ${JSON.stringify(data.progress).slice(0, CHECKPOINT_EXTRA_CAP)}`);
  }

  lines.push(
    `Antes de qualquer outra coisa, retome a task chamando agent-task com action="resume" e task_id="${task.id}". Depois execute o próximo chunk e faça checkpoint/complete conforme o protocolo Loop Architecture.`,
  );
  return lines.join("\n");
}
