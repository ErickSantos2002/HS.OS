import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Allowlist server-side das tabelas que os live artifacts podem consultar.
// DEVE espelhar a lista em src/lib/live-artifacts-context.ts (prompt do agente).
// Sem isso, um artefato malicioso/alucinado consultaria qualquer tabela (RLS
// era a única barreira). Manter as duas listas em sincronia.
const ALLOWED_TABLES = new Set([
  "agent_results", "agent_tasks", "agent_activity_log", "conversations",
  "channel_messages", "channels", "automations", "automation_runs",
  "profiles", "live_artifacts", "artifacts_published", "notifications",
  "drafts", "wiki_documents", "wiki_spaces", "teams", "team_agents",
  "skills", "agent_skills",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  try {
    // Client scoped with user's JWT so RLS applies as if the user were querying directly.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const body = await req.json().catch(() => ({}));
    const { table, select, filters, order, limit } = body ?? {};

    if (!table || typeof table !== "string") {
      return json({ error: "'table' is required" }, 400);
    }

    if (!ALLOWED_TABLES.has(table)) {
      // 200 estruturado (como table_not_found) para o runtime do browser não
      // registrar erro — o agente reage ao payload.
      return json(
        { ok: false, error: `Tabela '${table}' não é permitida para consulta.`, code: "table_not_allowed" },
        200,
      );
    }

    let query = supabase.from(table).select(typeof select === "string" ? select : "*");

    if (filters && typeof filters === "object") {
      for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val as any);
      }
    }
    if (order && typeof order === "object" && order.column) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }
    if (typeof limit === "number" && limit > 0) {
      query = query.limit(Math.min(limit, 1000));
    }

    const { data, error } = await query;
    if (error) {
      const msg = error.message || "";
      // Table missing from schema cache is an expected caller mistake, not a
      // server failure — return 200 so the browser runtime error tracker
      // stays quiet and the agent can react to the structured payload.
      if (/schema cache/i.test(msg) || /does not exist/i.test(msg)) {
        return json(
          { ok: false, error: `Tabela '${table}' não existe neste projeto.`, code: "table_not_found" },
          200,
        );
      }
      return json({ ok: false, error: msg, code: "query_failed" }, 200);
    }

    return json({ success: true, data });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
