/**
 * usage-sweep — mantém a janela de contexto de cada sessão viva (task #19/#3).
 *
 * Nasceu para medir consumo, mas a sonda de 30/07 encontrou fonte melhor: o
 * trajectory do gateway registra CADA chamada de LLM com modelo real, data,
 * divisão de cache e tokens de raciocínio. Contabilizar aqui também dobraria
 * a conta, então a medição de uso saiu e ficou o que só esta varredura vê:
 *
 *   contextTokens = TAMANHO da janela (1M no deepseek-v4-pro)
 *   totalTokens   = quanto da janela está ocupado
 *
 * É a fonte viva que a barra do chat precisava: ela mostrava 96% com o agente
 * em 4% porque lia um snapshot que a compactação nunca invalidava.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { kindFromSessionKey } from "../_shared/usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LIST_TIMEOUT_MS = 15_000;
const WINDOW_MINUTES = 180; // folga sobre o intervalo de 15min: sessão parada some da lista

interface GatewaySession {
  key?: string;
  agentId?: string;
  label?: string;
  displayName?: string;
  model?: string;
  totalTokens?: number;
  contextTokens?: number;
  estimatedCostUsd?: number;
}

async function listSessions(
  gateway: { url: string; token: string },
  agentId: string,
): Promise<GatewaySession[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const res = await fetch(`${gateway.url}/tools/invoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${gateway.token}`, "Content-Type": "application/json" },
      // `args`, não `arguments` — o gateway ignora `arguments` em silêncio.
      body: JSON.stringify({
        tool: "sessions_list",
        args: { agentId, limit: 100, activeMinutes: WINDOW_MINUTES },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const envelope = await res.json();
    const text = envelope?.result?.content?.[0]?.text;
    if (typeof text !== "string") return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  } catch (e) {
    console.warn(`[usage-sweep] sessions_list ${agentId}:`, e instanceof Error ? e.message : e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const gateway = await getGatewayConfig(supabase);
  if (!gateway.url || !gateway.token) {
    return Response.json({ ok: true, note: "gateway não configurado" });
  }

  const { data: profiles } = await supabase.from("agent_profiles").select("agent_id").limit(50);
  const agentIds = (profiles ?? [])
    .map((p: { agent_id: string }) => p.agent_id)
    .filter((id: string) => /^[a-z0-9-]{2,32}$/.test(id));

  let seen = 0, contextos = 0;

  for (const agentId of agentIds) {
    for (const s of await listSessions(gateway, agentId)) {
      const key = typeof s.key === "string" ? s.key : null;
      if (!key) continue;
      seen++;

      const tokens = Number(s.totalTokens) || 0;
      const cost = Number(s.estimatedCostUsd) || 0;
      const label = s.label ?? s.displayName ?? null;
      const model = s.model ?? null;
      const kind = kindFromSessionKey(key);

      // Janela de contexto: sempre o valor mais recente (resolve a #3).
      if (Number(s.contextTokens) > 0) {
        await supabase.from("agent_context_state").upsert({
          session_key: key,
          agent_id: s.agentId ?? agentId,
          model,
          total_tokens: tokens,
          context_tokens: Number(s.contextTokens),
          updated_at: new Date().toISOString(),
        }, { onConflict: "session_key" });
        contextos++;
      }

      // Consumo NÃO é mais gravado aqui: o trajectory registra a mesma
      // chamada com modelo real, divisão de cache e tokens de raciocínio, e é
      // importado pelo dnos-usage-push. Esta varredura ficou responsável só
      // pela janela de contexto (acima) — o que resolve a #3.
    }
  }

  // Higiene: sessão sem sinal há uma semana não volta.
  await supabase.from("agent_context_state")
    .delete()
    .lt("updated_at", new Date(Date.now() - 7 * 86400_000).toISOString());

  const summary = { ok: true, agentes: agentIds.length, sessoes: seen, contextos, ms: Date.now() - t0 };
  console.log("[usage-sweep]", JSON.stringify(summary));
  return Response.json(summary);
});
