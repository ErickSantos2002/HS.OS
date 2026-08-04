import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Client sobe antes da autenticação porque o segredo pode vir do banco.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Header próprio (x-ingest-key), não Authorization — por isso não usa
  // authorizeWithSecret. Comportamento preservado.
  const expected = await getIntegrationSecret(supabase, "INGEST_KEY");
  if (!expected) return json({ error: "INGEST_KEY not configured" }, 500);

  const provided = req.headers.get("x-ingest-key");
  if (!provided || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    agent_id,
    total_tokens = 0,
    input_tokens = 0,
    output_tokens = 0,
    context_tokens = 0,
    context_window = null,
    cache_read = 0,
    cache_write = 0,
    estimated_cost_usd = 0,
    model = null,
    session_count = 0,
    snapshot_at,
  } = payload ?? {};

  if (typeof agent_id !== "string" || !agent_id.trim()) {
    return json({ error: "agent_id is required" }, 400);
  }
  if (typeof snapshot_at !== "string" || isNaN(Date.parse(snapshot_at))) {
    return json({ error: "snapshot_at must be a valid ISO timestamp" }, 400);
  }


  const row = {
    agent_id,
    total_tokens: Number(total_tokens) || 0,
    input_tokens: Number(input_tokens) || 0,
    output_tokens: Number(output_tokens) || 0,
    context_tokens: Number(context_tokens) || 0,
    context_window: context_window == null ? null : Number(context_window) || null,
    cache_read: Number(cache_read) || 0,
    cache_write: Number(cache_write) || 0,
    estimated_cost_usd: Number(estimated_cost_usd) || 0,
    model: typeof model === "string" ? model : null,
    session_count: Number(session_count) || 0,
    snapshot_at,
  };

  const { error } = await supabase
    .from("agent_token_snapshots")
    .upsert(row, { onConflict: "agent_id,snapshot_at" });

  if (error) {
    console.error("Insert failed:", error);
    return json({ error: error.message }, 500);
  }

  return json({ success: true });
});
