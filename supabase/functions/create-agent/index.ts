// Create a new agent: register in OpenClaw, persist in agent_profiles, notify Lia.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * B23 (verificação real): confere se o onboarding REALMENTE aconteceu, lendo
 * SOUL.md do workspace no gateway — em vez de confiar em "o agente respondeu
 * texto" (que pode ser só "ok, vou fazer!" sem executar nada). Mesmo padrão
 * de leitura de workspace que o export-agent já usa.
 */
async function verifyAgentWorkspace(
  gatewayUrl: string,
  token: string,
  agentId: string,
): Promise<boolean> {
  try {
    const url = `${gatewayUrl}/api/files/${encodeURIComponent(agentId)}/SOUL.md`;
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, 8000);
    if (!res.ok) return false;
    const text = await res.text();
    return !!(text && text.trim().length > 20);
  } catch {
    return false;
  }
}


interface Body {
  openclaw_id: string;
  name: string;
  emoji?: string;
  specialty: string;
  description?: string;
  model: string;
  workspace: string;
  channels: string[];
  behavior?: string;
  // New fields (all optional)
  skills_description?: string;
  skills_tags?: string[];
  integrations_used?: string[];
  persona_description?: string;
  behavior_restrictions?: string;
  crons_description?: string;
  lia_onboarding?: boolean;
  access_type?: "all" | "admins_only" | "specific_users";
  allowed_user_ids?: string[];
  leader_id?: string | null;
}

