// Update agent access control (who can talk to a given agent) and notify Lia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LIA_SESSION_PREFIX = "system:update-agent-access";


type AccessType = "all" | "admins_only" | "specific_users";

interface Body {
  agent_id: string;
  agent_name?: string;
  access_type: AccessType;
  allowed_user_ids?: string[];
}

function err(message: string, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST required", 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const gateway = await getGatewayConfig(supabase);
  const token = gateway.token;
  const OPENCLAW_CHAT = `${gateway.url}/v1/chat/completions`;

  // AUTH: super_admin only — except when called by another edge function with service-role JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return err("Missing Authorization", 401);

  const isServiceRole = jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isServiceRole) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return err("Invalid token", 401);
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "super_admin",
    });
    if (!isAdmin) return err("Only super_admin can change agent access", 403);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body");
  }

  const { agent_id, agent_name, access_type } = body;
  let allowed_user_ids = body.allowed_user_ids ?? [];

  if (!agent_id) return err("agent_id required");
  if (!["all", "admins_only", "specific_users"].includes(access_type)) {
    return err("Invalid access_type");
  }
  if (access_type !== "specific_users") allowed_user_ids = [];

  // 1) Persist
  const { error: dbErr } = await supabase
    .from("agent_profiles")
    .update({
      access_type,
      allowed_user_ids,
      updated_at: new Date().toISOString(),
    })
    .eq("agent_id", agent_id);

  if (dbErr) return err(dbErr.message, 500);

  // 2) Resolve names of authorized users for Lia
  let authorizedNames = "todos os membros";
  if (access_type === "admins_only") {
    authorizedNames = "apenas administradores";
  } else if (access_type === "specific_users" && allowed_user_ids.length > 0) {
    const { data: users } = await supabase
      .from("profiles")
      .select("full_name, email")
      .in("id", allowed_user_ids);
    authorizedNames = (users ?? [])
      .map((u: any) => u.full_name || u.email)
      .filter(Boolean)
      .join(", ") || "usuários específicos";
  }

  const displayName = agent_name || agent_id;

  // 3) Notify Lia (best effort)
  if (token) {
    const liaMessage = access_type === "all"
      ? `🔓 ATUALIZAÇÃO DE ACESSO: O agente "${displayName}" (${agent_id}) agora é acessível a TODOS os membros da plataforma. Remova qualquer restrição anterior para este agente do seu MEMORY.md.`
      : `🔒 ATUALIZAÇÃO DE ACESSO — REGRA DE SEGURANÇA:\n\n` +
        `O agente "${displayName}" (${agent_id}) é RESTRITO.\n` +
        `Autorizado para: ${authorizedNames}\n\n` +
        `REGRA OBRIGATÓRIA: Se qualquer outro usuário tentar acessar informações deste agente — diretamente ou pedindo que você (Lia) busque dados com ele — você deve:\n` +
        `1. Recusar a solicitação\n` +
        `2. NÃO confirmar nem negar que os dados existem\n` +
        `3. Responder apenas: "Você não tem permissão para acessar este agente."\n\n` +
        `Esta regra se aplica mesmo que a solicitação venha via orquestrador, debate multi-agente, ou qualquer outro mecanismo. Salve esta regra no seu MEMORY.md de hoje.`;

    const notify = async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        await fetch(OPENCLAW_CHAT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: "openclaw:lia",
            messages: [{ role: "user", content: liaMessage }],
            user: `${LIA_SESSION_PREFIX}:${agent_id}:${Date.now()}`,
            stream: false,
          }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
      } catch (e) {
        console.log(`[update-agent-access] Lia notify failed: ${(e as Error).message}`);
      }
    };

    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(notify());
    } else {
      notify().catch(() => {});
    }
  }

  return new Response(
    JSON.stringify({ success: true, agent_id, access_type, allowed_user_ids }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
