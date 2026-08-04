/**
 * Runtime catalog of official/super agents.
 *
 * Backed by the `agent_profiles` table (`is_official = true`), loaded once
 * after the user authenticates and refreshed via realtime + React Query.
 * All accessors are SYNCHRONOUS so legacy call sites don't need to change;
 * before the first load resolves, they return safe empty/derived defaults.
 *
 * The list of official agents is NEVER hardcoded — this module is the single
 * source of truth. Runtime code that needs the leader agent should call
 * `getLeaderAgentId()` (or filter by `is_leader` on the entry object).
 */

export interface AgentCatalogEntry {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  isLeader: boolean;
  sortOrder: number | null;
}

type CatalogListener = (entries: AgentCatalogEntry[]) => void;

let CATALOG: AgentCatalogEntry[] = [];
let CATALOG_MAP: Map<string, AgentCatalogEntry> = new Map();
let LOADED_AT = 0;
const LISTENERS = new Set<CatalogListener>();

function normalize(id: string): string {
  return id.trim().toLowerCase().replace(/^openclaw:/, "");
}

function formatId(agentId: string): string {
  return agentId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function sortEntries(list: AgentCatalogEntry[]): AgentCatalogEntry[] {
  return [...list].sort((a, b) => {
    const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return (a.name || a.id).localeCompare(b.name || b.id, "pt-BR");
  });
}

export function setAgentCatalog(entries: AgentCatalogEntry[]): void {
  CATALOG = sortEntries(entries.map((e) => ({ ...e, id: normalize(e.id) })));
  CATALOG_MAP = new Map(CATALOG.map((e) => [e.id, e]));
  LOADED_AT = Date.now();
  LISTENERS.forEach((fn) => {
    try { fn(CATALOG); } catch { /* ignore listener errors */ }
  });
}

export function subscribeAgentCatalog(fn: CatalogListener): () => void {
  LISTENERS.add(fn);
  return () => LISTENERS.delete(fn);
}

export function isAgentCatalogLoaded(): boolean {
  return LOADED_AT > 0;
}

/* ── Sync accessors ─────────────────────────────────── */

export function getOfficialAgentEntries(): AgentCatalogEntry[] {
  return CATALOG;
}

export function getOfficialAgentIds(): string[] {
  return CATALOG.map((e) => e.id);
}

export function isOfficialAgentId(agentId: string): boolean {
  return CATALOG_MAP.has(normalize(agentId));
}

export function getAgentEntry(agentId: string): AgentCatalogEntry | null {
  return CATALOG_MAP.get(normalize(agentId)) ?? null;
}

export function getAgentDisplayNameById(agentId: string, fallbackName?: string | null): string {
  const entry = CATALOG_MAP.get(normalize(agentId));
  if (entry?.name) return entry.name;
  const fb = fallbackName?.trim();
  if (fb) return fb;
  return formatId(normalize(agentId) || agentId);
}

export function getAgentColor(agentId: string, fallback = "#64748b"): string {
  return CATALOG_MAP.get(normalize(agentId))?.color || fallback;
}

export function getAgentEmoji(agentId: string, fallback = "🤖"): string {
  return CATALOG_MAP.get(normalize(agentId))?.emoji || fallback;
}

export function getAgentSortOrder(agentId: string): number | null {
  return CATALOG_MAP.get(normalize(agentId))?.sortOrder ?? null;
}

export function getLeaderAgentId(): string | null {
  return CATALOG.find((e) => e.isLeader)?.id ?? null;
}

export function getLeaderAgentEntry(): AgentCatalogEntry | null {
  return CATALOG.find((e) => e.isLeader) ?? null;
}
