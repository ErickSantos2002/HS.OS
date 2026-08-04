/**
 * agent-reply-webhook — Receives completed agent replies from the VPS gateway
 * and persists them to `conversations`. Works for long tasks that exceed the
 * Cloudflare/Edge timeout, because the VPS pushes the result back instead of
 * relying on `dm-agent-reply` keeping the HTTP request alive.
 *
 * Auth: shared secret in `x-webhook-secret` header (AGENT_REPLY_WEBHOOK_SECRET).
 *
 * Payload:
 *   {
 *     agent_id: string,              // e.g. "lia"
 *     user_id:  string,              // uuid of the recipient user
 *     content:  string | string[],   // single reply OR burst (multi-message)
 *     in_reply_to_ts?: string,       // ISO timestamp of the user msg (for dedup)
 *     status?: "completed" | "failed",
 *     error?: string                 // when status = "failed"
 *   }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // ---- Auth (shared secret) -------------------------------------------------
  // Client sobe para cá porque o segredo agora pode vir do banco; é o mesmo
  // usado na persistência mais abaixo.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const expected = await getIntegrationSecret(supabase, "AGENT_REPLY_WEBHOOK_SECRET");
  if (!expected) {
    console.error("[agent-reply-webhook] AGENT_REPLY_WEBHOOK_SECRET not configured");
    return json(500, { error: "server_misconfigured" });
  }
  const provided =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (provided !== expected) {
    return json(401, { error: "unauthorized" });
  }

  // ---- Payload --------------------------------------------------------------
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const agentId = typeof body?.agent_id === "string" ? body.agent_id.trim() : "";
  const userId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
  const status = body?.status === "failed" ? "failed" : "completed";
  const inReplyToTs =
    typeof body?.in_reply_to_ts === "string" ? body.in_reply_to_ts : null;

  if (!agentId || !userId) {
    return json(400, { error: "missing_required", required: ["agent_id", "user_id"] });
  }

  // Normalize content into an array of non-empty strings
  let parts: string[] = [];
  if (status === "failed") {
    const err = typeof body?.error === "string" && body.error.trim()
      ? body.error.trim()
      : "Não foi possível concluir a tarefa.";
    parts = [`⚠️ ${err}`];
  } else if (Array.isArray(body?.content)) {
    parts = body.content.filter((c: unknown) => typeof c === "string" && c.trim()).map((c: string) => c.trim());
  } else if (typeof body?.content === "string" && body.content.trim()) {
    parts = [body.content.trim()];
  }

  if (parts.length === 0) {
    return json(400, { error: "empty_content" });
  }

  // ---- Persist --------------------------------------------------------------

  // Dedup: if a REAL agent reply already landed for this turn, skip.
  // BUT: if the only thing there is the "gateway timed out" failure marker,
  // delete it so this real webhook reply replaces it (the agent actually
  // finished the long task, so the user should see the result, not the error).
  const FAILURE_MARKER_PREFIX = "⚠️ Não consegui finalizar";
  // A6: heartbeats de progresso ("🔍 Analisando…") são persistidos como mensagem
  // de agente, mas NÃO são a resposta final. Sem excluí-los do dedup, um heartbeat
  // faz o webhook "achar" que já respondeu e DESCARTAR a resposta final — a dor do
  // Rock (agente terminou, resultado nunca chegou à DM). Mesma heurística de emoji
  // do chat-sender (isHeartbeatMessage).
  const HEARTBEAT_EMOJI_RE = /^\s*(?:🔄|✅|⏳|🔍|⚙️|📥|📤|🎬|📝|🎯|🧠|🟢|🟡|🔴|▶️|⏱️|🚀|📊|💾|🔎|📡|⌛|✨|🛠️|🧪)/u;
  const isFailure = (c: string) => (c ?? "").startsWith(FAILURE_MARKER_PREFIX);
  const isHeartbeat = (c: string) => HEARTBEAT_EMOJI_RE.test((c ?? "").trim());
  if (inReplyToTs) {
    const { data: existing, error: dupErr } = await supabase
      .from("conversations")
      .select("id, content")
      .eq("agent_id", agentId)
      .eq("user_id", userId)
      .eq("role", "agent")
      .gt("created_at", inReplyToTs);

    if (dupErr) {
      console.warn("[agent-reply-webhook] dedup check failed:", dupErr.message);
    } else if ((existing?.length ?? 0) > 0) {
      const rows = existing as Array<{ id: string; content: string }>;
      // Resposta "real" = não é failure marker NEM heartbeat de progresso.
      const realRows = rows.filter((r) => !isFailure(r.content) && !isHeartbeat(r.content));
      const staleRows = rows.filter((r) => isFailure(r.content) || isHeartbeat(r.content));
      if (realRows.length > 0) {
        console.log(`[agent-reply-webhook] Real reply already present for agent=${agentId} — skipping.`);
        return json(200, { ok: true, skipped: "duplicate" });
      }
      if (staleRows.length > 0) {
        // Só heartbeats/failure markers presentes → limpa e insere a resposta real.
        const ids = staleRows.map((r) => r.id);
        const { error: delErr } = await supabase.from("conversations").delete().in("id", ids);
        if (delErr) {
          console.warn("[agent-reply-webhook] failed to delete stale markers:", delErr.message);
        } else {
          console.log(`[agent-reply-webhook] Deleted ${ids.length} stale heartbeat/failure row(s), inserting real reply.`);
        }
      }
    }
  }

  const baseMs = Date.now();
  const rows = parts.map((content, i) => ({
    agent_id: agentId,
    user_id: userId,
    role: "agent",
    content,
    created_at: new Date(baseMs + i).toISOString(),
  }));

  const { error: insertErr } = await supabase.from("conversations").insert(rows);
  if (insertErr) {
    console.error("[agent-reply-webhook] insert error:", insertErr);
    return json(500, { error: "insert_failed", detail: insertErr.message });
  }

  console.log(
    `[agent-reply-webhook] Persisted ${rows.length} message(s) for agent=${agentId} user=${userId} status=${status}`,
  );
  return json(200, { ok: true, persisted: rows.length });
});
