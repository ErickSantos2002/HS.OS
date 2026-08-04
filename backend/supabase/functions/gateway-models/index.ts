// gateway-models — lista as LLMs que o Gateway do cliente REALMENTE serve.
//
// Por que existe: até aqui o dnOS tinha as LLMs disponíveis em constantes
// hardcoded no frontend — duas listas independentes (AgentEditDrawer e
// AddAgentDialog) que divergiram entre si e causaram bug real: o item rotulado
// "DeepSeek V4 Pro" gravava `deepseek/deepseek-chat` (janela 131k em vez de 1M)
// no Gateway, colocando vários agentes no modelo errado sem ninguém perceber.
// Uma tela que oferece modelo que o Gateway não serve mente por construção.
// Esta função é a fonte única da verdade: se o modelo aparece aqui, o Gateway
// serve. Alimenta o seletor de LLM no chat, o modelo padrão do agente e a
// seção de LLMs em Conexões.
//
// ATENÇÃO: `GET /v1/models` do OpenClaw NÃO serve pra isso — ele lista AGENTES
// (convenção OpenAI-compat, onde "model" é `openclaw:kira`); é o que
// use-agents.ts já consome. Quem lista LLM é `models.list` do admin-rpc.
//
// Duas fontes, nesta ordem:
//   1. models.list — o método existe (confirmado no dump de métodos do
//      admin-rpc), mas a FORMA da resposta nunca foi observada. Por isso o
//      parser é defensivo e aceita várias formas plausíveis.
//   2. config.get — fallback com formato COMPROVADO por teste real contra o
//      gateway de produção: payload.parsed.models.providers.<id>.models[].
//      Se o models.list vier num formato que não reconheço, ainda entregamos
//      lista correta em vez de tela vazia.
//
// Segurança: a saída é MONTADA campo a campo a partir do que se sabe seguro
// (id do modelo, provedor, janela de contexto). A resposta bruta do Gateway
// nunca é repassada — a config de provider contém apiKey, e mesmo redactada
// não tem por que trafegar até o browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Mesma allowlist do configure-llm-provider: só provedores de LLM conhecidos
// entram na lista. Um provider inesperado na config do Gateway não vira opção
// de UI sem alguém revisar aqui antes.
const KNOWN_PROVIDERS = new Set(["deepseek", "openai", "anthropic", "gemini"]);

type ModelEntry = {
  /** id nu do modelo, como o Gateway conhece: "deepseek-v4-pro" */
  id: string;
  /** id qualificado, formato aceito por agents.update: "deepseek/deepseek-v4-pro" */
  qualifiedId: string;
  provider: string;
  label: string;
  /** janela de contexto em tokens, quando o Gateway informa */
  contextWindow: number | null;
};

