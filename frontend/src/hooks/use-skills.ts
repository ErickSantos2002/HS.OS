import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface Skill {
  name: string;
  description: string;
  type: "built-in" | "custom";
  installable: boolean;
  platform: "linux" | "mac" | "any";
  requiresCredentials?: string;
  category?: string;
  /** Emoji que o próprio OpenClaw dá à skill. */
  emoji?: string;
  homepage?: string;
  /** O agente pode usar agora. Falso quando bloqueada ou faltando dependência. */
  eligible?: boolean;
  /** Por que está bloqueada, quando está. Null = liberada. */
  bloqueio?: string | null;
  /** Dependências que faltam na VPS (binário, credencial). */
  missing?: string[];
}

export interface AgentSkill {
  name: string;
  source: "SOUL.md" | "AGENTS.md";
}

/**
 * O catálogo real do OpenClaw, vindo de `GET /skills/catalogo`.
 *
 * ⚠️ **Isto substituiu uma lista inventada.** Até 10/08/2026 este arquivo
 * carregava 54 skills escritas à mão logo abaixo desta linha — `web-search`,
 * `pdf-read`, `docker-run`, `whatsapp-send` — como "fallback" para quando a
 * API do gateway não respondesse. E ela nunca respondia: o caminho era
 * `${url}/api/skills`, REST, que morreu junto com o resto da API HTTP do
 * OpenClaw. Ou seja, o fallback era o comportamento normal, e a tela mostrava
 * um catálogo que não correspondia a nada — nomes que não existem, e nenhuma
 * das que existem de verdade.
 *
 * O `skills.status` do gateway devolve 53 skills reais com metadados que a
 * lista inventada não tinha como ter: se o agente pode usar cada uma
 * (`eligible`), o que falta instalar (`missing`) e por que está bloqueada.
 *
 * Sem fallback agora, de propósito: erro visível é melhor do que catálogo
 * falso. Se o gateway cair, a tela diz que caiu.
 */
export function useSkills(agentId?: string | null) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ skills: any[] }>(
        agentId ? `/skills/catalogo?agent_id=${encodeURIComponent(agentId)}` : "/skills/catalogo",
      );
      setSkills(
        (r.skills ?? []).map((s) => ({
          name: s.name ?? "",
          description: s.description ?? "",
          type: s.type === "custom" ? "custom" : "built-in",
          // Tudo que o gateway lista já está instalado; o que varia é poder
          // usar. "installable" virou "utilizável" na prática.
          installable: s.eligible !== false,
          platform: (s.bloqueio === "plataforma incompatível" ? "linux" : "any") as Skill["platform"],
          requiresCredentials: s.missing?.length ? s.missing.join(", ") : undefined,
          category: s.source === "openclaw-bundled" ? "Nativas do OpenClaw" : "Instaladas na VPS",
          emoji: s.emoji ?? undefined,
          homepage: s.homepage ?? undefined,
          eligible: s.eligible !== false,
          bloqueio: s.bloqueio ?? null,
          missing: s.missing ?? [],
        })),
      );
    } catch (e: any) {
      setError(e?.message ?? "Falha ao carregar o catálogo de skills");
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  return { skills, loading, error, refetch: fetchSkills };
}

/**
 * As skills de UM agente: as do catálogo que ele pode usar de fato.
 *
 * O original lia `${url}/api/skills/{agentId}` e dizia de qual arquivo cada
 * uma vinha (`SOUL.md` ou `AGENTS.md`). O gateway não expõe mais essa
 * procedência — o `skills.status` responde por agente e diz se é elegível,
 * que é a pergunta que a tela realmente faz. `source` fica em `SOUL.md` para
 * não quebrar quem lê o campo.
 */
export function useAgentSkills(agentId: string | null) {
  const { skills, loading, error, refetch } = useSkills(agentId);
  const agentSkills: AgentSkill[] = skills
    .filter((s) => s.eligible)
    .map((s) => ({ name: s.name, source: "SOUL.md" as const }));
  return { agentSkills, loading: agentId ? loading : false, error, refetch };
}
