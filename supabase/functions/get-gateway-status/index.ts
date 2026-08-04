// Returns current gateway config + latest collector heartbeats.
// Super-admin only — the admin_token is never returned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // AuthZ: super_admin only
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(
      JSON.stringify({ success: false, error: "Not authenticated" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const { data: userData } = await supabase.auth.getUser(jwt);
  const userId = userData?.user?.id;
  if (!userId) {
    return new Response(
      JSON.stringify({ success: false, error: "Not authenticated" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (!isAdmin) {
    return new Response(
      JSON.stringify({ success: false, error: "Forbidden" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Config (omit token)
  const { data: configRow } = await supabase
    .from("vps_config")
    .select("id, gateway_url, admin_token, updated_at")
    .limit(1)
    .maybeSingle();

  const config = configRow
    ? {
        id: configRow.id,
        gateway_url: configRow.gateway_url,
        has_token: Boolean(configRow.admin_token),
        updated_at: configRow.updated_at,
      }
    : null;

  // Recent collector heartbeats
  const { data: health } = await supabase
    .from("gateway_health")
    .select("*")
    .order("collected_at", { ascending: false })
    .limit(10);

  const heartbeats = health ?? [];

  // Pull snapshots covering the heartbeat window (oldest hb - 20min).
  const oldestHb = heartbeats[heartbeats.length - 1]?.collected_at ?? null;
  const sinceIso = oldestHb
    ? new Date(new Date(oldestHb).getTime() - 20 * 60_000).toISOString()
    : new Date(Date.now() - 3 * 60 * 60_000).toISOString();

  const { data: snapsRaw } = await supabase
    .from("agent_token_snapshots")
    .select("agent_id, total_tokens, snapshot_at")
    .gte("snapshot_at", sinceIso)
    .order("snapshot_at", { ascending: true });

  const snaps = (snapsRaw ?? []) as Array<{
    agent_id: string;
    total_tokens: number | null;
    snapshot_at: string;
  }>;

  const sortedHb = [...heartbeats].sort(
    (a: Record<string, unknown>, b: Record<string, unknown>) =>
      new Date(a.collected_at as string).getTime() -
      new Date(b.collected_at as string).getTime(),
  );

  function lastTotalsBefore(tsMs: number): Map<string, number> {
    const map = new Map<string, number>();
    for (const s of snaps) {
      const t = new Date(s.snapshot_at).getTime();
      if (t > tsMs) break;
      map.set(s.agent_id, s.total_tokens ?? 0);
    }
    return map;
  }

  const enrichedById = new Map<
    string,
    { window_tokens: number; top_agent: { agent_id: string; tokens: number } | null }
  >();

  for (let i = 0; i < sortedHb.length; i++) {
    const hb = sortedHb[i] as Record<string, unknown>;
    const prev = i > 0 ? (sortedHb[i - 1] as Record<string, unknown>) : null;
    const tEnd = new Date(hb.collected_at as string).getTime();
    const tStart = prev
      ? new Date(prev.collected_at as string).getTime()
      : tEnd - 15 * 60_000;

    const endTotals = lastTotalsBefore(tEnd);
    const startTotals = lastTotalsBefore(tStart);

    let windowTokens = 0;
    let topAgent: { agent_id: string; tokens: number } | null = null;
    for (const [agentId, endVal] of endTotals) {
      const startVal = startTotals.get(agentId) ?? endVal;
      const delta = Math.max(0, endVal - startVal);
      if (delta === 0) continue;
      windowTokens += delta;
      if (!topAgent || delta > topAgent.tokens) {
        topAgent = { agent_id: agentId, tokens: delta };
      }
    }

    enrichedById.set(hb.id as string, { window_tokens: windowTokens, top_agent: topAgent });
  }

  const enrichedHistory = heartbeats.map((hb: Record<string, unknown>) => ({
    ...hb,
    ...(enrichedById.get(hb.id as string) ?? { window_tokens: 0, top_agent: null }),
  }));

  const latest = heartbeats[0] ?? null;
  const lastSeenIso: string | null = latest?.collected_at ?? latest?.created_at ?? null;
  const lastSeen = lastSeenIso ? new Date(lastSeenIso) : null;
  const minutesAgo = lastSeen
    ? Math.floor((Date.now() - lastSeen.getTime()) / 60000)
    : null;

  const connection_status =
    minutesAgo === null ? "unknown" :
    minutesAgo < 20 ? "online" :
    minutesAgo < 40 ? "slow" : "offline";

  // ── Aggregated metrics for the Gateway tab cards ─────────────
  const [{ data: statsRows }, { data: tokenRowsToday }] = await Promise.all([
    supabase.from("agent_stats").select("session_count, model"),
    (() => {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return supabase
        .from("agent_token_snapshots")
        .select("agent_id, total_tokens, input_tokens, output_tokens, model, snapshot_at")
        .gte("snapshot_at", startOfToday.toISOString())
        .order("snapshot_at", { ascending: true });
    })(),
  ]);

  const total_sessions =
    statsRows?.reduce(
      (sum: number, r: { session_count: number | null }) => sum + (r.session_count ?? 0),
      0,
    ) ?? null;

  const byAgent: Record<string, Array<{
    total_tokens: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    model: string | null;
  }>> = {};
  for (const row of (tokenRowsToday ?? []) as Array<{
    agent_id: string;
    total_tokens: number | null;
    input_tokens: number | null;
    output_tokens: number | null;
    model: string | null;
  }>) {
    (byAgent[row.agent_id] ??= []).push(row);
  }

  let total_tokens_today = 0;
  let total_input_today = 0;
  let total_output_today = 0;
  const model_usage: Record<string, { input: number; output: number }> = {};

  for (const rows of Object.values(byAgent)) {
    if (rows.length < 2) continue;
    const first = rows[0];
    const last = rows[rows.length - 1];
    const dTotal = (last.total_tokens ?? 0) - (first.total_tokens ?? 0);
    const dIn = (last.input_tokens ?? 0) - (first.input_tokens ?? 0);
    const dOut = (last.output_tokens ?? 0) - (first.output_tokens ?? 0);
    if (dTotal <= 0) continue;
    total_tokens_today += dTotal;
    total_input_today += dIn;
    total_output_today += dOut;
    const model = last.model ?? "unknown";
    (model_usage[model] ??= { input: 0, output: 0 });
    model_usage[model].input += dIn;
    model_usage[model].output += dOut;
  }

  const latestAny = latest as Record<string, unknown> | null;
  const rawData = (latestAny?.raw_data ?? null) as Record<string, unknown> | null;
  const gw = (rawData?.gateway ?? null) as Record<string, unknown> | null;
  const gw_version =
    (gw?.version as string | undefined) ??
    (latestAny?.gateway_version as string | undefined) ??
    (latestAny?.version as string | undefined) ??
    null;
  const gw_latency =
    ((gw?.health as Record<string, unknown> | undefined)?.durationMs as number | undefined) ??
    (latestAny?.latency_ms as number | undefined) ??
    null;

  return new Response(
    JSON.stringify({
      success: true,
      data: {
        config,
        connection_status,
        minutes_since_heartbeat: minutesAgo,
        latest_metrics: latest,
        recent_history: enrichedHistory,
        metrics: {
          total_sessions,
          total_tokens_today,
          total_input_today,
          total_output_today,
          model_usage,
          gateway_version: gw_version,
          latency_ms: gw_latency,
        },
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
