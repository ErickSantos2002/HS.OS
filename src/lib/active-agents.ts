/**
 * Agent utilities used across dn.os.
 *
 * The list of official agents, display names, colors, emoji and sort order
 * come from `@/lib/agent-catalog` (backed by `agent_profiles` at runtime).
 * This file only re-exports those helpers plus a few id-normalization
 * utilities that don't depend on the catalog.
 */

export {
  getOfficialAgentIds,
  isOfficialAgentId,
  getAgentDisplayNameById,
  getAgentColor,
  getAgentEmoji,
  getAgentEntry,
  getAgentSortOrder,
  getLeaderAgentId,
  getLeaderAgentEntry,
  getOfficialAgentEntries,
} from "@/lib/agent-catalog";

export function isManagedAgentRecord(raw: { id?: string | null; model?: string | null }): boolean {
  const id = String(raw.id ?? "").toLowerCase();
  const model = String(raw.model ?? "").toLowerCase();
  return id.startsWith("openclaw:") || model.startsWith("openclaw:");
}

export function normalizeAgentId(agentId: string): string {
  return agentId.trim().toLowerCase().replace(/^openclaw:/, "");
}

export function getModelForAgent(agentId: string): string {
  return `openclaw:${normalizeAgentId(agentId)}`;
}

export function isLikelyAgentId(userId: string): boolean {
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
}
