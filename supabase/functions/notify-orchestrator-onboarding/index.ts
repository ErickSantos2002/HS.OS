// Notify the orchestrator (is_leader = true) to write COMPANY.md into every agent's workspace.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { data: profile } = await supabase
      .from("company_profile")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!profile?.company_name || !profile?.founder_name) {
      return new Response(
        JSON.stringify({ dispatched: false, reason: "Campos essenciais ausentes" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: orchestrator } = await supabase
      .from("agent_profiles")
      .select("agent_id, name")
      .eq("is_leader", true)
      .limit(1)
      .maybeSingle();

    if (!orchestrator) {
      return new Response(
        JSON.stringify({ dispatched: false, reason: "Nenhum orquestrador (is_leader=true)" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { url: gatewayUrl, token: gatewayToken } = await getGatewayConfig(supabase);

    const lines = [
      "# Empresa",
      "",
      `**Nome:** ${profile.company_name}`,
      `**Fundador / CEO:** ${profile.founder_name}`,
      profile.segment ? `**Segmento:** ${profile.segment}` : "",
      profile.description ? `**Descrição:** ${profile.description}` : "",
      profile.target_audience ? `**Público-alvo:** ${profile.target_audience}` : "",
      profile.products_services ? `**Produtos/Serviços:** ${profile.products_services}` : "",
      profile.revenue ? `**Faturamento:** ${profile.revenue}` : "",
      profile.employees_count ? `**Funcionários:** ${profile.employees_count}` : "",
      profile.tone ? `**Tom de comunicação:** ${profile.tone}` : "",
      profile.extra_context ? `\n**Contexto adicional:**\n${profile.extra_context}` : "",
    ].filter(Boolean);
    const companyMd = lines.join("\n").trim();

    const orchestratorPrompt = `Você precisa atualizar o contexto de todos os agentes do time com as informações da empresa cliente.

Siga estes passos:
1. Leia o arquivo de configuração do OpenClaw em ~/.openclaw/openclaw.json para obter a lista de agentes e seus workspaces
2. Para cada agente listado em agents.list, escreva ou sobrescreva o arquivo COMPANY.md no workspace desse agente com o conteúdo abaixo
3. Confirme quando todos os arquivos tiverem sido escritos

Conteúdo do COMPANY.md a ser escrito em cada workspace:

---
${companyMd}
---

Este arquivo será injetado automaticamente no contexto de cada agente e permitirá que eles conheçam a empresa para qual trabalham.`;

    const jobName = `onboarding-${Date.now()}`;

    const dispatchRes = await fetch(`${gatewayUrl}/api/v1/admin/rpc`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: jobName,
        method: "cron.add",
        params: {
          name: jobName,
          schedule: { kind: "at", at: new Date(Date.now() + 5000).toISOString() },
          sessionTarget: "isolated",
          agentId: orchestrator.agent_id,
          payload: {
            kind: "agentTurn",
            message: orchestratorPrompt,
            timeoutSeconds: 300,
          },
          deleteAfterRun: true,
        },
      }),
    });

    if (!dispatchRes.ok) {
      const err = await dispatchRes.text();
      return new Response(
        JSON.stringify({ dispatched: false, error: `Gateway: ${err.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await supabase
      .from("company_profile")
      .update({ onboarding_notified_at: new Date().toISOString() })
      .eq("id", profile.id);

    return new Response(
      JSON.stringify({
        dispatched: true,
        orchestratorId: orchestrator.agent_id,
        orchestratorName: orchestrator.name,
        jobName,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
