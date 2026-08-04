// Idempotent seed of default agents into OpenClaw + Lia briefing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface AgentTemplate {
  identity: string;
  soul: string;
}

const TEMPLATES: Record<string, AgentTemplate> = {
  milo: {
    identity: `# Milo — Diretor de Tráfego Pago
- Name: Milo
- Role: Diretor de Tráfego Pago
- Specialty: Meta Ads, Google Ads, performance, ROI
- Leader: {{LEADER_NAME}}
- Company: {{COMPANY_NAME}}`,
    soul: `# SOUL — Milo
Você é Milo, Diretor de Tráfego Pago de {{COMPANY_NAME}}.
Responde para {{LEADER_NAME}} e {{FOUNDER_NAME}}.
Especialidade: Meta Ads, Google Ads, TikTok Ads, análise de performance e ROI.
Tom: direto, analítico, orientado a números. Vai ao ponto.
Regras:
- Nunca invente dados — se não tem informação, diz que não tem
- Sempre responde com métricas, comparativos e próximos passos concretos
- Responde em português do Brasil
- Nunca use emojis`,
  },
  kira: {
    identity: `# Kira — Diretora de Conteúdo
- Name: Kira
- Role: Diretora de Conteúdo
- Specialty: Content waterfall, redes sociais, calendário editorial
- Leader: {{LEADER_NAME}}
- Company: {{COMPANY_NAME}}`,
    soul: `# SOUL — Kira
Você é Kira, Diretora de Conteúdo de {{COMPANY_NAME}}.
Especialidade: criação e curadoria de conteúdo multiplataforma (Instagram, LinkedIn, YouTube, TikTok), calendário editorial, análise de concorrência, briefs criativos.
Tom: estratégica, criativa, orientada a resultado de conteúdo.
Regras:
- Sempre considera os objetivos de negócio ao criar conteúdo
- Briefs devem ser claros e acionáveis
- Responde em português do Brasil
- Nunca use emojis`,
  },
  rock: {
    identity: `# Rock — Diretor de Vendas
- Name: Rock
- Role: Diretor de Vendas
- Specialty: Funil comercial, análise de vendas, estratégia comercial
- Leader: {{LEADER_NAME}}
- Company: {{COMPANY_NAME}}`,
    soul: `# SOUL — Rock
Você é Rock, Diretor de Vendas de {{COMPANY_NAME}}.
Especialidade: análise de funil comercial, revisão de calls de vendas, diagnóstico de objeções, estratégia comercial.
Tom: direto, estratégico, focado em fechamento e resultado.
Regras:
- Sempre identifica o gargalo antes de sugerir solução
- Scripts devem soar naturais, não robóticos
- Responde em português do Brasil
- Nunca use emojis`,
  },
  sigma: {
    identity: `# Sigma — Estrategista & Copywriter
- Name: Sigma
- Role: Estrategista & Copywriter
- Specialty: Copy de vendas, posicionamento, landing pages
- Leader: {{LEADER_NAME}}
- Company: {{COMPANY_NAME}}`,
    soul: `# SOUL — Sigma
Você é Sigma, Estrategista e Copywriter de {{COMPANY_NAME}}.
Especialidade: textos persuasivos, headlines, roteiros de anúncios, landing pages, posicionamento de marca.
Tom de voz da empresa: {{BRAND_VOICE}}
Tom: persuasivo, preciso, alinhado à voz da marca.
Regras:
- Todo texto tem um objetivo claro: converter, informar ou engajar
- Sempre alinha o copy ao posicionamento e tom da empresa
- Responde em português do Brasil
- Nunca use emojis`,
  },
  radar: {
    identity: `# Radar — Pesquisa & Inteligência
- Name: Radar
- Role: Analista de Inteligência de Mercado
- Specialty: Mercado, concorrência, tendências, benchmarking
- Leader: {{LEADER_NAME}}
- Company: {{COMPANY_NAME}}`,
    soul: `# SOUL — Radar
Você é Radar, Analista de Inteligência de {{COMPANY_NAME}}.
Especialidade: pesquisa de mercado, análise de concorrência, mapeamento de tendências, briefings executivos.
Tom: analítico, estruturado, preciso. Relatórios claros com fontes.
Regras:
- Sempre indica a base das informações
- Distingue dado confirmado de especulação
- Alimenta Milo, Kira e Rock com dados externos quando solicitado
- Responde em português do Brasil
- Nunca use emojis`,
  },
};

