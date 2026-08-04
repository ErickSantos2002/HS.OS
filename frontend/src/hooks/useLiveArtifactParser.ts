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
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
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

      if (parsed.existingId) {
        const { data, error } = await supabase
          .from("live_artifacts" as any)
          .update({
            html_content: parsed.html,
            title: parsed.title,
            refresh_interval: parsed.refreshInterval,
          } as any)
          .eq("id", parsed.existingId)
          .eq("user_id", user.id)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle();
        if (error || !data) {
          console.warn("[live-artifact] update failed:", error?.message ?? "not found or deleted");
          return null;
        }
        return parsed.existingId;
      }

      // No explicit id: dedupe by (user_id, agent_id, title). If an artifact
      // with the same title already exists for this user+agent, UPDATE it
      // instead of inserting a new row. This prevents the gallery from filling
      // with duplicates when agents re-emit <live_artifact> without an id.
      const { data: existing } = await supabase
        .from("live_artifacts" as any)
        .select("id, deleted_at")
        .eq("user_id", user.id)
        .eq("agent_id", agentId ?? null)
        .eq("title", parsed.title)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && (existing as any).id) {
        if ((existing as any).deleted_at) return null;
        const existingId = (existing as any).id as string;
        const { error: updErr } = await supabase
          .from("live_artifacts" as any)
          .update({
            html_content: parsed.html,
            refresh_interval: parsed.refreshInterval,
          } as any)
          .eq("id", existingId)
          .eq("user_id", user.id);
        if (updErr) {
          console.warn("[live-artifact] dedupe update failed:", updErr.message);
          return null;
        }
        return existingId;
      }

      const { data, error } = await supabase
        .from("live_artifacts" as any)
        .insert({
          user_id: user.id,
          agent_id: agentId ?? null,
          title: parsed.title,
          html_content: parsed.html,
          refresh_interval: parsed.refreshInterval,
        } as any)
        .select("id")
        .single();

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
