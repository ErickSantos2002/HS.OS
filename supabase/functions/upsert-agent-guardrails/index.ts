// Endpoint dedicado para o agente orquestrador cadastrar guardrails dos agentes.
// Autenticação via GUARDRAILS_API_TOKEN (Bearer). Não usa JWT de usuário.
//
// O segredo é lido por authorizeWithSecret: banco primeiro, variável de ambiente
// como fallback. Instalação existente (que tem o valor no ambiente) continua
// funcionando; remix novo recebe o valor pelo bloco do instalador e o guarda em
// integration_secrets. Ver supabase/functions/_shared/integration-secret.ts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { authorizeWithSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GuardrailSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  category: z.string().min(1).max(80),
  status: z.enum(["active", "inactive"]),
});

const BodySchema = z.object({
  agent_id: z.string().min(1).max(120),
  guardrails: z.array(GuardrailSchema).max(200),
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

  // O client sobe antes da autenticação porque o segredo agora pode vir do
  // banco (ver integration-secret.ts). É o mesmo client usado adiante.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await authorizeWithSecret(supabase, req, "GUARDRAILS_API_TOKEN"))) {
    return json({ error: "Unauthorized" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }
  const { agent_id, guardrails } = parsed.data;

  const { data: existing, error: selErr } = await supabase
    .from("agent_profiles")
    .select("agent_id")
    .eq("agent_id", agent_id)
    .maybeSingle();
  if (selErr) return json({ error: selErr.message }, 500);
  if (!existing) return json({ error: `agent_profile not found for agent_id=${agent_id}` }, 404);

  const { error: updErr } = await supabase
    .from("agent_profiles")
    .update({ guardrails, updated_at: new Date().toISOString() })
    .eq("agent_id", agent_id);
  if (updErr) return json({ error: updErr.message }, 500);

  return json({ success: true, agent_id, count: guardrails.length });
});
