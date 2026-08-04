import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Registro de uso MEDIDO (task #19).
 *
 * Toda resposta do gateway traz `usage` (tokens de entrada/saída e o modelo).
 * Isso passava pelas nossas funções e era jogado fora, enquanto o painel
 * exibia números auto-reportados. Aqui o dado exato vira fato registrado.
 *
 * Nunca lança: analytics não pode derrubar uma resposta ao usuário.
 */

export interface UsageEvent {
  agent_id: string;
  model?: string | null;
  kind: "dm" | "channel" | "cron" | "subagent" | "command" | "unknown";
  session_key?: string | null;
  label?: string | null;
  user_id?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
  source: "turn" | "session_delta";
  meta?: Record<string, unknown>;
}

/** Extrai o bloco `usage` de uma resposta (OpenAI-compatível) em qualquer forma conhecida. */
export function extractUsage(raw: unknown): {
  input: number; output: number; cached: number; total: number; model: string | null;
} | null {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  } else if (raw && typeof raw === "object") {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;

  const u = (obj.usage ?? null) as Record<string, unknown> | null;
  if (!u || typeof u !== "object") return null;

  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  const input = num(u.prompt_tokens ?? u.input_tokens);
  const output = num(u.completion_tokens ?? u.output_tokens);
  // DeepSeek/Anthropic reportam o cache em campos próprios — importa porque
  // entrada cacheada custa uma fração do preço cheio.
  const details = (u.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cached = num(details.cached_tokens ?? u.prompt_cache_hit_tokens ?? u.cache_read_input_tokens);
  const total = num(u.total_tokens) || input + output;
  const model = typeof obj.model === "string" ? obj.model : null;

  if (total === 0) return null; // nada medido — não registra ruído
  return { input, output, cached, total, model };
}

/**
 * "openclaw:kira" é a ROTA (o agente), não o LLM. O gateway resolve para o
 * modelo real (ex.: deepseek-v4-pro) por dentro, e é esse que interessa na
 * dimensão de LLM — senão todo agente vira "modelo" de si mesmo e a
 * comparação entre LLMs não existe. A varredura de sessões conhece o modelo
 * real; aqui a gente o busca pelo agente.
 */
async function resolveModel(
  supabase: SupabaseClient,
  agentId: string,
  model: string | null | undefined,
): Promise<{ model: string | null; route: string | null }> {
  const m = (model ?? "").trim();
  if (m && !/^openclaw:/i.test(m)) return { model: m, route: null };
  const { data } = await supabase
    .from("agent_context_state")
    .select("model")
    .eq("agent_id", agentId)
    .not("model", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { model: (data?.model as string) ?? null, route: m || null };
}

/**
 * Preço implícito, calculado a partir do que o próprio gateway já cobrou:
 * custo acumulado ÷ tokens acumulados daquele modelo. Serve de rede quando o
 * preço não está cadastrado — melhor um custo derivado da conta real do
 * gateway (e marcado como tal) do que nenhum custo.
 */
async function impliedRatePerToken(supabase: SupabaseClient, model: string): Promise<number | null> {
  const { data } = await supabase
    .from("usage_session_state")
    .select("last_tokens, last_cost_usd")
    .eq("model", model)
    .limit(200);
  if (!data?.length) return null;
  let tokens = 0, cost = 0;
  for (const r of data as Array<{ last_tokens: number; last_cost_usd: number }>) {
    tokens += Number(r.last_tokens) || 0;
    cost += Number(r.last_cost_usd) || 0;
  }
  if (tokens <= 0 || cost <= 0) return null;
  return cost / tokens;
}

/** Calcula o custo em USD com os preços da tabela. Sem preço → null (a tela mostra "—"). */
async function computeCost(
  supabase: SupabaseClient,
  model: string | null,
  input: number,
  output: number,
  cached: number,
): Promise<{ cost: number | null; origin: string | null }> {
  if (!model) return { cost: null, origin: null };
  const { data } = await supabase
    .from("model_pricing")
    .select("input_per_1m, output_per_1m, cached_input_per_1m")
    .eq("model", model)
    .maybeSingle();

  if (data) {
    const inPrice = Number(data.input_per_1m);
    const outPrice = Number(data.output_per_1m);
    const cachedPrice = data.cached_input_per_1m == null ? inPrice : Number(data.cached_input_per_1m);
    const freshInput = Math.max(0, input - cached);
    const cost = (freshInput * inPrice + cached * cachedPrice + output * outPrice) / 1_000_000;
    return { cost: Math.round(cost * 1_000_000) / 1_000_000, origin: "tabela" };
  }

  // Sem preço cadastrado: deriva da conta que o gateway já fez para este
  // modelo. Fica marcado como implícito — é estimativa, não tabela.
  const rate = await impliedRatePerToken(supabase, model);
  if (rate == null) return { cost: null, origin: null };
  const cost = (input + output) * rate;
  return { cost: Math.round(cost * 1_000_000) / 1_000_000, origin: "implicito_gateway" };
}

/** Grava um evento de uso. Best-effort: erro aqui nunca interrompe o fluxo principal. */
export async function recordUsage(supabase: SupabaseClient, ev: UsageEvent): Promise<void> {
  try {
    const input = ev.input_tokens ?? 0;
    const output = ev.output_tokens ?? 0;
    const cached = ev.cached_tokens ?? 0;
    const total = ev.total_tokens ?? input + output;
    if (total <= 0) return;

    const { model, route } = await resolveModel(supabase, ev.agent_id, ev.model);
    const { cost: cost_usd, origin } = await computeCost(supabase, model, input, output, cached);
    // A coluna é uuid: qualquer outra coisa (id de sessão, string vazia)
    // faria o insert inteiro falhar e a métrica se perder em silêncio.
    const uid = typeof ev.user_id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ev.user_id)
      ? ev.user_id
      : null;

    const { error } = await supabase.from("usage_events").insert({
      agent_id: ev.agent_id,
      model,
      kind: ev.kind,
      session_key: ev.session_key ?? null,
      label: ev.label ?? null,
      user_id: uid,
      input_tokens: input,
      output_tokens: output,
      cached_tokens: cached,
      total_tokens: total,
      cost_usd,
      source: ev.source,
      meta: { ...(ev.meta ?? {}), ...(route ? { route } : {}), ...(origin ? { cost_origin: origin } : {}) },
    });
    if (error) console.warn("[usage] insert falhou:", error.message);
  } catch (e) {
    console.warn("[usage] recordUsage:", e instanceof Error ? e.message : e);
  }
}

/** Deriva o tipo de trabalho a partir da chave de sessão do gateway. */
export function kindFromSessionKey(sessionKey: string | null | undefined): UsageEvent["kind"] {
  const k = (sessionKey ?? "").toLowerCase();
  if (!k) return "unknown";
  if (k.includes(":subagent:")) return "subagent";
  if (k.includes(":cron:")) return "cron";
  if (k.includes(":dm:")) return "dm";
  if (k.includes(":channel:")) return "channel";
  return "unknown";
}
