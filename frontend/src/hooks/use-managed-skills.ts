import { assinarTabela } from "@/lib/realtime";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SkillSource = "clawhub" | "git" | "manual" | "agent";
export type SkillSyncStatus = "pending" | "synced" | "error";
export type SkillInstalledBy = "user" | "agent" | "sync" | "default";

export interface ManagedSkillAgentLink {
  agent_id: string;
  installed_by: SkillInstalledBy;
  sync_status: SkillSyncStatus;
  sync_error?: string | null;
  agent: { name: string; avatar_url?: string | null };
}

export interface ManagedSkill {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  content: string;
  source: SkillSource;
  source_url: string | null;
  version: string;
  is_default: boolean;
  sync_status: SkillSyncStatus;
  created_at: string;
  updated_at: string;
  agent_skills: ManagedSkillAgentLink[];
}

export interface SkillCreateResult {
  skillId: string;
  sync: Record<string, { ok: boolean; error?: string; note?: string }>;
}

export class GatewayNotConfiguredError extends Error {
  constructor() {
    super("Gateway não configurado. Configure em Settings → Gateway.");
    this.name = "GatewayNotConfiguredError";
  }
}

function isGatewayNotConfigured(payload: unknown): boolean {
  if (typeof payload === "string") {
    const text = payload.toLowerCase();
    return text.includes("gateway_not_configured") || text.includes("gateway não configurado");
  }
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.code === "GATEWAY_NOT_CONFIGURED") return true;
  if (typeof p.error === "string" && p.error.toLowerCase().includes("gateway não configurado")) return true;
  if (typeof p.message === "string" && isGatewayNotConfigured(p.message)) return true;
  return false;
}

async function invoke<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("skill-manage", { body });

  // supabase-js surfaces non-2xx as `error` with the response body inside
  // `error.context`. Detect the expected 503 for un-configured installs and
  // rethrow as a typed error so callers can render an empty state instead
  // of a red toast.
  if (error) {
    let ctxBody: unknown = null;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") ctxBody = await ctx.json();
    } catch { /* ignore */ }
    if (isGatewayNotConfigured(ctxBody) || isGatewayNotConfigured(error)) throw new GatewayNotConfiguredError();
    // O corpo do erro é a única parte que diz O QUE falhou — "Edge Function
    // returned a non-2xx status code" não dá nada para agir. Se o servidor
    // mandou um motivo, é ele que sobe.
    const motivo = (ctxBody as { error?: string } | null)?.error;
    throw motivo ? new Error(motivo) : error;
  }

  if (isGatewayNotConfigured(data)) throw new GatewayNotConfiguredError();
  if (data && typeof data === "object" && "error" in (data as any)) {
    throw new Error((data as any).error);
  }
  return data as T;
}

const SKILLS_CHANGED_EVENT = "managed-skills-changed";
function notifySkillsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
  }
}

export function useManagedSkills() {
  const [skills, setSkills] = useState<ManagedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<ManagedSkill[]>({ action: "list" });
      setSkills(Array.isArray(data) ? data : []);
    } catch (e: any) {
      // Gateway not configured is an expected state on a fresh remix —
      // show the normal empty state instead of an error banner.
      if (e instanceof GatewayNotConfiguredError) {
        setSkills([]);
        setError(null);
      } else {
        setError(e?.message ?? "Falha ao carregar skills");
        setSkills([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime updates + cross-instance event bus
  useEffect(() => {
    const onChanged = () => { void refetch(); };
    window.addEventListener(SKILLS_CHANGED_EVENT, onChanged);
    const cancelarSkills = assinarTabela("skills", () => { void refetch(); });
    const cancelarVinculos = assinarTabela("agent_skills", () => { void refetch(); });
    return () => {
      window.removeEventListener(SKILLS_CHANGED_EVENT, onChanged);
      cancelarSkills();
      cancelarVinculos();
    };
  }, [refetch]);

  const create = useCallback(async (payload: {
    slug: string;
    name: string;
    description?: string;
    content: string;
    source: SkillSource;
    source_url?: string;
    is_default?: boolean;
    agent_ids?: string[];
  }) => {
    const result = await invoke<SkillCreateResult>({ action: "create", ...payload });
    await refetch();
    notifySkillsChanged();
    return result;
  }, [refetch]);

  const update = useCallback(async (payload: {
    skill_id: string;
    name?: string;
    description?: string;
    content?: string;
    is_default?: boolean;
  }) => {
    await invoke({ action: "update", ...payload });
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  const assign = useCallback(async (skill_id: string, agent_id: string, remove = false) => {
    await invoke({ action: "assign", skill_id, agent_id, remove });
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  const retry = useCallback(async (skill_id: string, agent_id: string) => {
    await invoke({ action: "assign", skill_id, agent_id, remove: false });
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  const remove = useCallback(async (skill_id: string) => {
    await invoke({ action: "delete", skill_id });
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  return { skills, loading, error, refetch, create, update, assign, retry, remove };
}
