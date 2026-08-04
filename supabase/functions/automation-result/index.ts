// Webhook receiver — OpenClaw posts here after a cron.add one-shot finishes.
// Updates the automation_runs row and the parent automation's last_run_status.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function extractOutputText(output: unknown, error: unknown): string {
  if (typeof output === "string" && output.trim()) return output;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.content === "string") return o.content;
    if (typeof o.result === "string") return o.result;
    try { return JSON.stringify(output); } catch { /* fall through */ }
  }
  if (typeof error === "string" && error) return error;
  return "Sem resposta";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const webhookSecret = (await getIntegrationSecret(supabase, "AUTOMATION_WEBHOOK_SECRET")) || "";
  const authHeader = req.headers.get("Authorization") || req.headers.get("x-webhook-token") || "";
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token") || "";

  if (!webhookSecret || (!authHeader.includes(webhookSecret) && tokenParam !== webhookSecret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const meta = (body.meta || (body as any).webhookMeta || {}) as Record<string, unknown>;
  const runId = (meta.runId as string | undefined) || url.searchParams.get("runId") || undefined;
  const automationId =
    (meta.automationId as string | undefined) || url.searchParams.get("automationId") || undefined;

  if (!runId || !automationId) {
    return new Response(JSON.stringify({ error: "Missing meta.runId or meta.automationId" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const status = body.status as string | undefined;
  const isSuccess = status === "ok" || status === "success" || status === "completed";
  const runStatus = isSuccess ? "success" : "error";
  const outputText = extractOutputText((body as any).output, (body as any).error);

  await supabase.from("automation_runs").update({
    status: runStatus,
    output: outputText.slice(0, 20000),
    error_message: isSuccess ? null : (typeof (body as any).error === "string"
      ? (body as any).error
      : outputText).slice(0, 2000),
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  await supabase.from("automations").update({
    last_run_at: new Date().toISOString(),
    last_run_status: runStatus,
  }).eq("id", automationId);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
