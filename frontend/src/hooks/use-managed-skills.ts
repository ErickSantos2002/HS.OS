import { assinarTabela } from "@/lib/realtime";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

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

/**
 * Chama a API própria e mantém o contrato de erro que a tela já esperava.
 *
 * A edge recebia tudo num POST com `{action}`; aqui cada ação é uma rota. A
 * tradução ficou neste ponto único de propósito — o resto do hook e a
 * `SkillsPage` continuam falando em `create`/`assign`/`remove`.
 *
 * O `GatewayNotConfiguredError` sobrevive porque a tela desenha um estado
 * vazio com ele, não um erro vermelho: numa instalação nova, sem gateway
 * configurado, não ter skills é o normal, não é falha.
 */
async function chamar<T = any>(
  metodo: "GET" | "POST" | "PATCH" | "DELETE",
  rota: string,
  corpo?: unknown,
): Promise<T> {
  try {
    return await api<T>(rota, { method: metodo, body: corpo });
  } catch (e: any) {
    if (isGatewayNotConfigured(e?.message) || isGatewayNotConfigured(e)) {
      throw new GatewayNotConfiguredError();
    }
    throw e;
  }
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
      const data = await chamar<ManagedSkill[]>("GET", "/skills");
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
    const result = await chamar<SkillCreateResult>("POST", "/skills", payload);
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
    const { skill_id, ...campos } = payload;
    await chamar("PATCH", `/skills/${skill_id}`, campos);
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  const assign = useCallback(async (skill_id: string, agent_id: string, remove = false) => {
    if (remove) await chamar("DELETE", `/skills/${skill_id}/agentes/${agent_id}`);
    else await chamar("POST", `/skills/${skill_id}/agentes`, { agent_ids: [agent_id] });
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  const retry = useCallback(async (skill_id: string, agent_id: string) => {
    await chamar("POST", `/skills/${skill_id}/agentes`, { agent_ids: [agent_id] });
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  const remove = useCallback(async (skill_id: string) => {
    await chamar("DELETE", `/skills/${skill_id}`);
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  return { skills, loading, error, refetch, create, update, assign, retry, remove };
}
