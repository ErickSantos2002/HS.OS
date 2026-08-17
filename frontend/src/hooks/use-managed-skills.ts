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

/**
 * De onde a skill vem — e, por consequência, o que a tela pode oferecer.
 *
 * ⚠️ Só `plataforma` tem linha em `public.skills`. As outras vêm do gateway e
 * **não têm CRUD**: oferecer editar ou excluir nelas produz 404.
 */
export type SkillOrigem = "plataforma" | "repositorio" | "vps" | "openclaw";

export interface ManagedSkill {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  content: string;
  /** `plataforma`: o que a tela criou. O resto vem do gateway. */
  origem: SkillOrigem;
  somente_leitura: boolean;
  /** Emoji do frontmatter, quando a skill vem do gateway. */
  emoji?: string | null;
  /** Caminho do `SKILL.md` na VPS — é o que se mostra no lugar de "editar". */
  arquivo?: string | null;
  source: SkillSource;
  source_url: string | null;
  version: string;
  is_default: boolean;
  sync_status: SkillSyncStatus;
  created_at: string;
  updated_at: string;
  agent_skills: ManagedSkillAgentLink[];
}

/** O que o gateway respondeu ao instalar a skill num agente. */
export interface SyncResult {
  ok: boolean;
  error?: string;
  note?: string;
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
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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

  /**
   * Liga ou desliga a skill de um agente, devolvendo o que o gateway
   * respondeu de fato.
   *
   * O retorno importa: a tela relata o RESULTADO da instalação, não o
   * clique — já aconteceu de a skill constar no painel e não existir no
   * lugar que o agente consulta. Antes disso vir na resposta, a
   * `SkillsPage` relia a `agent_skills` no Supabase logo depois de chamar,
   * só para descobrir o `sync_status`. Agora vem junto.
   */
  const assign = useCallback(async (skill_id: string, agent_id: string, remove = false) => {
    if (remove) {
      await chamar("DELETE", `/skills/${skill_id}/agentes/${agent_id}`);
      await refetch();
      notifySkillsChanged();
      return null;
    }
    const r = await chamar<{ sync: Record<string, SyncResult> }>(
      "POST", `/skills/${skill_id}/agentes`, { agent_ids: [agent_id] },
    );
    await refetch();
    notifySkillsChanged();
    return r.sync?.[agent_id] ?? null;
  }, [refetch]);

  const retry = useCallback(
    (skill_id: string, agent_id: string) => assign(skill_id, agent_id, false),
    [assign],
  );

  const remove = useCallback(async (skill_id: string) => {
    await chamar("DELETE", `/skills/${skill_id}`);
    await refetch();
    notifySkillsChanged();
  }, [refetch]);

  /**
   * O markdown inteiro da skill.
   *
   * ⚠️ Só existe para as do **repositório**. O gateway não tem método de
   * leitura (`skills.read`/`get`/`show`/`content` não existem) e o leitor de
   * workspace recusa o caminho — então as embutidas do OpenClaw não têm
   * conteúdo recuperável e o backend responde 404 explicando.
   */
  const lerConteudo = useCallback(
    (slug: string) => chamar<{ slug: string; arquivo: string; conteudo: string }>(
      "GET", `/skills/${encodeURIComponent(slug)}/conteudo`,
    ),
    [],
  );

  /**
   * Quais agentes podem usar a skill. Lista vazia desativa para todos.
   *
   * ⚠️ Mande sempre a lista **completa** de quem pode: o backend converte isso
   * para a allowlist por agente do gateway, onde lista explícita substitui tudo.
   */
  const definirAgentes = useCallback(
    async (slug: string, agentIds: string[]) => {
      const r = await chamar<{ ok: boolean; restritos: string[] }>(
        "PUT", `/skills/${encodeURIComponent(slug)}/agentes`, { agent_ids: agentIds },
      );
      await refetch();
      return r;
    },
    [refetch],
  );

  return { skills, loading, error, refetch, create, update, assign, retry, remove,
           lerConteudo, definirAgentes };
}