function buildSeedBriefing(
  agents: Array<{ agent_id: string; name: string }>,
  leaderName: string,
): string {
  const blocks = agents
    .filter((a) => TEMPLATES[a.agent_id])
    .map((a) => {
      const t = TEMPLATES[a.agent_id];
      return `## ${a.name} (workspace: ${a.agent_id})

### IDENTITY.md
\`\`\`
${t.identity}
\`\`\`

### SOUL.md
\`\`\`
${t.soul}
\`\`\``;
    })
    .join("\n\n---\n\n");

  return `🚀 SETUP INICIAL DO dn.os — CRIAÇÃO EM LOTE DE AGENTES PADRÃO

⚠️ INSTRUÇÃO CRÍTICA: você (${leaderName}) DEVE executar as ferramentas (SSH/file write) para criar TODOS os arquivos no VPS. Não responda apenas com texto descrevendo o que faria — EXECUTE em sequência e reinicie o gateway UMA ÚNICA VEZ ao final.

Os workspaces dos agentes abaixo já foram registrados via agents.create RPC. Falta criar os arquivos .md de cada um e reiniciar o gateway.

Para cada agente abaixo:
1. Crie o workspace /root/.openclaw/agents/<workspace>/
2. Escreva IDENTITY.md com o conteúdo fornecido (mantenha os placeholders {{COMPANY_NAME}}, {{FOUNDER_NAME}}, {{LEADER_NAME}}, {{BRAND_VOICE}} literais — serão substituídos depois pelo onboarding)
3. Escreva SOUL.md com o conteúdo fornecido (mesma regra sobre placeholders)
4. Crie MEMORY.md vazio
5. Crie HEARTBEAT.md com status inicial

Ao terminar TODOS os agentes:
- Atualize /root/.openclaw/AGENTS_DIRECTORY.md listando os novos agentes
- Reinicie o gateway UMA ÚNICA VEZ para carregar tudo
- Confirme com um resumo do que foi criado

---

${blocks}

---

Capricha e executa em lote — não pule a execução das ferramentas.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Remix gate: this function bootstraps the 8 original dn.ia SOULs.
  // In remix deployments the wizard seeds from public.agent_templates instead.
  if (Deno.env.get("REMIX_MODE") === "true") {
    return ok({ skipped: true, reason: "remix_mode" });
  }



  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Idempotency check
    const { data: configRow } = await supabase
      .from("setup_config")
      .select("id, seed_completed")
      .limit(1)
      .maybeSingle();

    if (configRow?.seed_completed) {
      return ok({ skipped: true, reason: "already_seeded" });
    }

    // 2. Gateway config
    const gateway = await getGatewayConfig(supabase);
    if (!gateway.token) {
      return ok({ error: "Gateway token not configured" }, 500);
    }
    const RPC = `${gateway.url}/api/v1/admin/rpc`;
    const CHAT = `${gateway.url}/v1/chat/completions`;

    // 3. List existing OpenClaw agents
    const existingIds = new Set<string>();
    try {
      const listRes = await fetch(RPC, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gateway.token}`,
        },
        body: JSON.stringify({ method: "agents.list", params: {} }),
      });
      if (listRes.ok) {
        const json = await listRes.json();
        const list: any[] =
          json?.result?.agents ?? json?.agents ?? json?.result ?? [];
        for (const a of Array.isArray(list) ? list : []) {
          const ws = String(a.workspace ?? a.id ?? a.agent_id ?? "").trim();
          if (ws) existingIds.add(ws);
        }
      }
    } catch (e) {
      console.log(`[seed-agents] list failed: ${(e as Error).message}`);
    }

    // 4. Supabase agents not yet in OpenClaw
    const { data: agents, error: agentsErr } = await supabase
      .from("agent_profiles")
      .select("agent_id, name");
    if (agentsErr) return ok({ error: agentsErr.message }, 500);

    const toCreate = (agents ?? []).filter(
      (a) => a.agent_id && !existingIds.has(a.agent_id),
    );

    // 5. Create each in OpenClaw
    const created: string[] = [];
    const errors: Array<{ id: string; error: string }> = [];
    for (const agent of toCreate) {
      try {
        const res = await fetch(RPC, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${gateway.token}`,
          },
          body: JSON.stringify({
            method: "agents.create",
            params: { name: agent.name, workspace: agent.agent_id },
          }),
        });
        if (res.ok) {
          created.push(agent.agent_id);
        } else {
          const raw = await res.text();
          const lower = raw.toLowerCase();
          if (lower.includes("already exists") || lower.includes("exists")) {
            created.push(agent.agent_id);
          } else {
            errors.push({ id: agent.agent_id, error: raw.slice(0, 200) });
          }
        }
      } catch (e) {
        errors.push({ id: agent.agent_id, error: (e as Error).message });
      }
    }

    // 6. Find leader (NEVER hardcode)
    const { data: leader } = await supabase
      .from("agent_profiles")
      .select("agent_id, name")
      .eq("is_leader", true)
      .limit(1)
      .maybeSingle();

    // 7. Briefing to orchestrator
    let liaNotified = false;
    if (leader && created.length > 0) {
      const briefing = buildSeedBriefing(
        toCreate.filter((a) => created.includes(a.agent_id)),
        leader.name ?? leader.agent_id,
      );
      const notify = async () => {
        try {
          await fetch(CHAT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${gateway.token}`,
            },
            body: JSON.stringify({
              model: `openclaw:${leader.agent_id}`,
              messages: [{ role: "user", content: briefing }],
              user: `system:seed-agents:${Date.now()}`,
              stream: false,
            }),
          });
        } catch (e) {
          console.log(`[seed-agents] leader notify failed: ${(e as Error).message}`);
        }
      };
      // @ts-ignore - EdgeRuntime is available in Supabase
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(notify());
      } else {
        notify().catch(() => {});
      }
      liaNotified = true;
    }

    // 8. Mark completed
    const completedAt = new Date().toISOString();
    if (configRow?.id) {
      await supabase
        .from("setup_config")
        .update({
          seed_completed: true,
          seed_completed_at: completedAt,
        })
        .eq("id", configRow.id);
    } else {
      await supabase.from("setup_config").insert({
        seed_completed: true,
        seed_completed_at: completedAt,
      });
    }

    return ok({
      success: true,
      created,
      errors,
      leader_notified: liaNotified,
    });
  } catch (e) {
    return ok({ error: (e as Error).message }, 500);
  }
});
