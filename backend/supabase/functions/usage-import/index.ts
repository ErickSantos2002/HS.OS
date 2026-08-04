/**
 * usage-import — recebe eventos de uso lidos dos trajectory da VPS (task #19).
 *
 * O gateway registra cada chamada de LLM num arquivo local
 * (sessions/*.trajectory.jsonl) com modelo real, data e a divisão do cache —
 * mais preciso que qualquer coisa que a API exponha, e com histórico. O
 * OpenClaw não expõe uso agregado por API (sondado em 30/07: o painel Control
 * só chama 3 rotas, e admin-rpc recusa usage.get), então a VPS empurra.
 *
 * Idempotente por external_id: reenviar o mesmo lote não duplica a conta.
 * Nenhum conteúdo de conversa trafega — só medição.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { kindFromSessionKey } from "../_shared/usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface InEvent {
  external_id: string;
  ts: string;
  agent_id: string;
  session_key?: string | null;
  label?: string | null;
  model?: string | null;
  provider?: string | null;
  input?: number;
  output?: number;
  cache_read?: number;
  reasoning?: number;
  total?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // Tudo dentro de um try: uma exceção não tratada vira 500 SEM mensagem, e
  // do outro lado (VPS) sobra um traceback que não diz nada. Melhor devolver
  // o motivo — foi o que atrasou o diagnóstico do índice parcial.
  try {

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const expected = await getIntegrationSecret(supabase, "GUARDRAILS_API_TOKEN");
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!expected || bearer !== expected) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const events: InEvent[] = Array.isArray(body?.events) ? body.events : [];
  if (events.length === 0) return json({ ok: true, inseridos: 0 });
  if (events.length > 1000) return json({ error: "lote grande demais (máx 1000)" }, 400);

  // Preços numa consulta só — evita ida ao banco por evento.
  const { data: precos } = await supabase
    .from("model_pricing")
    .select("model, input_per_1m, output_per_1m, cached_input_per_1m");
  const tabela = new Map(
    (precos ?? []).map((p: Record<string, unknown>) => [p.model as string, p]),
  );

  const rows = [];
  for (const e of events) {
    if (!e?.external_id || !e?.ts || !e?.agent_id) continue;

    const cacheRead = Math.max(0, Number(e.cache_read) || 0);
    const fresh = Math.max(0, Number(e.input) || 0);
    const output = Math.max(0, Number(e.output) || 0);
    // `input` do trajectory já é o que NÃO veio de cache; a coluna guarda o
    // prompt inteiro, com o cache destacado à parte.
    const input = fresh + cacheRead;
    const total = Math.max(0, Number(e.total) || input + output);
    if (total <= 0) continue;

    let cost: number | null = null;
    const p = e.model ? tabela.get(e.model) : null;
    if (p) {
      const inP = Number(p.input_per_1m);
      const outP = Number(p.output_per_1m);
      const cachedP = p.cached_input_per_1m == null ? inP : Number(p.cached_input_per_1m);
      cost = Math.round(((fresh * inP + cacheRead * cachedP + output * outP) / 1_000_000) * 1_000_000) / 1_000_000;
    }

    rows.push({
      external_id: e.external_id,
      ts: e.ts,
      agent_id: e.agent_id,
      model: e.model ?? null,
      kind: kindFromSessionKey(e.session_key),
      session_key: e.session_key ?? null,
      label: e.label ?? null,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: cacheRead,
      total_tokens: total,
      cost_usd: cost,
      source: "trajectory",
      meta: {
        provider: e.provider ?? null,
        reasoning_tokens: Number(e.reasoning) || 0,
        ...(cost == null && e.model ? { cost_origin: "sem_preco_cadastrado" } : {}),
        ...(cost != null ? { cost_origin: "tabela" } : {}),
      },
    });
  }

  if (rows.length === 0) return json({ ok: true, inseridos: 0, nota: "nada aproveitável no lote" });

  // ignoreDuplicates: reenvio do mesmo trecho do arquivo é normal (a VPS
  // reprocessa a cauda) e não pode inflar a conta.
  const { error, data } = await supabase
    .from("usage_events")
    .upsert(rows, { onConflict: "external_id", ignoreDuplicates: true })
    .select("id");

  if (error) return json({ error: error.message }, 500);

  const inseridos = data?.length ?? 0;
  console.log(`[usage-import] recebidos=${events.length} validos=${rows.length} novos=${inseridos}`);
  return json({ ok: true, recebidos: events.length, inseridos });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[usage-import] erro:", msg);
    return json({ error: msg }, 500);
  }
});
