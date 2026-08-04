// Returns the list of OpenClaw agents with their workspaces.
// Reads gateway config from vps_config (fallback to OPENCLAW_ADMIN_TOKEN env).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const gateway = await getGatewayConfig(supabase);
  const token = gateway.token;
  const OPENCLAW_RPC = `${gateway.url}/api/v1/admin/rpc`;
  if (!token) {
    return new Response(
      JSON.stringify({ success: false, error: "Gateway token not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }


  try {
    const res = await fetch(OPENCLAW_RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method: "agents.list", params: {} }),
    });
    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({ success: false, error: `OpenClaw HTTP ${res.status}: ${text}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const data = await res.json();
    const agents = Array.isArray(data?.payload?.agents)
      ? data.payload.agents
      : Array.isArray(data?.agents)
      ? data.agents
      : Array.isArray(data?.result?.agents)
      ? data.result.agents
      : Array.isArray(data)
      ? data
      : [];

    const normalized = agents
      .map((a: any) => ({
        id: a?.id ?? a?.agent_id ?? a?.agentId ?? null,
        name: a?.name ?? a?.id ?? null,
        workspace: a?.workspace ?? a?.workspace_path ?? a?.workspacePath ?? null,
      }))
      .filter((a: any) => !!a.workspace);

    // Dedupe workspaces, keep first agent reference for each
    const seen = new Set<string>();
    const workspaces: { path: string; agents: string[] }[] = [];
    for (const a of normalized) {
      if (seen.has(a.workspace)) {
        const entry = workspaces.find((w) => w.path === a.workspace);
        if (entry && a.name) entry.agents.push(a.name);
      } else {
        seen.add(a.workspace);
        workspaces.push({ path: a.workspace, agents: a.name ? [a.name] : [] });
      }
    }

    return new Response(
      JSON.stringify({ success: true, agents: normalized, workspaces }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
