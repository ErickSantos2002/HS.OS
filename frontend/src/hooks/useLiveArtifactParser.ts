/**
 * Parser for <live_artifact> tags emitted by agents.
 *
 * Tag format:
 *   <live_artifact title="Dashboard" refresh="30">HTML</live_artifact>
 *   <live_artifact id="uuid" title="Dashboard" refresh="30">HTML</live_artifact>  ← update
 *
 * The parser is additive: it never mutates the surrounding text pipeline. The
 * chat message component strips the tag from the rendered markdown, calls
 * `saveLiveArtifact()` once per message (dedup via sessionStorage), and shows
 * a <LiveArtifactCard> in its place with the persisted id.
 */
import { api } from "@/lib/api";
import { useCallback } from "react";
import { useAuthContext } from "@/contexts/auth-context";

const LIVE_ARTIFACT_REGEX = /<live_artifact([^>]*)>([\s\S]*?)<\/live_artifact>/g;
const ATTR_TITLE = /title="([^"]*)"/;
const ATTR_REFRESH = /refresh="(\d+)"/;
const ATTR_ID = /id="([^"]*)"/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedLiveArtifact {
  title: string;
  refreshInterval: number;
  html: string;
  /** When present, the agent is updating an existing artifact. */
  existingId?: string;
}

function parseAttrs(attrsStr: string): {
  title?: string;
  refresh?: string;
  id?: string;
} {
  return {
    title: attrsStr.match(ATTR_TITLE)?.[1],
    refresh: attrsStr.match(ATTR_REFRESH)?.[1],
    id: attrsStr.match(ATTR_ID)?.[1],
  };
}

/** Strip all <live_artifact> blocks from the given text and return them. */
export function stripLiveArtifacts(text: string): {
  cleanText: string;
  artifacts: ParsedLiveArtifact[];
} {
  const artifacts: ParsedLiveArtifact[] = [];
  const cleanText = text
    .replace(LIVE_ARTIFACT_REGEX, (_match, attrsStr: string, body: string) => {
      const attrs = parseAttrs(attrsStr);
      const rawId = attrs.id?.trim();
      const validId = rawId && UUID_REGEX.test(rawId) ? rawId : undefined;
      artifacts.push({
        title: attrs.title || "Artefato vivo",
        refreshInterval: attrs.refresh ? parseInt(attrs.refresh, 10) : 30,
        html: body.trim(),
        existingId: validId,
      });
      return "";
    })
    .trim();
  return { cleanText, artifacts };
}

export function useLiveArtifactParser() {
  const { user } = useAuthContext();

  /**
   * Persist a parsed artifact and return its id. INSERT for new artifacts,
   * UPDATE when the agent supplied an `id`. Returns null on failure so the
   * caller can fall back to hiding the card.
   */
  const persist = useCallback(
    async (
      parsed: ParsedLiveArtifact,
      agentId?: string | null,
    ): Promise<string | null> => {
      if (!user) return null;

      // A desduplicação por título é do servidor agora: eram três idas ao banco
      // (procurar, decidir, gravar), com uma janela no meio em que dois turnos
      // simultâneos criavam dois artefatos com o mesmo nome.
      let data: { id: string } | null = null;
      let error: Error | null = null;
      try {
        data = await api<{ id: string }>("/artefatos/vivos", {
          method: "POST",
          body: {
            title: parsed.title,
            html_content: parsed.html,
            agent_id: agentId ?? null,
            refresh_interval: parsed.refreshInterval,
            existing_id: parsed.existingId ?? null,
            // Sem id explícito, reaproveita o do mesmo (agente, título) — é o
            // que impede a galeria de encher de cópias quando o agente reemite
            // o painel a cada turno.
            deduplicar: !parsed.existingId,
          },
        });
      } catch (e) {
        error = e as Error;
      }

      if (error || !data) {
        console.warn("[live-artifact] insert failed:", error?.message);
        return null;
      }
      return (data as any).id as string;

    },
    [user],
  );

  return { persist };
}
