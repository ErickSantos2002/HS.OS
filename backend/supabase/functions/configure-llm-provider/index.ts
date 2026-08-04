// configure-llm-provider — Design B (conector LLM → cofre do Gateway)
//
// Um remix novo instala o Gateway com .env vazio; a área de Conectores do dnOS
// só grava a chave no Supabase e NUNCA a leva ao Gateway — então "configurar a
// LLM nos Conectores" não fazia a plataforma funcionar. Esta função fecha essa
// ponte: pega a api_key do conector LLM e a escreve no cofre do Gateway do
// cliente via admin-http-rpc (config.patch), recarrega, e CONFIRMA relendo
// a config se a chave ficou gravada — nunca reporta "conectado" sem prova
// (mesma disciplina do resto da consolidação).
//
// Pré-requisito: setup.sh ativa o plugin admin-http-rpc (control plane HTTP).
//
// Contrato REAL, confirmado com o corpo exato de uma chamada que funcionou
// de verdade contra o gateway de produção (2026-07-19, via Lia):
//   POST /api/v1/admin/rpc {"method":"config.get","params":{}}
//     → { ok, payload: { hash, path, parsed: { models: { providers: {...} } }, ... } }
//     (GET puro na raiz dá 405; params:{} vazio em outros métodos dá erro —
//     só config.get funciona pra ler o estado atual)
//   POST /api/v1/admin/rpc  config.patch
//     params: { raw: "<JSON do patch, como STRING>", baseHash: "<payload.hash>" }
//     `raw` é STRING, não objeto — objeto é recusado com "invalid config.patch
//     params: at /raw: must be string" (erro real, 2026-07-24).
//     `baseHash` é OBRIGATÓRIO (lock otimista). O campo chama baseHash; mandar
//     `hash` é rejeitado — foi o que fez tentativas anteriores falharem sem
//     ninguém entender, e ficou meses registrado como "não usar hash".
//     SEMÂNTICA (docs do Gateway, configuration.md): config.patch segue JSON
//     Merge Patch (RFC 7386) — objetos fazem MERGE PROFUNDO, arrays SUBSTITUEM,
//     null DELETA a chave. Ou seja, mandar só models.providers.<x> preserva
//     crons, agentes, canais e os demais provedores. Para substituir a config
//     inteira existe outro método: config.apply.
//   POST /api/v1/admin/rpc  gateway.restart.request   → recarrega
// NOTA sobre verificação: models.authStatus só reporta providers com
// auth-profile OAuth (expiry) — provider de api_key puro como deepseek NÃO
// aparece ali (confirmado: só OpenAI apareceu no teste real, DeepSeek ficou
// de fora mesmo configurado e funcionando). Por isso a confirmação pós-patch
// usa config.get de novo e olha se a apiKey do provider está presente
// (redactada) — prova que a ESCRITA colou, não prova que o VALOR da chave é
// válido (isso só uma chamada de completions real confirmaria).
//
// Rate limit do admin-rpc: 3 requisições por 60s no config.patch — CADA
// tentativa (mesmo com erro) conta. Esta função faz NO MÁXIMO 1 config.get +
// 1 config.patch + 1 restart + 1 config.get de verificação por chamada — não
// tenta de novo em loop se algo falhar (aprendido do incidente de hoje: um
// loop de retry humano+agente esgotou o rate limit e travou uma sessão).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

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

// Allowlist explícita template_id (dnOS) → provider key (Gateway/openclaw.json).
// É correção E segurança: sem allowlist, um template_id arbitrário viraria path
// arbitrário no config.patch (ex.: "/models/providers/<x>/apiKey") — injeção de
// path na config do Gateway. Só provedores de LLM conhecidos, campo api_key.
const PROVIDER_MAP: Record<string, string> = {
  deepseek: "deepseek",
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
};

// Pistas por NOME, usadas quando o conector não tem template_id — é o caso dos
// conectores criados pelo fluxo "Personalizado" (o "Anthropic Claude" e o
// "DeepSeek API" já cadastrados têm template_id nulo). Sem isso a função
// rejeitaria justamente os conectores que existem de verdade. O resultado
// continua restrito às chaves do PROVIDER_MAP — nome livre nunca vira path.
// Espelha llmProviderFor() de src/lib/connector-templates.ts; manter em sincronia.
const NAME_HINTS: Array<[string, string]> = [
  ["deepseek", "deepseek"],
  ["anthropic", "anthropic"],
  ["claude", "anthropic"],
  ["openai", "openai"],
  ["chatgpt", "openai"],
  ["gpt", "openai"],
  ["gemini", "gemini"],
];

