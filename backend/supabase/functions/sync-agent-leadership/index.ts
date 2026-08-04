// Sync agent leadership (is_leader + leader_id) from a payload provided by the
// orchestrator agent (Lia, on the VPS) or by a super_admin user via the dn.os UI.
//
// Auth (either is accepted):
//   1. Bearer ${GUARDRAILS_API_TOKEN}  → Lia / VPS automation
//   2. Bearer <user JWT> with super_admin role → admin in the UI
//
// Body:
//   {
//     "agents": [
//       { "agent_id": "lia",  "is_leader": true,  "leader_id": null },
//       { "agent_id": "kira", "is_leader": false, "leader_id": "lia" }
//     ]
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AgentSchema = z.object({
  agent_id: z.string().min(1).max(120),
  is_leader: z.boolean(),
  leader_id: z.string().min(1).max(120).nullable(),
});

const BodySchema = z.object({
  agents: z.array(AgentSchema).min(1).max(500),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // Client dedicado só para ler o segredo — o `admin` deste handler é criado
  // mais abaixo, e a autenticação precisa acontecer antes dele.
  const secretsClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const expectedToken = await getIntegrationSecret(secretsClient, "GUARDRAILS_API_TOKEN");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!bearer) return json({ error: "Unauthorized" }, 401);

  let authorized = false;
  let authSource = "";

  // Path 1: service token
  if (expectedToken && bearer === expectedToken) {
    authorized = true;
    authSource = "token";
  } else {
    // Path 2: super_admin JWT
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } },
    );
    const { data: claimsData } = await authClient.auth.getClaims(bearer);
    const uid = claimsData?.claims?.sub;
    if (uid) {
      const { data: roleRow } = await authClient
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "super_admin")
        .maybeSingle();
      if (roleRow) {
        authorized = true;
        authSource = `user:${uid}`;
      }
    }
  }

  if (!authorized) return json({ error: "Unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  const { agents } = parsed.data;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: Array<{ agent_id: string; is_leader: boolean; leader_id: string | null; updated: boolean; error?: string }> = [];

  for (const a of agents) {
    // Prevent self-leadership
    const leader_id = a.leader_id && a.leader_id !== a.agent_id ? a.leader_id : null;
    const { error, data } = await admin
      .from("agent_profiles")
      .update({
        is_leader: a.is_leader,
        leader_id,
        updated_at: new Date().toISOString(),
      })
      .eq("agent_id", a.agent_id)
      .select("agent_id");
    results.push({
      agent_id: a.agent_id,
      is_leader: a.is_leader,
      leader_id,
      updated: !error && !!data && data.length > 0,
      error: error?.message,
    });
  }

  const updated = results.filter((r) => r.updated).length;
  console.log(`[sync-agent-leadership] auth=${authSource} updated=${updated}/${results.length}`);

  return json({
    success: true,
    updated,
    total: results.length,
    agents: results,
  });
});
