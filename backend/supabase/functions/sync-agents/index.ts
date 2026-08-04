// Sync agents from OpenClaw gateway → public.agent_profiles
// Preserves specialty / is_leader / leader_id on existing rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const gateway = await getGatewayConfig(supabase);
    if (!gateway.token) {
      return new Response(
        JSON.stringify({ error: "Gateway token not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rpcRes = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gateway.token}`,
      },
      body: JSON.stringify({ method: "agents.list", params: {} }),
    });

    if (!rpcRes.ok) {
      const txt = await rpcRes.text();
      return new Response(
        JSON.stringify({ error: `Gateway error ${rpcRes.status}`, detail: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rpcJson = await rpcRes.json();
    const agents: Array<{ id?: string; agentId?: string; agent_id?: string; name?: string; workspace?: string | null }> =
      rpcJson?.payload?.agents ?? rpcJson?.payload ?? rpcJson?.result?.agents ?? rpcJson?.result ?? rpcJson?.agents ?? [];

    if (!Array.isArray(agents) || agents.length === 0) {
      return new Response(
        JSON.stringify({ synced: 0, note: "no agents returned", raw: rpcJson }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: existing } = await supabase
      .from("agent_profiles")
      .select("agent_id, name, specialty, is_leader, leader_id");

    const existingMap = new Map((existing || []).map((p) => [p.agent_id, p]));

    const upserts = agents
      .map((a) => {
        const agentId = String(a.id ?? a.agentId ?? a.agent_id ?? "").trim();
        if (!agentId) return null;
        const prev = existingMap.get(agentId);
        return {
          agent_id: agentId,
          openclaw_id: agentId,
          name: prev?.name || a.name || agentId,
          workspace: a.workspace ?? null,
          specialty: prev?.specialty ?? "",
          is_leader: prev?.is_leader ?? false,
          leader_id: prev?.leader_id ?? null,
          status: "active",
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    const { error } = await supabase
      .from("agent_profiles")
      .upsert(upserts, { onConflict: "agent_id" });

    if (error) {
      return new Response(
        JSON.stringify({ error: `Upsert error: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ synced: upserts.length, total: agents.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
