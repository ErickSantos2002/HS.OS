import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// NUNCA confiar no preview que o chamador manda: agente já enviou o token
// INTEIRO como key_preview, e essa coluna é legível por qualquer membro
// logado (está na allowlist de SELECT). Máscara aplicada AQUI, sempre.
function maskPreview(value: unknown): string | null {
  const v = (typeof value === "string" ? value : "").trim();
  if (!v) return null;
  if (v.includes("●")) return v; // já veio mascarado
  if (v.length <= 4) return "●".repeat(4);
  if (v.length <= 8) return `●●●●${v.slice(-4)}`;
  return `${v.slice(0, 4)}●●●●●●●●${v.slice(-4)}`;
}

async function checkToken(supabase: SupabaseClient, req: Request): Promise<boolean> {
  const expected = await getIntegrationSecret(supabase, "GUARDRAILS_API_TOKEN");
  if (!expected) return false;
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return !!token && token === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {

    // Client no topo: usado tanto pelo GET quanto pelo POST, e a autenticação
    // do GET agora precisa dele para ler o segredo.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // GET: list integrations (requires GUARDRAILS_API_TOKEN)
    if (req.method === "GET") {
      if (!(await checkToken(supabase, req))) return json({ error: "Unauthorized" }, 401);
      const { data, error } = await supabase
        .from("integrations")
        .select("id, name, category, key_name, key_preview, is_configured, agents_using, description, icon, integration_type, updated_at")
        .order("category")
        .order("name");
      if (error) return json({ error: error.message }, 400);
      return json({ success: true, integrations: data ?? [] });
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const {
      name,
      category,
      key_name,
      key_preview,
      agents_using,
      description,
      icon,
      added_by_agent,
      is_configured,
      integration_type,
      credentials,
      template_id,
    } = body ?? {};

    if (!name || !category || !key_name) {
      return json({ error: "name, category and key_name are required" }, 400);
    }

    // Merge incoming credentials with existing values so we never blank out a
    // stored secret when the UI only sends metadata (key_name/key_preview).
    // Look up existing row by name OR key_name (both are unique) so we update
    // in place instead of colliding on the unique constraint.
    let mergedCredentials: any[] = Array.isArray(credentials) ? credentials : [];
    const { data: existingRows } = await supabase
      .from("integrations")
      .select("id, name, key_name, credentials")
      .or(`name.eq.${name},key_name.eq.${key_name}`);
    const existing = (existingRows ?? [])[0];
    const existingCreds: any[] = Array.isArray(existing?.credentials)
      ? (existing!.credentials as any[])
      : [];
    if (existingCreds.length > 0 && mergedCredentials.length > 0) {
      mergedCredentials = mergedCredentials.map((c: any) => {
        if (c?.value) return c;
        const prev = existingCreds.find((p: any) => p?.key_name === c?.key_name);
        if (prev?.value) return { ...c, value: prev.value };
        return c;
      });
    }

    // If a top-level credential_value was provided (single-key shorthand),
    // attach it to the first credential entry.
    const credentialValue: string | undefined = body?.credential_value;
    if (credentialValue && mergedCredentials[0]) {
      mergedCredentials[0] = { ...mergedCredentials[0], value: credentialValue };
    }

    const hasRealValue = mergedCredentials.some((c: any) => !!c?.value);

    const payload = {
      name,
      category,
      key_name,
      key_preview: maskPreview(key_preview),
      agents_using: Array.isArray(agents_using) ? agents_using : [],
      description: description ?? null,
      icon: icon ?? "🔑",
      added_by_agent: added_by_agent ?? null,
      is_configured: is_configured ?? hasRealValue,
      integration_type: integration_type ?? "api_key",
      credentials: mergedCredentials,
      template_id: template_id ?? null,
      updated_at: new Date().toISOString(),
    };

    const selectCols = "id, name, category, key_name, key_preview, is_configured, agents_using, description, icon, integration_type, updated_at";

    const { data, error } = existing
      ? await supabase.from("integrations").update(payload).eq("id", existing.id).select(selectCols).single()
      : await supabase.from("integrations").insert(payload).select(selectCols).single();

    if (error) return json({ error: error.message }, 400);
    return json({ success: true, integration: data });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