async function rpc(gateway: { url: string; token: string }, method: string, params: unknown) {
  const res = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gateway.token}` },
    body: JSON.stringify({ method, params: params ?? {} }),
  });
  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* mantém raw */ }
  return { ok: res.ok, status: res.status, body: parsed, raw: text };
}

// "deepseek-v4-pro" → "DeepSeek V4 Pro". O frontend tem um mapa próprio de
// rótulos conhecidos e usa este só como fallback para modelos novos, que é
// justamente o caso que a lista hardcoded não cobria.
const ACRONYMS: Record<string, string> = {
  ai: "AI", gpt: "GPT", llm: "LLM", tts: "TTS",
};
function prettify(id: string): string {
  // Não quebrar no ponto: ele separa versão ("gpt-5.4" → "GPT 5 4" em vez de
  // "GPT 5.4"). Só hífen e underscore separam palavras.
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      // v4, v4.1 etc → V4
      if (/^v\d/.test(lower)) return lower.toUpperCase();
      if (lower === "deepseek") return "DeepSeek";
      if (lower === "openai") return "OpenAI";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function toEntry(provider: string, modelId: string, contextWindow: unknown): ModelEntry | null {
  const id = String(modelId ?? "").trim();
  if (!id) return null;
  // Alguns lugares da config já trazem o id qualificado ("deepseek/x") — não
  // duplicar o prefixo nesse caso.
  const bare = id.includes("/") ? id.split("/").pop()! : id;
  const ctx = Number(contextWindow);
  return {
    id: bare,
    qualifiedId: `${provider}/${bare}`,
    provider,
    label: prettify(bare),
    contextWindow: Number.isFinite(ctx) && ctx > 0 ? ctx : null,
  };
}

/**
 * Normaliza a resposta do models.list. Como a forma real nunca foi observada,
 * aceita as variações plausíveis: lista plana de strings, lista de objetos, ou
 * mapa de provider → modelos. Devolve [] se não reconhecer nada — aí o chamador
 * cai pro config.get em vez de mostrar tela vazia.
 */
function parseModelsList(body: any): ModelEntry[] {
  const payload = body?.payload ?? body?.result ?? body;
  const out: ModelEntry[] = [];

  const pushFromItem = (item: any, providerHint?: string) => {
    if (typeof item === "string") {
      // "deepseek/deepseek-v4-pro" ou "deepseek-v4-pro" com provider do contexto
      const provider = item.includes("/") ? item.split("/")[0] : providerHint;
      if (!provider || !KNOWN_PROVIDERS.has(provider)) return;
      const entry = toEntry(provider, item, null);
      if (entry) out.push(entry);
      return;
    }
    if (item && typeof item === "object") {
      const rawId = item.id ?? item.model ?? item.name;
      const provider = String(item.provider ?? item.providerId ?? providerHint ?? "").toLowerCase() ||
        (typeof rawId === "string" && rawId.includes("/") ? rawId.split("/")[0] : "");
      if (!provider || !KNOWN_PROVIDERS.has(provider)) return;
      const entry = toEntry(provider, rawId, item.contextTokens ?? item.contextWindow ?? item.context_length);
      if (entry) out.push(entry);
    }
  };

  const candidates = [payload?.models, payload?.data, payload];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) pushFromItem(item);
      if (out.length) return out;
    }
  }

  // Mapa provider → { models: [...] } | [...]
  const asMap = payload?.providers ?? payload?.models ?? payload;
  if (asMap && typeof asMap === "object" && !Array.isArray(asMap)) {
    for (const [provider, node] of Object.entries<any>(asMap)) {
      const key = provider.toLowerCase();
      if (!KNOWN_PROVIDERS.has(key)) continue;
      const list = Array.isArray(node) ? node : node?.models;
      if (!Array.isArray(list)) continue;
      for (const item of list) pushFromItem(item, key);
    }
  }
  return out;
}

/**
 * Fallback com formato COMPROVADO (teste real, 2026-07-19):
 * config.get → payload.parsed.models.providers.<id> = { baseUrl, api,
 * timeoutSeconds, apiKey, models[] }.
 */
function parseConfigGet(body: any): ModelEntry[] {
  const providers =
    body?.payload?.parsed?.models?.providers ??
    body?.payload?.sourceConfig?.models?.providers;
  if (!providers || typeof providers !== "object") return [];

  const defaultCtx = Number(
    body?.payload?.parsed?.agents?.defaults?.contextTokens ??
    body?.payload?.sourceConfig?.agents?.defaults?.contextTokens,
  );
  const out: ModelEntry[] = [];
  for (const [provider, node] of Object.entries<any>(providers)) {
    const key = provider.toLowerCase();
    if (!KNOWN_PROVIDERS.has(key)) continue;
    const list = Array.isArray(node?.models) ? node.models : [];
    for (const item of list) {
      const rawId = typeof item === "string" ? item : (item?.id ?? item?.name);
      const ctx = typeof item === "object"
        ? (item?.contextTokens ?? item?.contextWindow)
        : undefined;
      const entry = toEntry(key, rawId, ctx ?? (Number.isFinite(defaultCtx) ? defaultCtx : null));
      if (entry) out.push(entry);
    }
  }
  return out;
}

function dedupe(entries: ModelEntry[]): ModelEntry[] {
  const map = new Map<string, ModelEntry>();
  for (const e of entries) {
    const existing = map.get(e.qualifiedId);
    // Mantém a variante que traz contextWindow, quando houver conflito.
    if (!existing || (existing.contextWindow == null && e.contextWindow != null)) {
      map.set(e.qualifiedId, e);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
  );
}

/**
 * Modelo PADRÃO de cada agente, lido de `agents.list` do admin-rpc.
 *
 * Serve pro seletor do chat poder dizer "DeepSeek V4 Pro (padrão)" em vez de só
 * "Padrão do agente". As outras fontes não servem: agent_profiles.model no
 * Supabase fica desatualizado (comprovado — dizia deepseek-chat enquanto o
 * Gateway já estava em v4-pro), o /v1/models lista AGENTES e só responde para
 * super_admin, e o snapshot de tokens é agregado e defasado.
 *
 * A FORMA da resposta do agents.list nunca foi observada, então o parser é
 * defensivo e devolve {} quando não reconhece — aí a UI mantém o rótulo
 * genérico, que é honesto, em vez de arriscar mostrar um modelo errado.
 */
function parseAgentDefaults(body: any): Record<string, string> {
  const payload = body?.payload ?? body?.result ?? body;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.agents)
      ? payload.agents
      : Array.isArray(payload?.data)
        ? payload.data
        : null;

  const out: Record<string, string> = {};

  const record = (agentId: unknown, model: unknown) => {
    const id = String(agentId ?? "").trim();
    // O agents.list devolve `model` como OBJETO:
    //   "model": { "primary": "deepseek/deepseek-v4-pro", "fallbacks": [...] }
    // (formato confirmado com saída bruta, 2026-07-24). Aceitar só string
    // descartava todos os agentes — era por isso que o seletor nunca conseguia
    // mostrar qual modelo o padrão resolve. Continua aceitando string pura caso
    // alguma versão do Gateway devolva assim.
    const raw = (
      typeof model === "string"
        ? model
        : String((model as any)?.primary ?? "")
    ).trim();
    // Aceita só o formato provedor/modelo: é o que o header x-openclaw-model
    // exige, e é o que permite casar com a lista de modelos. Um valor como
    // "openclaw:kira" (id de roteamento, não de LLM) é descartado aqui.
    if (!id || !raw.includes("/")) return;
    const provider = raw.split("/")[0].toLowerCase();
    if (!KNOWN_PROVIDERS.has(provider)) return;
    out[id] = raw;
  };

  if (list) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      record(
        item.id ?? item.agentId ?? item.agent_id ?? item.name,
        // `item.model?.primary` NÃO entra nesta cadeia: `??` para no primeiro
        // valor não-nulo, e `item.model` (objeto) já satisfaz isso — o resto
        // nunca seria alcançado. Quem desempacota o objeto é o `record`.
        item.model ?? item.modelId ?? item.model_id,
      );
    }
    return out;
  }

  // Mapa agentId -> { model } | "provedor/modelo"
  if (payload && typeof payload === "object") {
    for (const [key, node] of Object.entries<any>(payload)) {
      if (typeof node === "string") record(key, node);
      else if (node && typeof node === "object") record(key, node.model ?? node.modelId);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // Qualquer usuário autenticado pode ler a lista — ela alimenta o seletor de
    // LLM no chat, que não é recurso de admin. A saída não contém credencial.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const gateway = await getGatewayConfig(supabase);
    if (!gateway.url || !gateway.token) {
      return json({
        error: "Gateway não configurado — conecte o Gateway em Configurações primeiro",
        models: [],
      }, 400);
    }

    // 1. Caminho preferido.
    const listRes = await rpc(gateway, "models.list", {});
    let models = listRes.ok ? dedupe(parseModelsList(listRes.body)) : [];
    let source = "models.list";

    // 2. Fallback de formato comprovado.
    if (models.length === 0) {
      const getRes = await rpc(gateway, "config.get", {});
      if (getRes.ok) {
        models = dedupe(parseConfigGet(getRes.body));
        source = "config.get";
      } else if (!listRes.ok) {
        // Gateway fora do ar não pode QUEBRAR a tela: 502 com o HTML cru do
        // Cloudflare virava "erro de runtime" no frontend (flagrado 29/07).
        // Degrada bonito: 200, lista vazia, flag — a UI mostra "indisponível".
        const raw = (listRes.raw || getRes.raw || "").slice(0, 200);
        const isCloudflare = /<!DOCTYPE html|cloudflare|<html/i.test(raw);
        return json({
          models: [],
          gateway_offline: true,
          error: isCloudflare
            ? "Gateway indisponível no momento (sem resposta atrás do Cloudflare)"
            : `Gateway não respondeu: ${raw}`,
        }, 200);
      }
    }

    // 3. Modelo padrão por agente. Falha aqui NÃO derruba a resposta: sem isso
    //    a UI só perde o "(padrão)" no rótulo, o que é degradação aceitável.
    let agentDefaults: Record<string, string> = {};
    try {
      const agentsRes = await rpc(gateway, "agents.list", {});
      if (agentsRes.ok) agentDefaults = parseAgentDefaults(agentsRes.body);
    } catch {
      /* mantém {} — a UI cai no rótulo genérico */
    }

    return json({
      success: true,
      source,
      models,
      agentDefaults,
      // Sinaliza pro chamador que o Gateway respondeu mas não expôs modelo
      // nenhum — é diferente de "falhou", e a UI deve dizer isso em vez de
      // mostrar uma lista vazia sem explicação.
      empty: models.length === 0,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e), models: [] }, 500);
  }
});
