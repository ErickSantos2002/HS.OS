// Update an agent's profile fields (general, persona, automations) and best-effort sync to OpenClaw.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


interface Body {
  agent_id: string;
  name?: string;
  emoji?: string;
  specialty?: string;
  model?: string;
  persona_description?: string;
  skills_description?: string;
  skills_tags?: string[];
  crons_description?: string;
  status?: string;
  is_leader?: boolean;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "POST required" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // AUTH — super_admin only (skip if invoked via service role)
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ success: false, error: "Missing Authorization" }, 401);
  const isServiceRole = jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isServiceRole) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ success: false, error: "Invalid token" }, 401);
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "super_admin",
    });
    if (!isAdmin) return json({ success: false, error: "Only super_admin can edit agents" }, 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const { agent_id, ...rest } = body;
  if (!agent_id) return json({ success: false, error: "agent_id required" }, 400);

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined) updatePayload[k] = v;
  }

  const { error: dbErr } = await supabase
    .from("agent_profiles")
    .update(updatePayload)
    .eq("agent_id", agent_id);
  if (dbErr) return json({ success: false, error: dbErr.message }, 400);

  // Best-effort: sync name/model to OpenClaw
  const gateway = await getGatewayConfig(supabase);
  const token = gateway.token;
  const OPENCLAW_RPC = `${gateway.url}/api/v1/admin/rpc`;
  let openclawWarning: string | null = null;
  if (token && (rest.name !== undefined || rest.model !== undefined)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(OPENCLAW_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          method: "agents.update",
          params: {
            agentId: agent_id,
            ...(rest.name !== undefined ? { name: rest.name } : {}),
            ...(rest.model !== undefined ? { model: rest.model } : {}),
          },
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const txt = await res.text();
        openclawWarning = `OpenClaw HTTP ${res.status}: ${txt.slice(0, 200)}`;
      }
    } catch (e) {
      openclawWarning = (e as Error).message;
    }
  }

  return json({ success: true, agent_id, openclaw_warning: openclawWarning });
});
