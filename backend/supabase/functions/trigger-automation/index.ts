// Receives internal dn.os events and dispatches matching trigger-type automations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Constant-time string comparison to avoid leaking the secret via timing. */
function secretsMatch(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Authorize the caller. This endpoint dispatches real (token-spending) automations,
 * so it must not be callable anonymously from the internet.
 * Accepts EITHER:
 *   - an internal secret header `x-automation-secret` (server-to-server), OR
 *   - a valid authenticated user JWT (the frontend `functions.invoke` path).
 */
async function isAuthorized(req: Request): Promise<boolean> {
  const expectedSecret = (await getIntegrationSecret(supabase, "AUTOMATION_WEBHOOK_SECRET")) || "";
  const providedSecret = req.headers.get("x-automation-secret") || "";
  if (expectedSecret && secretsMatch(providedSecret, expectedSecret)) return true;

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return false;
  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await authClient.auth.getClaims(authHeader.slice(7));
    const role = (data?.claims as Record<string, unknown> | undefined)?.role;
    // Reject the anon key (which is also a Bearer JWT) — require a real user.
    return !error && !!data?.claims && role === "authenticated";
  } catch {
    return false;
  }
}

const ALLOWED_EVENTS = new Set([
  "gateway.offline",
  "integration.added",
  "integration.expired",
  "user.joined",
  "agent.error",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!(await isAuthorized(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { event?: string; payload?: Record<string, unknown> } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { event, payload } = body;
  if (!event || !ALLOWED_EVENTS.has(event)) {
    return new Response(JSON.stringify({ error: "Missing or invalid event" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: automations, error } = await supabase
    .from("automations")
    .select("*")
    .eq("type", "trigger")
    .eq("trigger_event", event)
    .eq("is_active", true);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!automations?.length) {
    return new Response(JSON.stringify({ triggered: 0 }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gateway = await getGatewayConfig(supabase);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  // Mesmo segredo usado para VERIFICAR entrada — precisa vir da mesma fonte,
  // senão enviaríamos um valor diferente do que o receptor espera.
  const webhookSecret = (await getIntegrationSecret(supabase, "AUTOMATION_WEBHOOK_SECRET")) || "";

  const eventContext = payload
    ? `\n\nContexto do evento ${event}: ${JSON.stringify(payload)}`
    : `\n\nEvento: ${event}`;

  let triggered = 0;

  for (const automation of automations) {
    const jobName = `dnos-trigger-${automation.id}-${Date.now()}`;

    const { data: run } = await supabase
      .from("automation_runs")
      .insert({ automation_id: automation.id, cron_job_name: jobName, status: "running" })
      .select()
      .single();

    if (!run) continue;

    try {
      const resultUrl = new URL(`${supabaseUrl}/functions/v1/automation-result`);
      resultUrl.searchParams.set("runId", run.id);
      resultUrl.searchParams.set("automationId", automation.id);
      if (webhookSecret) resultUrl.searchParams.set("token", webhookSecret);

      const res = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
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
            schedule: { kind: "at", at: new Date(Date.now() + 3000).toISOString() },
            sessionTarget: "isolated",
            agentId: automation.agent_id,
            payload: {
              kind: "agentTurn",
              message: automation.instruction + eventContext,
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

      if (!res.ok) {
        const err = await res.text();
        await supabase.from("automation_runs").update({
          status: "error",
          error_message: err.slice(0, 2000),
          finished_at: new Date().toISOString(),
        }).eq("id", run.id);
        await supabase.from("automations").update({
          last_run_at: new Date().toISOString(),
          last_run_status: "error",
        }).eq("id", automation.id);
      } else {
        await supabase.from("automations").update({
          last_run_at: new Date().toISOString(),
          last_run_status: "running",
        }).eq("id", automation.id);
        triggered++;
      }
    } catch (e) {
      await supabase.from("automation_runs").update({
        status: "error",
        error_message: String((e as Error).message ?? e).slice(0, 2000),
        finished_at: new Date().toISOString(),
      }).eq("id", run.id);
    }
  }

  return new Response(JSON.stringify({ triggered, total: automations.length }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
