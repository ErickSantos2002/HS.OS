import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// O segredo não é mais lido no topo do módulo: agora pode vir do banco
// (integration_secrets) com fallback para o ambiente, e leitura de banco não
// cabe em inicialização de módulo. Ver _shared/integration-secret.ts.

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Aceita o segredo tanto em Authorization: Bearer quanto no header alternativo
// x-bridge-token — comportamento preservado da versão anterior.
async function checkAuth(req: Request): Promise<boolean> {
  const expected = await getIntegrationSecret(admin, "AGENT_ACTIVITY_BRIDGE_TOKEN");
  if (!expected) return false;
  const h = req.headers.get("Authorization") || "";
  if (h.startsWith("Bearer ")) return h.slice(7) === expected;
  const alt = req.headers.get("x-bridge-token");
  return !!alt && alt === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!(await checkAuth(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Determine action: explicit `action` field or infer from HTTP method
  const action =
    (body.action as string | undefined) ||
    (req.method === "POST"
      ? "start"
      : req.method === "PATCH"
      ? "update"
      : undefined);

  try {
    if (action === "start") {
      const {
        agent_id,
        activity_type,
        title,
        user_id,
        channel,
        metadata,
        steps,
        status,
      } = body as Record<string, unknown>;

      if (!agent_id || !activity_type || !title) {
        return json(
          { error: "agent_id, activity_type and title are required" },
          400
        );
      }

      // O plugin da VPS manda tool_name/tool_input no topo do corpo e esta
      // função os DESCARTAVA — sobrava só o título em texto livre. Sem o
      // tool_name estruturado, a war room não tinha como saber que "💬
      // Enviando mensagem para Kira" era uma conversa agente→agente (o fio
      // que faltava em 02/08). Entram no metadata: dado, não decoração.
      const { tool_name, tool_input } = body as Record<string, unknown>;
      const meta = {
        ...((metadata as Record<string, unknown> | null) || {}),
        ...(tool_name ? { tool_name: String(tool_name) } : {}),
        ...(tool_input ? { tool_input: String(tool_input) } : {}),
      };

      const insertRow = {
        agent_id: String(agent_id),
        activity_type: String(activity_type),
        title: String(title),
        status: (status as string) || "running",
        steps: Array.isArray(steps) ? steps : [],
        user_id: (user_id as string | null) || null,
        channel: (channel as string | null) || null,
        metadata: meta,
      };

      const { data, error } = await admin
        .from("agent_activity")
        .insert(insertRow)
        .select("id, created_at")
        .single();

      if (error) return json({ error: error.message }, 500);
      return json(data, 201);
    }

    if (action === "update") {
      const { id, status, steps, result, title, metadata } = body as Record<
        string,
        unknown
      >;
      if (!id) return json({ error: "id is required" }, 400);

      const patch: Record<string, unknown> = {};
      if (typeof status === "string") patch.status = status;
      if (Array.isArray(steps)) patch.steps = steps;
      if (result !== undefined) patch.result = result;
      if (typeof title === "string") patch.title = title;
      if (metadata && typeof metadata === "object") patch.metadata = metadata;

      if (Object.keys(patch).length === 0) {
        return json({ error: "No fields to update" }, 400);
      }

      const { data, error } = await admin
        .from("agent_activity")
        .update(patch)
        .eq("id", String(id))
        .select("id, updated_at")
        .single();

      if (error) return json({ error: error.message }, 500);
      return json(data, 200);
    }

    return json({ error: "Unknown action. Use 'start' or 'update'." }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
