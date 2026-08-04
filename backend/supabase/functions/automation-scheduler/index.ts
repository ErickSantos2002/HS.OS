// Runs every minute via pg_cron. Detects scheduled automations whose time matches
// the current UTC minute and dispatches a one-shot cron.add job to the OpenClaw gateway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const now = new Date();
  const currentDay = WEEKDAYS[now.getUTCDay()];
  const currentTime = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;

  const { data: allRows, error: selectError } = await supabase
    .from("automations")
    .select("id,name,agent_id,type,scheduled_day,scheduled_time,is_active,last_run_at,last_run_status,created_at,updated_at");
  console.log("🔍 SCHEDULER DEBUG — all automations:", JSON.stringify({
    count: allRows?.length,
    rows: allRows,
    error: selectError,
  }));

  const nowIso = now.toISOString();
  console.log("🔍 SCHEDULER DEBUG — now():", nowIso);
  const { data: due, error: dueError } = await supabase
    .from("automations")
    .select("id,name,agent_id,type,scheduled_day,scheduled_time,is_active,last_run_at,last_run_status")
    .eq("type", "scheduled")
    .eq("is_active", true)
    .eq("scheduled_time", currentTime)
    .or(`scheduled_day.eq.daily,scheduled_day.eq.${currentDay}`);
  console.log("🔍 SCHEDULER DEBUG — due automations:", JSON.stringify({
    count: due?.length,
    rows: due,
    error: dueError,
  }));

  const { data: automations, error } = await supabase
    .from("automations")
    .select("*")
    .eq("type", "scheduled")
    .eq("is_active", true)
    .eq("scheduled_time", currentTime)
    .or(`scheduled_day.eq.daily,scheduled_day.eq.${currentDay}`);

  if (error) {
    console.error("[automation-scheduler] query failed", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!automations?.length) {
    return new Response(JSON.stringify({ dispatched: 0, currentTime, currentDay }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gateway = await getGatewayConfig(supabase);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const webhookSecret = (await getIntegrationSecret(supabase, "AUTOMATION_WEBHOOK_SECRET")) || "";

  const results = await Promise.allSettled(
    automations.map(async (automation) => {
      const jobName = `dnos-auto-${automation.id}-${Date.now()}`;

      const { data: run, error: runErr } = await supabase
        .from("automation_runs")
        .insert({ automation_id: automation.id, cron_job_name: jobName, status: "running" })
        .select()
        .single();

      if (runErr || !run) throw new Error(`run insert failed: ${runErr?.message}`);

      const resultUrl = new URL(`${supabaseUrl}/functions/v1/automation-result`);
      resultUrl.searchParams.set("runId", run.id);
      resultUrl.searchParams.set("automationId", automation.id);
      if (webhookSecret) resultUrl.searchParams.set("token", webhookSecret);

      const response = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gateway.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: jobName,
          method: "cron.add",
          params: {
            name: jobName,
            schedule: { kind: "at", at: new Date(Date.now() + 5000).toISOString() },
            sessionTarget: "isolated",
            agentId: automation.agent_id,
            payload: {
              kind: "agentTurn",
              message: automation.instruction,
              timeoutSeconds: 300,
            },
            deleteAfterRun: true,
            delivery: {
              mode: "webhook",
              to: resultUrl.toString(),
            },
          },
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        await supabase.from("automation_runs").update({
          status: "error",
          error_message: err.slice(0, 2000),
          finished_at: new Date().toISOString(),
        }).eq("id", run.id);
        await supabase.from("automations").update({
          last_run_at: new Date().toISOString(),
          last_run_status: "error",
        }).eq("id", automation.id);
        throw new Error(`cron.add failed (${response.status}): ${err.slice(0, 200)}`);
      }

      await supabase.from("automations").update({
        last_run_at: new Date().toISOString(),
        last_run_status: "running",
      }).eq("id", automation.id);

      return { automationId: automation.id, runId: run.id, jobName };
    }),
  );

  const dispatched = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return new Response(JSON.stringify({ dispatched, failed, total: automations.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