function err(step: string, message: string, status = 500) {
  return new Response(
    JSON.stringify({ success: false, step, error: message }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("method", "POST required", 405);

  // AUTH: only super_admin can create agents
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return err("auth", "Missing Authorization", 401);

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return err("auth", "Invalid token", 401);
  const { data: isAdmin, error: roleErr } = await authClient.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "super_admin",
  });
  if (roleErr) return err("auth", roleErr.message, 500);
  if (!isAdmin) return err("auth", "Only super_admin can create agents", 403);

  const gateway = await getGatewayConfig(authClient);
  if (!gateway.token) return err("config", "Gateway token not configured (vps_config or OPENCLAW_ADMIN_TOKEN)");
  const token = gateway.token;
  const OPENCLAW_RPC = `${gateway.url}/api/v1/admin/rpc`;
  const OPENCLAW_CHAT = `${gateway.url}/v1/chat/completions`;


  let body: Body;
  try {
    body = await req.json();
  } catch {
    return err("parse", "Invalid JSON body", 400);
  }

  const {
    openclaw_id,
    name,
    emoji = "🤖",
    specialty,
    description = "",
    model,
    workspace,
    channels,
    behavior = "",
    skills_description = "",
    skills_tags = [],
    integrations_used = [],
    persona_description = "",
    behavior_restrictions = "",
    crons_description = "",
    lia_onboarding = true,
    access_type = "all",
    allowed_user_ids = [],
    leader_id = null,
  } = body;

  if (!openclaw_id || !/^[a-z0-9-]{2,32}$/.test(openclaw_id)) {
    return err("validation", "Invalid openclaw_id", 400);
  }
  if (!name || name.trim().length < 2) return err("validation", "Invalid name", 400);
  if (!specialty || specialty.trim().length < 5) return err("validation", "Invalid specialty", 400);
  if (!model) return err("validation", "Model is required", 400);
  if (!workspace) return err("validation", "Workspace is required", 400);
  if (!Array.isArray(channels) || channels.length < 1) {
    return err("validation", "At least one channel is required", 400);
  }

  // STEP 1 — OpenClaw
  console.log(`[create-agent] STEP 1: calling OpenClaw RPC for id=${openclaw_id}`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(OPENCLAW_RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        method: "agents.create",
        params: { name, workspace },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    console.log(`[create-agent] OpenClaw responded: ${res.status}`);
    if (!res.ok) {
      const raw = await res.text();
      console.log(`[create-agent] OpenClaw error body: ${raw}`);
      let parsed: any = {};
      try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
      const msg = parsed?.error?.message ?? parsed?.error ?? raw;
      const lower = String(msg).toLowerCase();
      if (!lower.includes("already exists") && !lower.includes("exists")) {
        return err("openclaw", `OpenClaw error: ${msg}`);
      }
    } else {
      await res.text();
    }
  } catch (e) {
    console.log(`[create-agent] OpenClaw fetch failed: ${(e as Error).message}`);
    return err("openclaw", (e as Error).message);
  }

  // STEP 2 — Supabase
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve o orquestrador via agent_templates.is_leader_template — nunca
  // hardcoded "lia" (a instância dn.ia usa Lia, mas um remix pode ter outro
  // líder). Mesmo padrão já usado em agent-task para o onboarding.
  const { data: leaderTemplate } = await supabase
    .from("agent_templates")
    .select("agent_id")
    .eq("is_leader_template", true)
    .maybeSingle();
  const orchestratorId = leaderTemplate?.agent_id ?? null;

  const { error: dbErr } = await supabase
    .from("agent_profiles")
    .upsert(
      {
        agent_id: openclaw_id,
        openclaw_id,
        name,
        emoji,
        specialty,
        description,
        workspace,
        channels,
        model,
        behavior,
        skills_description,
        skills_tags,
        integrations_used,
        persona_description,
        crons_description: crons_description || null,
        access_type: access_type || "all",
        allowed_user_ids: Array.isArray(allowed_user_ids) ? allowed_user_ids : [],
        leader_id: leader_id ?? null,
        status: "configuring",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "agent_id" },
    );

  if (dbErr) return err("supabase", dbErr.message);

  // STEP 3 — Notify Lia (best effort)
  const integrationNames = (integrations_used && integrations_used.length > 0)
    ? integrations_used.join(", ")
    : "Nenhuma selecionada";

  const cronSection = crons_description
    ? `AUTOMAÇÕES (configure os crons após criar o agente):\n"${crons_description}"`
    : "Sem automações configuradas.";

  const message = lia_onboarding
    ? `🤖 NOVO AGENTE CRIADO — EXECUTE ONBOARDING COMPLETO\n\n` +
      `⚠️ INSTRUÇÃO CRÍTICA: você DEVE executar as ferramentas (SSH/file write) para criar os arquivos no VPS. Não responda apenas com texto descrevendo o que faria — EXECUTE. Ao final, liste cada arquivo criado com o caminho completo.\n\n` +
      `Dados técnicos:\n` +
      `- ID: ${openclaw_id}\n` +
      `- Nome: ${name} ${emoji}\n` +
      `- Modelo: ${model}\n` +
      `- Workspace: ${workspace}\n` +
      `- Canais: ${channels?.join(", ") || "webchat"}\n\n` +
      `Especialidade: ${specialty || skills_description || "Não definida"}\n` +
      `Tags: ${(skills_tags || []).join(", ") || "Nenhuma"}\n` +
      `Integrações selecionadas: ${integrationNames}\n\n` +
      `PERSONA (base para SOUL.md e IDENTITY.md):\n` +
      `"${persona_description || "Não definida — use a especialidade como referência"}"\n\n` +
      `Restrições importantes:\n` +
      `"${behavior_restrictions || "Nenhuma definida"}"\n\n` +
      `${cronSection}\n\n` +
      `Execute TODOS os passos do AGENT_CREATION.md:\n` +
      `1. Crie o workspace ${workspace} no VPS\n` +
      `2. Escreva SOUL.md com a personalidade descrita acima — seja criativo e detalhado, capture a essência do agente\n` +
      `3. Escreva IDENTITY.md com missão, especialidade, tom de voz e exemplos de respostas\n` +
      `4. Escreva TOOLS.md listando as integrações: ${integrationNames}\n` +
      `5. Escreva AGENTS.md (relações com outros agentes da equipe)\n` +
      `6. Escreva MEMORY.md (vazio, pronto para uso)\n` +
      `7. Escreva HEARTBEAT.md (status inicial)\n` +
      `8. Atualize /root/.openclaw/AGENTS_DIRECTORY.md adicionando o novo agente\n` +
      `9. Configure os crons descritos acima no openclaw.json\n` +
      `10. Reinicie o gateway para carregar o novo agente\n` +
      `11. Ao final desta mensagem, resuma o que foi configurado e liste os arquivos criados com o caminho completo\n\n` +
      `Capricha no SOUL.md — é a alma do agente. NÃO pule a execução das ferramentas.`
    : `🤖 NOVO AGENTE CRIADO — CONFIGURAÇÃO BÁSICA\n\n` +
      `⚠️ EXECUTE as ferramentas (SSH) — não responda apenas com texto.\n\n` +
      `ID: ${openclaw_id} | Nome: ${name} ${emoji}\n` +
      `Workspace: ${workspace}\n` +
      `${cronSection}\n\n` +
      `Execute apenas os passos de infraestrutura do AGENT_CREATION.md (criar workspace, registrar no gateway, reiniciar). O usuário vai configurar os arquivos manualmente.`;

  // Fire-and-forget Lia notification (best effort, doesn't block response)
  console.log(`[create-agent] STEP 3: notifying Lia (background)`);
  const liaSession = `system:create-agent:${openclaw_id}:${Date.now()}`;

  // Audit: register briefing
  let logId: string | null = null;
  try {
    const { data: logRow } = await supabase
      .from("agent_creation_log")
      .insert({
        agent_id: openclaw_id,
        created_by: userData.user.id,
        briefing: message,
        lia_session: liaSession,
        status: "sent",
      })
      .select("id")
      .single();
    logId = logRow?.id ?? null;
  } catch (e) {
    console.log(`[create-agent] audit insert failed: ${(e as Error).message}`);
  }

  const notifyLia = async () => {
    if (!orchestratorId) {
      console.log("[create-agent] No leader agent_template configured — cannot dispatch onboarding.");
      if (logId) {
        await supabase.from("agent_creation_log").update({
          status: "failed",
          lia_error: "Nenhum agente líder configurado (agent_templates.is_leader_template) — onboarding não disparado.",
          responded_at: new Date().toISOString(),
        }).eq("id", logId);
      }
      return;
    }
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
          model: `openclaw:${orchestratorId}`,
          messages: [{ role: "user", content: message }],
          user: liaSession,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const liaBody = await liaRes.text();
      console.log(`[create-agent] Orchestrator responded: ${liaRes.status} body=${liaBody.slice(0, 500)}`);

      // B23 (verificação real): "respondeu texto" != "executou". Só marca como
      // sucesso se o SOUL.md realmente existir no workspace — evita agentes
      // "criados" só de fachada quando o orquestrador responde sem executar.
      let verified = false;
      let verifyNote = "";
      if (liaRes.ok) {
        verified = await verifyAgentWorkspace(gateway.url, token, openclaw_id);
        verifyNote = verified
          ? ""
          : " (respondeu, mas SOUL.md não foi encontrado no workspace — onboarding pode não ter sido executado)";
      }

      if (logId) {
        await supabase.from("agent_creation_log").update({
          lia_http_status: liaRes.status,
          lia_response: liaBody.slice(0, 8000),
          status: verified ? "responded" : "failed",
          lia_error: !liaRes.ok ? null : (verified ? null : `Verificação de workspace falhou${verifyNote}`),
          responded_at: new Date().toISOString(),
        }).eq("id", logId);
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`[create-agent] Lia fetch failed: ${msg}`);
      if (logId) {
        await supabase.from("agent_creation_log").update({
          lia_error: msg,
          status: msg.toLowerCase().includes("abort") ? "timeout" : "failed",
          responded_at: new Date().toISOString(),
        }).eq("id", logId);
      }
    }
  };

  // @ts-ignore - EdgeRuntime is available in Supabase Edge Runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(notifyLia());
  } else {
    notifyLia().catch(() => {});
  }

  // STEP 4 — If access restricted, fire update-agent-access (notifies Lia of the restriction)
  if (access_type && access_type !== "all") {
    const triggerAccess = async () => {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/update-agent-access`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            agent_id: openclaw_id,
            agent_name: name,
            access_type,
            allowed_user_ids: Array.isArray(allowed_user_ids) ? allowed_user_ids : [],
          }),
        });
      } catch (e) {
        console.log(`[create-agent] update-agent-access failed: ${(e as Error).message}`);
      }
    };
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(triggerAccess());
    } else {
      triggerAccess().catch(() => {});
    }
  }

  // STEP 5 — If a leader was selected, fire update-agent-leadership (notifies orchestrator)
  if (leader_id) {
    const triggerLeadership = async () => {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/update-agent-leadership`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            agent_id: openclaw_id,
            leader_id,
            agent_name: name,
            agent_emoji: emoji,
          }),
        });
      } catch (e) {
        console.log(`[create-agent] update-agent-leadership failed: ${(e as Error).message}`);
      }
    };
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(triggerLeadership());
    } else {
      triggerLeadership().catch(() => {});
    }
  }

  // B22: a notificação do orquestrador roda em background (fire-and-forget) —
  // nesse ponto ainda não sabemos se ele respondeu, muito menos se executou.
  // "true" incondicional mentia para o admin. O resultado real (responded/
  // failed/timeout, com verificação de workspace) fica em agent_creation_log,
  // já exibido pelo LiaOnboardingLog.
  return new Response(
    JSON.stringify({
      success: true,
      agent_id: openclaw_id,
      status: "configuring",
      lia_notified: "pending",
      lia_warning: orchestratorId
        ? null
        : "Nenhum agente líder configurado — o onboarding automático não será disparado. Configure os arquivos manualmente ou defina um líder em agent_templates.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
