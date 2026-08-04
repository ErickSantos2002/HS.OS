// Catálogo de status (presets) que o usuário pode ativar
// Compartilhado com agentes via cache em localStorage para o chat-sender
// injetar uma linha de contexto no system prompt.

export interface UserStatusPreset {
  id: string;
  emoji: string;
  label: string;
  description: string;
}

export const USER_STATUS_PRESETS: UserStatusPreset[] = [
  { id: "meeting",   emoji: "🗓️", label: "Em reunião",      description: "Reunião em andamento" },
  { id: "lunch",     emoji: "🍽️", label: "Almoço",          description: "Pausa para refeição" },
  { id: "away",      emoji: "🚶", label: "Ausente",         description: "Longe do computador" },
  { id: "focus",     emoji: "🎯", label: "Foco / DND",      description: "Trabalho profundo" },
  { id: "sick",      emoji: "🤒", label: "Doente",          description: "Dia de saúde" },
  { id: "vacation",  emoji: "🌴", label: "Férias / Folga",  description: "Fora por dia(s)" },
  { id: "traveling", emoji: "✈️", label: "Viajando",        description: "Em deslocamento" },
  { id: "home",      emoji: "🏠", label: "Home office",     description: "Trabalhando de casa" },
];

export function findPresetByLabel(label: string | null | undefined): UserStatusPreset | null {
  if (!label) return null;
  return USER_STATUS_PRESETS.find((p) => p.label === label) ?? null;
}

export interface ActiveStatus {
  label: string;
  emoji: string;
  setAt: string; // ISO
}

const SELF_STATUS_CACHE_KEY = "dnos:user-status:self";
const EXPIRY_ACK_PREFIX = "dnos:user-status:ack:";

export function getSelfStatusCache(): ActiveStatus | null {
  try {
    const raw = localStorage.getItem(SELF_STATUS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ActiveStatus) : null;
  } catch {
    return null;
  }
}

export function setSelfStatusCache(status: ActiveStatus | null) {
  try {
    if (status) localStorage.setItem(SELF_STATUS_CACHE_KEY, JSON.stringify(status));
    else localStorage.removeItem(SELF_STATUS_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** True if alert for this status (key = setAt) was already dismissed */
export function isExpiryAcked(setAt: string): boolean {
  try {
    return localStorage.getItem(EXPIRY_ACK_PREFIX + setAt) === "1";
  } catch {
    return false;
  }
}

export function ackExpiry(setAt: string) {
  try {
    localStorage.setItem(EXPIRY_ACK_PREFIX + setAt, "1");
  } catch {
    /* ignore */
  }
}

export function formatStatusAge(setAt: string | null | undefined): string {
  if (!setAt) return "";
  const ms = Date.now() - new Date(setAt).getTime();
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

export function formatStatusForAgentContext(status: ActiveStatus | null): string | null {
  if (!status) return null;
  const since = formatStatusAge(status.setAt);
  return `[Contexto: o usuário está com status "${status.emoji} ${status.label}" ${since}. Considere isso ao responder — ele pode demorar a retornar.]`;
}
