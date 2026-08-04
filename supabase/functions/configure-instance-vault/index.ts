// Auto-configura os secrets do Vault desta instância a partir das env vars
// auto-gerenciadas do próprio projeto (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
// Chamada pelo wizard de setup — remix passa a ter project_url/service_role_key
// no Vault sem o cliente setar nada à mão. Idempotente.
//
// Só super_admin pode chamar. A escrita no Vault é feita pela função de banco
// public.upsert_platform_vault (restrita a service_role).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } =
      await supabaseUser.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: roleCheck } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "super_admin")
      .maybeSingle();

    if (!roleCheck) {
      return json({ error: "Only super_admin can configure the instance" }, 403);
    }

    const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!projectUrl) {
      return json({ error: "SUPABASE_URL not available in this environment" }, 500);
    }

    const { error: rpcError } = await supabaseAdmin.rpc("upsert_platform_vault", {
      _project_url: projectUrl,
      _service_role_key: serviceKey,
    });
    if (rpcError) {
      return json({ error: `Vault upsert failed: ${rpcError.message}` }, 500);
    }

    return json({ ok: true, configured: ["project_url", "service_role_key", "email_queue_service_role_key"] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