function resolveProvider(templateId: unknown, name: unknown): string | null {
  const byTemplate = PROVIDER_MAP[String(templateId ?? "").trim().toLowerCase()];
  if (byTemplate) return byTemplate;
  const key = String(name ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const [hint, provider] of NAME_HINTS) {
    if (key.includes(hint)) return provider;
  }
  return null;
}

async function rpc(gateway: { url: string; token: string }, method: string, params: unknown) {
  const res = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${gateway.token}` },
    body: JSON.stringify({ method, params: params ?? {} }),
  });
  const text = await res.text().catch(() => "");
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  return { ok: res.ok, status: res.status, body: parsed, raw: text };
}

// Caminho confirmado por teste real: POST config.get devolve
// { payload: { hash, parsed: { models: { providers: {...} } }, sourceConfig, ... } }.
// Tenta parsed primeiro (config resolvida/mesclada) e sourceConfig como
// fallback (algumas versões podem não expor "parsed"). O hash não é mais
// usado no write (a chamada real que funcionou não tinha hash — mandar
// hash foi REJEITADO em outra tentativa).
function extractProviders(getBody: any): Record<string, any> | null {
  const parsed = getBody?.payload?.parsed?.models?.providers;
  if (parsed && typeof parsed === "object") return parsed;
  const source = getBody?.payload?.sourceConfig?.models?.providers;
  return source && typeof source === "object" ? source : null;
}


// ─────────────────────────────────────────────────────────────────────────
// Ações da tela de LLMs (gestão unificada — task #20).
//
// Vivem NESTE arquivo de propósito: todo o conhecimento batalhado do
// config.patch (baseHash, sentinela de redação, enums de api, campo auth,
// rate limit 3/60s) está aqui, validado com escrita real em 19/07. Duplicar
// em outra função criaria uma segunda implementação que envelhece separada.
// ─────────────────────────────────────────────────────────────────────────

const REDACTION_SENTINEL_M = "__OPENCLAW_REDACTED__";

// baseUrl é OBRIGATÓRIO no schema de models.providers ("custom mode requires
// baseUrl") — sem ele o gateway até BOOTA tolerando o nó, mas todo
// config.patch passa a falhar na validação ("baseUrl: Too small") e as
// chamadas dão 404. Medido em 01/08: openai sem /v1 → adaptador responses
// bate em api.openai.com/responses e 404; com /v1 → resposta real ok.
const PROVIDER_DEFAULTS_M: Record<string, Record<string, unknown>> = {
  openai: { api: "openai-completions", baseUrl: "https://api.openai.com/v1", auth: "api-key" },
  deepseek: { api: "openai-completions", baseUrl: "https://api.deepseek.com", auth: "api-key" },
  anthropic: { api: "anthropic-messages", baseUrl: "https://api.anthropic.com/v1", auth: "api-key" },
  gemini: { api: "google-generative-ai", baseUrl: "https://generativelanguage.googleapis.com/v1beta", auth: "api-key" },
};

function stripRedactedDeep(node: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== REDACTION_SENTINEL_M));
}

function parsedConfig(getBody: any): any {
  return getBody?.payload?.parsed ?? getBody?.payload?.sourceConfig ?? null;
}

/** Modelos que não são de chat não devem poluir a lista (embeddings, áudio,
 *  imagem, moderação). Filtro por nome — heurístico, e o usuário vê o que
 *  sobrou, então um falso negativo é recuperável digitando o id no futuro. */
function pareceChat(id: string): boolean {
  const x = id.toLowerCase();
  return !/(embed|whisper|tts|audio|dall-e|image|moderation|vision-preview|realtime|transcribe|search|similarity|edit-|-if-|guard)/.test(x);
}

/** Descoberta ao vivo: pergunta à API do próprio provedor quais modelos a
 *  chave enxerga. Nada de lista hardcoded — modelo novo aparece sozinho. */
async function discoverModels(tipo: string, apiKey: string, baseUrl?: string): Promise<{ ok: boolean; models?: Array<{ id: string; name: string }>; error?: string }> {
  const tenta = async (url: string, headers: Record<string, string>) => {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      const dica = res.status === 401 || res.status === 403 ? "chave inválida ou sem permissão" : `HTTP ${res.status}`;
      return { ok: false as const, error: `${dica}: ${text.slice(0, 200)}` };
    }
    try { return { ok: true as const, body: JSON.parse(text) }; } catch { return { ok: false as const, error: "resposta não é JSON" }; }
  };

  if (tipo === "anthropic") {
    const r = await tenta("https://api.anthropic.com/v1/models?limit=100", {
      "x-api-key": apiKey, "anthropic-version": "2023-06-01",
    });
    if (!r.ok) return r;
    const data = (r.body?.data ?? []) as Array<{ id: string; display_name?: string }>;
    return { ok: true, models: data.map((m) => ({ id: m.id, name: m.display_name ?? m.id })) };
  }
  if (tipo === "gemini") {
    const r = await tenta(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`, {});
    if (!r.ok) return r;
    const data = (r.body?.models ?? []) as Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    return {
      ok: true,
      models: data
        .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
        .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName ?? m.name })),
    };
  }
  // openai, deepseek e custom são todos OpenAI-compat: GET /models
  const base = tipo === "openai" ? "https://api.openai.com/v1"
    : tipo === "deepseek" ? "https://api.deepseek.com"
    : (baseUrl ?? "").replace(/\/$/, "");
  if (!base) return { ok: false, error: "base_url é obrigatória para provedor personalizado" };
  let r = await tenta(`${base}/models`, { Authorization: `Bearer ${apiKey}` });
  if (!r.ok && tipo === "custom") r = await tenta(`${base}/v1/models`, { Authorization: `Bearer ${apiKey}` });
  if (!r.ok) return r;
  const data = (r.body?.data ?? []) as Array<{ id: string }>;
  return { ok: true, models: data.filter((m) => pareceChat(m.id)).map((m) => ({ id: m.id, name: m.id })) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // 1. Auth — super_admin configura; o sincronizador da VPS (mesmo secret
    //    das skills) só usa as ações ops_pull/ops_report.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const syncSecret = await getIntegrationSecret(supabase, "SKILL_SYNC_SECRET");
    const isSyncCall = !!syncSecret && jwt === syncSecret;

    if (!isSyncCall) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      const { data: isAdmin } = await supabase.rpc("has_role", {
        _user_id: userData.user.id,
        _role: "super_admin",
      });
      if (!isAdmin) return json({ error: "Forbidden" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();

    // ── Ações da tela de LLMs (o gate de super_admin acima vale p/ todas) ──
    const gatewayCfg = action ? await getGatewayConfig(supabase) : null;

    if (action === "list") {
      // Instalar provedor REINICIA o gateway (fluxo normal agora). A lista
      // cai exatamente nessa janela quando a UI vigia a fila — retry curto em
      // vez de assustar com a página de erro do Cloudflare.
      let g = await rpc(gatewayCfg!, "config.get", {});
      for (let i = 0; i < 2 && !g.ok; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        g = await rpc(gatewayCfg!, "config.get", {});
      }
      if (!g.ok) {
        // 200, não 5xx. Isto é um endpoint de ESTADO, e "o gateway está
        // reiniciando" é um estado legítimo — aliás, o estado que a própria
        // instalação de provedor provoca. Respondendo 503 aqui, salvar um
        // provedor com sucesso disparava uma sequência garantida de erros de
        // runtime no preview: a UI vigia de 4 em 4s exatamente durante o
        // reinício que ela mesma causou. As ops pendentes vão junto para a
        // tela poder dizer "instalando…" em vez de "deu erro".
        const pareceHtml = /<html|<!doctype/i.test(g.raw ?? "");
        const { data: opsAgora } = await supabase
          .from("llm_provider_ops").select("id, op, provider_id, status, error, created_at")
          .neq("op", "discover_models")
          .order("created_at", { ascending: false }).limit(10);
        return json({
          indisponivel: true,
          motivo: pareceHtml
            ? "O gateway está reiniciando (acontece ao instalar um provedor) — volta em alguns segundos."
            : `Não consegui falar com o gateway${g.raw ? `: ${g.raw.slice(0, 200)}` : ""}`,
          provedores: {}, catalogo: [], perfis: {}, agentes: [], padrao: null,
          ops: opsAgora ?? [],
        });
      }
      const cfg = parsedConfig(g.body) ?? {};
      const provs = extractProviders(g.body) ?? {};
      const catalogo = Object.keys(cfg?.agents?.defaults?.models ?? {});
      const perfis = Object.fromEntries(
        Object.entries(cfg?.auth?.profiles ?? {}).map(([k, v]: [string, any]) => [k, { provider: v?.provider, mode: v?.mode }]),
      );
      const provedores = Object.fromEntries(
        Object.entries(provs).map(([id, node]: [string, any]) => [id, {
          api: node?.api ?? null,
          baseUrl: node?.baseUrl ?? null,
          auth: node?.auth ?? null,
          // config.get redige segredos: presença do sentinela/valor = tem chave.
          temChave: !!node?.apiKey,
          modelos: (Array.isArray(node?.models) ? node.models : []).map((m: any) => ({
            id: m?.id, name: m?.name ?? m?.id, contextWindow: m?.contextWindow ?? null,
            cost: m?.cost ?? null,
          })),
        }]),
      );
      const agentes = (cfg?.agents?.list ?? []).map((a: any) => ({ id: a?.id, model: a?.model ?? null }));
      const padrao = cfg?.agents?.defaults?.model ?? null;
      const { data: ops } = await supabase
        .from("llm_provider_ops").select("id, op, provider_id, status, error, created_at")
        .neq("op", "discover_models")
        .order("created_at", { ascending: false }).limit(10);
      return json({ provedores, catalogo, perfis, agentes, padrao, ops: ops ?? [] });
    }

    if (action === "discover") {
      const tipo = String(body?.provider_type ?? "").trim().toLowerCase();
      const chave = String(body?.api_key ?? "").trim();
      const baseUrl = body?.base_url ? String(body.base_url).trim() : undefined;
      if (!tipo) return json({ error: "provider_type é obrigatório" }, 400);
      if (chave) {
        const r = await discoverModels(tipo, chave, baseUrl);
        if (!r.ok) return json({ ok: false, error: r.error }, 200); // erro de NEGÓCIO, não de HTTP
        return json({ ok: true, models: r.models });
      }
      // Sem chave: a função não consegue ler a gravada (o gateway redige
      // segredos) — mas a VPS pode. Vira operação na fila; a UI acompanha
      // por discover_status. A credencial nunca viaja.
      const provId = tipo === "custom"
        ? String(body?.provider_id ?? "").trim().toLowerCase()
        : PROVIDER_MAP[tipo];
      if (!provId) return json({ error: "provedor inválido" }, 400);
      const { data: jaExiste } = await supabase
        .from("llm_provider_ops").select("id")
        .eq("op", "discover_models").eq("provider_id", provId).eq("status", "pending")
        .maybeSingle();
      if (jaExiste?.id) return json({ ok: true, queued: true, op_id: jaExiste.id });
      const { data: nova, error: opErr } = await supabase
        .from("llm_provider_ops")
        .insert({ op: "discover_models", provider_id: provId })
        .select("id").single();
      if (opErr) return json({ error: `fila indisponível: ${opErr.message}` }, 500);
      return json({ ok: true, queued: true, op_id: nova.id });
    }

    if (action === "discover_status") {
      const opId = String(body?.op_id ?? "").trim();
      if (!opId) return json({ error: "op_id é obrigatório" }, 400);
      const { data: row } = await supabase
        .from("llm_provider_ops").select("id, status, error, result")
        .eq("id", opId).maybeSingle();
      if (!row) return json({ done: true, error: "operação não encontrada (já consumida?)" });
      if (row.status === "pending") return json({ done: false });
      // done/error: entrega e apaga — resultado é de consumo único.
      await supabase.from("llm_provider_ops").delete().eq("id", opId);
      if (row.status === "error") return json({ done: true, error: row.error ?? "falha na descoberta" });
      return json({ done: true, models: (row.result as { models?: unknown })?.models ?? [] });
    }

    if (action === "ops_pull") {
      if (!isSyncCall) return json({ error: "ops_pull é exclusivo do sincronizador" }, 403);
      const { data } = await supabase
        .from("llm_provider_ops").select("id, op, provider_id, payload")
        .eq("status", "pending").order("created_at").limit(5);
      return json({ ops: data ?? [] });
    }

    if (action === "ops_report") {
      if (!isSyncCall) return json({ error: "ops_report é exclusivo do sincronizador" }, 403);
      const results: Array<{ id: string; ok: boolean; error?: string }> =
        Array.isArray(body.results) ? body.results : [];
      for (const r of results) {
        if (!r?.id) continue;
        if (r.ok && (r as { result?: unknown }).result) {
          // Descoberta: o resultado fica na linha ('done') até a UI consumir.
          await supabase.from("llm_provider_ops")
            .update({ status: "done", result: (r as { result?: unknown }).result, payload: null })
            .eq("id", r.id);
        } else if (r.ok) {
          // Sucesso apaga a linha: a chave de API não fica em repouso.
          await supabase.from("llm_provider_ops").delete().eq("id", r.id);
        } else {
          // Erro mantém a linha SEM o payload — o motivo fica, a chave não.
          await supabase.from("llm_provider_ops")
            .update({ status: "error", error: (r.error ?? "falha no sincronizador").slice(0, 500), payload: null })
            .eq("id", r.id);
        }
      }
      return json({ ok: true });
    }

    if (action === "save" || action === "remove") {
      if (isSyncCall) return json({ error: "ação de usuário" }, 403);
      const tipo = String(body?.provider_type ?? "").trim().toLowerCase();
      const idProv = tipo === "custom"
        ? String(body?.provider_id ?? "").trim().toLowerCase()
        : PROVIDER_MAP[tipo];
      // Allowlist continua valendo: nome livre nunca vira path na config.
      if (!idProv || (tipo === "custom" && !/^[a-z0-9][a-z0-9-]{1,23}$/.test(idProv)))
        return json({ error: "provedor inválido" }, 400);
      if (tipo === "custom" && idProv in PROVIDER_MAP)
        return json({ error: "provider_id de personalizado não pode colidir com provedor conhecido" }, 400);

      const g = await rpc(gatewayCfg!, "config.get", {});
      if (!g.ok) return json({ error: "config.get falhou", detail: g.raw?.slice(0, 300) }, 502);
      const cfg = parsedConfig(g.body) ?? {};
      const provs = extractProviders(g.body) ?? {};
      const existente = provs?.[idProv] as Record<string, unknown> | undefined;
      const baseHash = g.body?.payload?.hash;
      if (!baseHash || typeof baseHash !== "string")
        return json({ error: "hash da config indisponível — abortado por segurança", code: "base_hash_unavailable" }, 502);

      const catalogoAtual: string[] = Object.keys(cfg?.agents?.defaults?.models ?? {});
      const doProvedor = catalogoAtual.filter((k) => k.startsWith(idProv + "/"));

      if (action === "remove") {
        // Guarda: remover o provedor que sustenta agentes derrubaria a
        // operação com sintoma de "agentes mudos". Falha em voz alta.
        const emUso: string[] = [];
        const padrao = cfg?.agents?.defaults?.model ?? {};
        if (String(padrao?.primary ?? "").startsWith(idProv + "/")) emUso.push("padrão da instância (primary)");
        for (const fb of padrao?.fallbacks ?? []) if (String(fb).startsWith(idProv + "/")) emUso.push("fallback da instância");
        for (const a of cfg?.agents?.list ?? []) {
          if (String(a?.model ?? "").startsWith(idProv + "/")) emUso.push(`agente ${a.id}`);
        }
        if (emUso.length > 0) {
          return json({
            error: `Este provedor está em uso: ${[...new Set(emUso)].join(", ")}. Reatribua antes de remover.`,
            code: "provider_in_use", em_uso: [...new Set(emUso)],
          }, 409);
        }
        // Remoção a quente nunca foi provada — e o hot-ADD crasha o reload.
        // Mesmo caminho seguro: a VPS remove do arquivo e reinicia.
        const { error: opErr } = await supabase.from("llm_provider_ops").insert({
          op: "remove_provider", provider_id: idProv,
          payload: { catalogo_remover: doProvedor },
        });
        if (opErr) return json({ error: `fila indisponível: ${opErr.message}` }, 500);
        return json({ ok: true, queued: true, removido: idProv });
      }

      // ── save ──
      const chave = String(body?.api_key ?? "").trim();
      const baseUrl = body?.base_url ? String(body.base_url).trim() : undefined;
      const selecionados: Array<{ id: string; name?: string; contextWindow?: number }> =
        Array.isArray(body?.models) ? body.models.filter((m: any) => m?.id) : [];
      if (selecionados.length === 0) return json({ error: "selecione ao menos um modelo" }, 400);
      if (!existente && !chave) return json({ error: "api_key é obrigatória para um provedor novo" }, 400);

      if (existente && String((existente as any).auth ?? "").toLowerCase() === "oauth") {
        return json({
          error: `O provedor "${idProv}" está em OAuth no Gateway — gravar api_key não teria efeito. Reautentique o OAuth ou mude o modo antes.`,
          code: "provider_uses_oauth",
        }, 409);
      }

      // BISSEÇÃO de 01/08 contra o gateway real: ADICIONAR provedor via
      // config.patch escreve, o reload crasha e o gateway REVERTE (503) —
      // vale para openai e anthropic igualmente. Editar provedor existente
      // funciona. Provedor NOVO vai pela fila: o sincronizador da VPS grava
      // o arquivo e reinicia o gateway, que nasce com a config pronta (o
      // caminho pré-boot do setup.sh, que comprovadamente funciona).
      if (!existente) {
        const modelosNovos = selecionados.map((m) => ({
          id: m.id, name: m.name ?? m.id,
          ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        }));
        const nodeNovo: Record<string, unknown> = {
          ...(PROVIDER_DEFAULTS_M[tipo] ?? { api: "openai-completions", auth: "api-key" }),
          apiKey: chave, models: modelosNovos,
        };
        if (baseUrl) nodeNovo.baseUrl = baseUrl;
        const catalogoNovo: Record<string, unknown> = {};
        for (const m of selecionados) catalogoNovo[`${idProv}/${m.id}`] = {};
        // Entradas velhas DESTE provedor no catálogo saem junto — foi o que
        // deixou 'openai/gpt-5.4-mini' fantasma no seletor e derrubou o turno
        // da Lia com timeout (01/08).
        const catalogoRemover = doProvedor.filter((k) => !(k in catalogoNovo));
        const { error: opErr } = await supabase.from("llm_provider_ops").insert({
          op: "upsert_provider", provider_id: idProv,
          payload: { node: nodeNovo, catalogo: catalogoNovo, catalogo_remover: catalogoRemover },
        });
        if (opErr) return json({ error: `fila indisponível: ${opErr.message}` }, 500);
        return json({
          ok: true, queued: true, provedor: idProv,
          nota: "Provedor novo é instalado pela VPS (o gateway não aceita a quente) — confirma em segundos.",
        });
      }

      // ARRAY SUBSTITUI no merge patch: a lista enviada é a lista final.
      // Modelo já existente preserva os metadados ricos (custo, janela).
      const atuais = new Map<string, any>(
        (Array.isArray(existente?.models) ? (existente!.models as any[]) : []).map((m: any) => [m?.id, m]),
      );
      const modelos = selecionados.map((m) => atuais.get(m.id) ?? {
        id: m.id, name: m.name ?? m.id,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      });

      const base = stripRedactedDeep(existente ?? PROVIDER_DEFAULTS_M[tipo] ?? { api: "openai-completions", auth: "api-key" });
      const node: Record<string, unknown> = { ...base, models: modelos };
      if (chave) node.apiKey = chave;
      if (baseUrl) node.baseUrl = baseUrl;

      // Catálogo: entra o selecionado, sai (null) o que era deste provedor e
      // foi desmarcado — provedor e catálogo nunca andam separados.
      const catalogoDelta: Record<string, unknown> = {};
      for (const m of selecionados) catalogoDelta[`${idProv}/${m.id}`] = {};
      for (const k of doProvedor) if (!(k in catalogoDelta)) catalogoDelta[k] = null;

      const patch = {
        models: { providers: { [idProv]: node } },
        agents: { defaults: { models: catalogoDelta } },
      };
      const pr = await rpc(gatewayCfg!, "config.patch", { raw: JSON.stringify(patch), baseHash });
      if (!pr.ok) return json({ error: "Falha ao gravar no Gateway (config.patch)", detail: pr.raw?.slice(0, 400) }, 502);

      await rpc(gatewayCfg!, "gateway.restart.request", {});
      await new Promise((r) => setTimeout(r, 3000));
      const v = await rpc(gatewayCfg!, "config.get", {});
      const vProvs = extractProviders(v.body);
      const vNode = vProvs?.[idProv];
      const chavePresente = !!vNode?.apiKey && String(vNode.apiKey).trim().length > 0;
      const vCatalogo = Object.keys(parsedConfig(v.body)?.agents?.defaults?.models ?? {});
      return json({
        ok: true, provedor: idProv,
        verified: chavePresente,
        modelos_no_catalogo: vCatalogo.filter((k) => k.startsWith(idProv + "/")),
        aviso: chavePresente ? null : "escrita aceita, mas a chave não apareceu na releitura — confira antes de usar",
      });
    }

    const { integration_id } = body ?? {};
    if (!integration_id) return json({ error: "integration_id required" }, 400);

    // 2. Lê o conector e resolve o provider pela allowlist.
    const { data: row, error: rowErr } = await supabase
      .from("integrations")
      .select("id, name, category, template_id, credentials")
      .eq("id", integration_id)
      .maybeSingle();
    if (rowErr) return json({ error: rowErr.message }, 400);
    if (!row) return json({ error: "Conector não encontrado" }, 404);

    // Identifica o conector de LLM pelo template_id, não pela `category`: a UI
    // grava sempre "APIs" para conector de API (ConnectorsTab), nunca "llm" —
    // exigir category aqui rejeitava TODO conector real, deixando esta função
    // inalcançável pela tela. O PROVIDER_MAP já é a allowlist que importa:
    // template_id desconhecido não vira path no config.patch.
    const provider = resolveProvider(row.template_id, row.name);
    if (!provider) {
      return json({
        error: `Não consegui identificar o provedor de LLM deste conector ("${row.name}"). ` +
          `Suportados: DeepSeek, OpenAI, Anthropic e Gemini.`,
      }, 400);
    }

    // 3. Extrai a api_key inline do conector (credentials[].value).
    const creds: any[] = Array.isArray(row.credentials) ? row.credentials : [];
    const apiKeyEntry =
      creds.find((c) => String(c?.key_name ?? c?.key ?? "").toLowerCase().includes("api_key")) ??
      creds.find((c) => !!c?.value);
    const apiKey = String(apiKeyEntry?.value ?? "").trim();
    if (!apiKey) {
      return json({ error: "Conector sem chave configurada — cole a API key antes de conectar" }, 400);
    }

    // 4. Gateway do cliente (url + admin token de vps_config).
    const gateway = await getGatewayConfig(supabase);
    if (!gateway.url || !gateway.token) {
      return json({ error: "Gateway não configurado — conecte o Gateway em Configurações primeiro" }, 400);
    }

    // 5. Config atual via config.get — traz a árvore de providers, de onde
    //    pego o objeto EXISTENTE do provider (se houver) pra preservar todos
    //    os campos dele (baseUrl, api, timeoutSeconds, models[]) no merge.
    const getRes = await rpc(gateway, "config.get", {});
    if (!getRes.ok) {
      return json({
        error: "Não foi possível ler a config atual do Gateway (config.get)",
        detail: getRes.raw?.slice(0, 500),
        status: getRes.status,
      }, 502);
    }
    const providers = extractProviders(getRes.body);
    const existingProvider = providers?.[provider];

    // 6. Monta o raw do config.patch: formato REAL comprovado é o objeto de
    //    provider COMPLETO (campos existentes + apiKey nova) — nunca um
    //    delta parcial, que nunca foi testado com sucesso.
    // Defaults mínimos de bootstrap por provider, usados só quando o provider
    // ainda NÃO existe na config (caso de um gateway novo / remix).
    //
    // O `api` é um ENUM FECHADO do schema do Gateway — valor fora dele é
    // rejeitado na validação. Valores válidos, da saída bruta de
    // config.schema.lookup em models.providers (2026-07-24):
    //   openai-completions | openai-responses | openai-chatgpt-responses |
    //   anthropic-messages | google-generative-ai | google-vertex |
    //   github-copilot | bedrock-converse-stream | ollama | azure-openai-responses
    //
    // ATENÇÃO — o adaptador é POR PROVEDOR, não "openai pra todo mundo": a API
    // da Anthropic não é compatível com a da OpenAI (usa /v1/messages, header
    // x-api-key, corpo diferente), por isso existe `anthropic-messages`. Usar
    // openai-completions contra api.anthropic.com grava uma config que só falha
    // na primeira chamada real, não na escrita.
    //
    // baseUrl só onde temos valor VERIFICADO. O do deepseek veio do
    // openclaw.json real; para os demais o Gateway já traz o default built-in
    // (openai/anthropic/gemini nem existem no arquivo e mesmo assim aparecem no
    // models.list). Chutar baseUrl aqui gravaria endpoint errado em silêncio.
    // `auth: "api-key"` declara o modo de autenticação. Sem isso, um provider
    // cujo default built-in é OAuth continuaria tentando renovar token OAuth e
    // ignoraria a apiKey gravada — foi o que aconteceu com a OpenAI, que falha
    // com "OAuth token refresh failed ... invalid_refresh_token" mesmo com o
    // conector recadastrado. Valores válidos: api-key | aws-sdk | oauth | token.
    const PROVIDER_DEFAULTS: Record<string, Record<string, unknown>> = {
      openai: { api: "openai-completions", auth: "api-key" },
      deepseek: { api: "openai-completions", baseUrl: "https://api.deepseek.com", auth: "api-key" },
      anthropic: { api: "anthropic-messages", auth: "api-key" },
      gemini: { api: "google-generative-ai", auth: "api-key" },
    };

    // Provider que já existe e está em OAuth: gravar uma apiKey por cima NÃO
    // resolve — o Gateway continua no fluxo OAuth e a chave fica ignorada.
    // Falha em voz alta em vez de reportar "conectado" sobre algo que segue
    // quebrado (é a diferença entre "gravou" e "funciona" que este projeto já
    // pagou caro pra aprender).
    if (existingProvider && String((existingProvider as any).auth ?? "").toLowerCase() === "oauth") {
      return json({
        error:
          `O provedor "${provider}" está configurado no Gateway para autenticação OAuth, ` +
          `não por API key. Gravar a chave aqui não teria efeito — o Gateway continuaria ` +
          `tentando renovar o token OAuth. É preciso reautenticar o OAuth no Gateway ou ` +
          `mudar o provedor para o modo api-key antes.`,
        code: "provider_uses_oauth",
        provider,
      }, 409);
    }

    // O config.get devolve segredos REDATADOS pelo sentinela
    // "__OPENCLAW_REDACTED__", e o Gateway recusa recebê-lo de volta:
    // "Reserved redaction sentinel ... is not valid config data" (erro real,
    // 2026-07-24). Reenviar o nó lido cru quebraria a gravação sempre que o
    // provider tivesse qualquer campo secreto além da apiKey que estamos
    // trocando. Removemos os campos redatados: o que não for reenviado é
    // preservado pelo merge patch de qualquer forma.
    const REDACTION_SENTINEL = "__OPENCLAW_REDACTED__";
    const stripRedacted = (node: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(node).filter(([, v]) => v !== REDACTION_SENTINEL));

    const providerNodeBase = stripRedacted(
      (existingProvider as Record<string, unknown>) ?? PROVIDER_DEFAULTS[provider] ?? {},
    );

    // `baseHash` é OBRIGATÓRIO: é um lock otimista. O Gateway compara com o
    // estado atual e rejeita se a config mudou entre o config.get e o patch —
    // impede sobrescrever alteração que outra pessoa (ou a própria Lia via SSH)
    // fez no meio do caminho. Vem em payload.hash (confirmado por teste real).
    // O campo chama `baseHash`; mandar `hash` é rejeitado — foi o que fez
    // tentativas anteriores falharem sem ninguém entender o motivo.
    const baseHash = getRes.body?.payload?.hash;
    if (!baseHash || typeof baseHash !== "string") {
      return json({
        error:
          "Não consegui obter o hash da config atual do Gateway (payload.hash). " +
          "Ele é obrigatório para gravar com segurança — abortado.",
        code: "base_hash_unavailable",
      }, 502);
    }

    // Patch PARCIAL: o config.patch segue JSON Merge Patch (RFC 7386) — objetos
    // fazem merge profundo, então mandar só `models.providers.<provider>`
    // preserva crons, agentes, canais e os demais provedores. Confirmado na
    // documentação do Gateway (2026-07-24).
    // ATENÇÃO ao editar: em merge patch, ARRAY SUBSTITUI (não mescla) e `null`
    // DELETA a chave. Por isso `providerNodeBase` vem da config lida — se ele
    // trouxer um array `models[]`, o array enviado troca o existente, e como é
    // o mesmo valor lido, nada se perde. Montar esse nó à mão apagaria a lista
    // de modelos do provedor.
    const patchRaw = {
      models: {
        providers: {
          [provider]: { ...providerNodeBase, apiKey },
        },
      },
    };

    const patchRes = await rpc(gateway, "config.patch", {
      raw: JSON.stringify(patchRaw),
      baseHash,
    });
    if (!patchRes.ok) {
      return json({
        error: "Falha ao gravar a chave no Gateway (config.patch)",
        detail: patchRes.raw?.slice(0, 500),
        status: patchRes.status,
      }, 502);
    }

    // 7. Recarrega o Gateway pra ativar o provider.
    await rpc(gateway, "gateway.restart.request", {});

    // 8. CONFIRMA de verdade — nunca reporta "conectado" sem prova. Dá um
    //    tempo pro restart e relê a config (NÃO usa models.authStatus: teste
    //    real confirmou que ele só reporta providers com auth-profile OAuth
    //    com expiração — um provider de api_key puro como deepseek não
    //    aparece ali mesmo configurado e funcionando). A releitura do
    //    config.get prova que a ESCRITA colou (a apiKey aparece redactada,
    //    não vazia); não prova que o VALOR da chave é válido — isso só uma
    //    chamada de completions real confirmaria, fora do escopo aqui.
    await new Promise((r) => setTimeout(r, 3000));
    const verifyRes = await rpc(gateway, "config.get", {});
    const verifyProviders = extractProviders(verifyRes.body);
    const providerNode = verifyProviders?.[provider];
    const keyPresent = !!providerNode?.apiKey && String(providerNode.apiKey).trim().length > 0;

    return json({
      success: true,
      provider,
      verified: keyPresent,
      verification: keyPresent
        ? `Provedor ${provider} tem uma chave gravada no Gateway após o restart. ` +
          `Isso confirma que a ESCRITA funcionou — a validade da chave em si só se confirma no primeiro uso real.`
        : `A escrita foi aceita, mas não consegui confirmar a chave presente após o restart. ` +
          `Verifique manualmente antes de considerar concluído.`,
      gatewayConfigAfterWrite: providerNode ?? null,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
