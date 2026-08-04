// Sync automation status from the OpenClaw gateway.
// Reads cron.list via admin/rpc and mirrors lastRunStatus/lastRunAt into
// public.automations so the UI stops showing false "Erro" for jobs whose
// delivery.mode is "none" (no webhook callback to automation-result).
//
// Runs periodically via pg_cron. Safe to invoke ad-hoc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type GatewayJob = {
  id?: string;
  name: string;
  enabled?: boolean;
  agentId?: string;
  state?: {
    lastRunStatus?: string | null;
    lastRunAtMs?: number | null;
    lastError?: string | null;
    consecutiveErrors?: number;
  };
  // Legacy / alternative shapes:
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  lastRunAtMs?: number | null;
};


function mapStatus(s: string | null | undefined): "success" | "error" | "running" | null {
  if (!s) return null;
  const v = String(s).toLowerCase();
  if (v === "ok" || v === "success" || v === "succeeded") return "success";
  if (v === "running" || v === "in_progress" || v === "pending") return "running";
  if (v === "error" || v === "failed" || v === "failure") return "error";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const gateway = await getGatewayConfig(supabase);
    if (!gateway.url || !gateway.token) {
      return new Response(JSON.stringify({ error: "Gateway not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gateway.token}` },
      body: JSON.stringify({ method: "cron.list", params: {} }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: `Gateway ${res.status}`, detail: txt.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const jobs: GatewayJob[] =
      json?.payload?.jobs ?? json?.payload ?? json?.result?.jobs ?? json?.result ?? [];
    if (!Array.isArray(jobs)) {
      return new Response(JSON.stringify({ error: "Unexpected gateway payload" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: automations, error: aErr } = await supabase
      .from("automations")
      .select("id, name");
    if (aErr) throw aErr;

    const byName = new Map<string, string>();
    for (const a of automations ?? []) byName.set(a.name, a.id);

    let updated = 0;
    let skipped = 0;
    for (const job of jobs) {
      const automationId = byName.get(job.name);
      if (!automationId) { skipped++; continue; }

      const status = mapStatus(job.state?.lastRunStatus ?? job.lastRunStatus);
      const lastRunAtMs = job.state?.lastRunAtMs ?? job.lastRunAtMs ?? null;
      const lastRunAt = lastRunAtMs
        ? new Date(lastRunAtMs).toISOString()
        : (job.lastRunAt ?? null);
      const update: Record<string, unknown> = {};
      if (status) update.last_run_status = status;
      if (lastRunAt) update.last_run_at = lastRunAt;
      if (Object.keys(update).length === 0) { skipped++; continue; }

      const { error: uErr } = await supabase
        .from("automations")
        .update(update)
        .eq("id", automationId);
      if (!uErr) updated++;

    }

    const body: Record<string, unknown> = { ok: true, total: jobs.length, updated, skipped };


    return new Response(JSON.stringify(body), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
