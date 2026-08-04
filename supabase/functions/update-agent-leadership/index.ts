// Update agent leadership: sets leader_id on agent and notifies the leader
// (orchestrator) to update its IDENTITY.md and the led agent's IDENTITY.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


interface Body {
  agent_id: string;
  leader_id: string | null;
  agent_name?: string;
  agent_emoji?: string;
  previous_leader_id?: string | null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "POST required" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON" }, 400);
  }

  const { agent_id, leader_id, agent_name, agent_emoji, previous_leader_id } = body;
  if (!agent_id) return json({ success: false, error: "agent_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Persist leader_id
  const { error: upErr } = await supabase
    .from("agent_profiles")
    .update({ leader_id: leader_id ?? null, updated_at: new Date().toISOString() })
    .eq("agent_id", agent_id);
  if (upErr) return json({ success: false, error: upErr.message });

  const gateway = await getGatewayConfig(supabase);
  const token = gateway.token;
  const OPENCLAW_CHAT = `${gateway.url}/v1/chat/completions`;
  if (!token) return json({ success: true, warning: "Gateway token not configured, skipped notify" });

  // Helper to push a message to an orchestrator agent
  const notify = async (leaderRow: { agent_id: string; name: string | null; emoji: string | null }, message: string) => {
    try {
      const session = `system:leadership:${leaderRow.agent_id}:${Date.now()}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch(OPENCLAW_CHAT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: `openclaw:${leaderRow.agent_id}`,
          messages: [{ role: "user", content: message }],
          user: session,
          stream: false,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      console.log(`[update-agent-leadership] notified ${leaderRow.agent_id}: ${res.status}`);
    } catch (e) {
      console.log(`[update-agent-leadership] notify ${leaderRow.agent_id} failed: ${(e as Error).message}`);
    }
  };

  // 2. If previous leader changed/removed, notify it to remove from list
  if (previous_leader_id && previous_leader_id !== leader_id) {
    const { data: prev } = await supabase
      .from("agent_profiles")
      .select("agent_id, name, emoji")
      .eq("agent_id", previous_leader_id)
      .maybeSingle();
    if (prev) {
      const removeMsg =
        `ATUALIZAÇÃO DE LIDERANÇA:\n\n` +
        `O agente ${agent_emoji ?? ""} ${agent_name ?? agent_id} (ID: ${agent_id}) ` +
        `não está mais sob sua coordenação direta.\n\n` +
        `Por favor:\n` +
        `1. No seu IDENTITY.md, remova a referência a este agente da seção "## Super agentes sob sua coordenação".\n` +
        `2. Confirme quando concluído.`;
      // fire and forget
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(notify(prev, removeMsg));
      } else {
        notify(prev, removeMsg).catch(() => {});
      }
    }
  }

  // 3. If no new leader, we're done
  if (!leader_id) return json({ success: true });

  // 4. Load new leader data
  const { data: leader } = await supabase
    .from("agent_profiles")
    .select("agent_id, name, emoji")
    .eq("agent_id", leader_id)
    .maybeSingle();
  if (!leader) return json({ success: false, error: "Leader not found" }, 404);

  const message =
    `CONFIGURAÇÃO DE LIDERANÇA:\n\n` +
    `Um agente foi vinculado à sua coordenação: ${agent_emoji ?? ""} ${agent_name ?? agent_id} (ID: ${agent_id}).\n\n` +
    `Por favor, faça o seguinte:\n` +
    `1. Acesse o workspace do agente ${agent_name ?? agent_id} em /root/.openclaw/workspace-${agent_id}/\n` +
    `2. No arquivo IDENTITY.md desse agente, adicione (se ainda não existir) a seção:\n\n` +
    `## Estrutura de Liderança\n` +
    `Seu orquestrador direto é ${leader.emoji ?? ""} ${leader.name ?? leader.agent_id}. ` +
    `Em decisões estratégicas, conflitos de prioridade ou dúvidas sobre direcionamento, consulte-o.\n\n` +
    `3. No SEU próprio IDENTITY.md (${leader.name ?? leader.agent_id}), adicione ou atualize:\n\n` +
    `## Super agentes sob sua coordenação\n` +
    `- ${agent_emoji ?? ""} ${agent_name ?? agent_id} (${agent_id})\n\n` +
    `4. Confirme quando concluído.`;

  // @ts-ignore
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(notify(leader, message));
  } else {
    notify(leader, message).catch(() => {});
  }

  return json({ success: true, leader_id, agent_id });
});
