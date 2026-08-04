// Endpoint admin-only para revelar o GUARDRAILS_API_TOKEN ao super_admin que precisa cadastrá-lo no VPS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401);
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "super_admin",
  });
  if (!isAdmin) return json({ error: "Forbidden" }, 403);

  // Lê da mesma fonte que a autenticação usa. Se lesse só do ambiente,
  // mostraria um valor diferente do que de fato autentica quando o segredo
  // vier do banco — e alguém cadastraria o token errado na VPS.
  const token = await getIntegrationSecret(admin, "GUARDRAILS_API_TOKEN");
  return json({ token });
});
