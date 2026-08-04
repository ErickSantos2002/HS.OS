// Permanently delete an agent: remove from OpenClaw and from Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


function err(step: string, message: string, status = 500) {
  return new Response(
    JSON.stringify({ success: false, step, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("method", "POST required", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const gateway = await getGatewayConfig(supabase);
  if (!gateway.token) return err("config", "Gateway token not configured");
  const token = gateway.token;
  const OPENCLAW_RPC = `${gateway.url}/api/v1/admin/rpc`;


  let body: { agent_id?: string; profile_agent_id?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return err("parse", "Invalid JSON body", 400);
  }

  const agentId = (body.agent_id ?? "").trim();
  const profileAgentId = (body.profile_agent_id ?? agentId).trim();
  if (!agentId || !/^[a-zA-Z0-9_-]{2,80}$/.test(agentId)) {
    return err("validation", "Invalid agent_id", 400);
  }

  // STEP 1 — delete from OpenClaw (try common param shapes)
  console.log(`[delete-agent] STEP 1: deleting ${agentId} from OpenClaw`);
  const paramVariants = [
    { agentId },
    { name: body.name ?? agentId },
  ];

  let openclawDeleted = false;
  let openclawWarning: string | null = null;

  for (const params of paramVariants) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(OPENCLAW_RPC, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ method: "agents.delete", params }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const raw = await res.text();
      console.log(`[delete-agent] OpenClaw ${JSON.stringify(params)} → ${res.status} ${raw.slice(0, 200)}`);
      if (res.ok) {
        openclawDeleted = true;
        break;
      }
      const lower = raw.toLowerCase();
      if (lower.includes("not found") || lower.includes("does not exist") || lower.includes("no such")) {
        openclawDeleted = true; // already gone
        break;
      }
      openclawWarning = `OpenClaw delete failed (HTTP ${res.status}): ${raw.slice(0, 200)}`;
      // If error is about invalid params, try next shape
      if (!lower.includes("unexpected property") && !lower.includes("invalid")) break;
    } catch (e) {
      openclawWarning = (e as Error).message;
      break;
    }
  }

  // STEP 2 — delete from Supabase (always attempt)


  const { error: dbErr } = await supabase
    .from("agent_profiles")
    .delete()
    .or(`agent_id.eq.${profileAgentId},openclaw_id.eq.${agentId}`);

  if (dbErr) {
    console.log(`[delete-agent] supabase delete failed: ${dbErr.message}`);
    return err("supabase", dbErr.message);
  }

  // Best-effort cleanup of related rows
  await supabase.from("agent_avatars").delete().or(`agent_id.eq.${profileAgentId},agent_id.eq.${agentId}`).then(() => {}, () => {});
  await supabase.from("agent_integrations").delete().or(`agent_id.eq.${profileAgentId},agent_id.eq.${agentId}`).then(() => {}, () => {});

  return new Response(
    JSON.stringify({
      success: true,
      agent_id: agentId,
      openclaw_deleted: openclawDeleted,
      openclaw_warning: openclawDeleted ? null : openclawWarning,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
