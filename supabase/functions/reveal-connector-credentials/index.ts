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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "super_admin",
    });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const { integration_id } = await req.json().catch(() => ({}));
    if (!integration_id) return json({ error: "integration_id required" }, 400);

    const { data: row, error } = await supabase
      .from("integrations")
      .select("id, name, key_name, credentials, template_id")
      .eq("id", integration_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!row) return json({ error: "not found" }, 404);

    // Env-var-name → value map
    const byEnv: Record<string, string> = {};

    const pushEnv = (name: string | null | undefined) => {
      if (!name) return;
      const v = Deno.env.get(name);
      if (v) byEnv[name] = v;
    };

    // 1) Any stored credential entries with a key_name
    if (Array.isArray(row.credentials)) {
      for (const c of row.credentials as any[]) {
        const k = String(c?.key_name ?? c?.key ?? "").trim();
        if (k) pushEnv(k);
      }
    }

    // 2) Row-level key_name
    pushEnv(row.key_name);

    // 3) Template-based conventional keys: {TEMPLATE_UPPER}_{FIELD_UPPER}
    if (row.template_id) {
      const prefix = row.template_id.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      // Common field name suffixes to try
      const commonFields = [
        "API_KEY", "ACCESS_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN",
        "SECRET_KEY", "WEBHOOK_SECRET", "BOT_TOKEN", "ACCOUNT_SID", "AUTH_TOKEN",
        "PHONE_NUMBER_ID", "PAGE_ID", "AD_ACCOUNT_ID", "APP_ID", "BASE_URL", "TOKEN",
      ];
      for (const suffix of commonFields) pushEnv(`${prefix}_${suffix}`);
    }

    return json({ success: true, credentials: byEnv });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
