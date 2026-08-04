// Resend the onboarding briefing to Lia for an existing agent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LIA_SESSION = "agent:lia:mc:0ea848ab-ae43-439f-b878-9fd335f8f04a";


function err(message: string, status = 500) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST required", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return err("Missing Authorization", 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const gateway = await getGatewayConfig(admin);
  const token = gateway.token;
  const OPENCLAW_CHAT = `${gateway.url}/v1/chat/completions`;
  if (!token) return err("Gateway token not configured");

  // Auth path A: system-to-system via GUARDRAILS_API_TOKEN
  // Auth path B: user JWT with super_admin role
  const systemToken = (await getIntegrationSecret(admin, "GUARDRAILS_API_TOKEN")) ?? "";
  let callerLabel = "system";
  let callerUserId: string | null = null;
  if (systemToken && jwt === systemToken) {
    callerLabel = "guardrails-token";
  } else {
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return err("Invalid token", 401);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "super_admin",
    });
    if (!isAdmin) return err("Only super_admin can resend briefing", 403);
    callerUserId = userData.user.id;
    callerLabel = userData.user.email ?? userData.user.id;
  }

  let body: { agent_id?: string } = {};
  try { body = await req.json(); } catch { return err("Invalid JSON", 400); }
  const agentId = body.agent_id?.trim();
  if (!agentId) return err("agent_id required", 400);

  const { data: agent, error: agentErr } = await admin
    .from("agent_profiles")
    .select("*")
    .eq("agent_id", agentId)
    .maybeSingle();
  if (agentErr) return err(agentErr.message);
  if (!agent) return err("Agent not found", 404);

  const integrationNames = (agent.integrations_used && agent.integrations_used.length > 0)
    ? agent.integrations_used.join(", ")
    : "Nenhuma selecionada";

  const cronSection = agent.crons_description
    ? `AUTOMAÇÕES:\n"${agent.crons_description}"`
    : "Sem automações configuradas.";

  const message =
    `🤖 REENVIO DE BRIEFING — REEXECUTE O ONBOARDING DO AGENTE ${agent.name}\n\n` +
    `⚠️ INSTRUÇÃO CRÍTICA: você DEVE executar as ferramentas (SSH/file write) para criar/atualizar os arquivos no VPS. NÃO responda apenas com texto — EXECUTE. Ao final, liste cada arquivo criado/atualizado com o caminho completo.\n\n` +
    `Dados técnicos:\n` +
    `- ID: ${agent.agent_id}\n` +
    `- Nome: ${agent.name} ${agent.emoji ?? ""}\n` +
    `- Modelo: ${agent.model}\n` +
    `- Workspace: ${agent.workspace}\n` +
    `- Canais: ${(agent.channels ?? ["webchat"]).join(", ")}\n\n` +
    `Especialidade: ${agent.specialty || agent.skills_description || "Não definida"}\n` +
    `Tags: ${(agent.skills_tags || []).join(", ") || "Nenhuma"}\n` +
    `Integrações: ${integrationNames}\n\n` +
    `PERSONA:\n"${agent.persona_description || "Não definida — use a especialidade como referência"}"\n\n` +
    `Restrições:\n"${agent.behavior_restrictions || agent.behavior || "Nenhuma definida"}"\n\n` +
    `${cronSection}\n\n` +
    `Verifique se SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md, MEMORY.md e HEARTBEAT.md existem no workspace ${agent.workspace}. Se não existirem, crie. Se existirem mas estiverem incompletos, atualize. Confirme no AGENTS_DIRECTORY.md, reinicie o gateway e mande mensagem para o Rodrigo (session ${LIA_SESSION}) com a lista de arquivos criados/atualizados.`;

  const liaSession = `system:resend-briefing:${agentId}:${Date.now()}`;

  let logId: string | null = null;
  try {
    const { data: logRow } = await admin
      .from("agent_creation_log")
      .insert({
        agent_id: agentId,
        created_by: callerUserId,
        briefing: message,
        lia_session: liaSession,
        status: "sent",
      })
      .select("id")
      .single();
    logId = logRow?.id ?? null;
  } catch (e) {
    console.log(`[resend-agent-briefing] audit insert failed: ${(e as Error).message}`);
  }

  const notifyLia = async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
      const liaRes = await fetch(OPENCLAW_CHAT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: "openclaw:lia",
          messages: [{ role: "user", content: message }],
          user: liaSession,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const liaBody = await liaRes.text();
      console.log(`[resend-agent-briefing] Lia responded: ${liaRes.status}`);
      if (logId) {
        await admin.from("agent_creation_log").update({
          lia_http_status: liaRes.status,
          lia_response: liaBody.slice(0, 8000),
          status: liaRes.ok ? "responded" : "failed",
          responded_at: new Date().toISOString(),
        }).eq("id", logId);
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`[resend-agent-briefing] Lia fetch failed: ${msg}`);
      if (logId) {
        await admin.from("agent_creation_log").update({
          lia_error: msg,
          status: msg.toLowerCase().includes("abort") ? "timeout" : "failed",
          responded_at: new Date().toISOString(),
        }).eq("id", logId);
      }
    }
  };

  // @ts-ignore - EdgeRuntime available in Supabase
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(notifyLia());
  } else {
    notifyLia().catch(() => {});
  }

  return new Response(
    JSON.stringify({ success: true, log_id: logId, agent_id: agentId }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
