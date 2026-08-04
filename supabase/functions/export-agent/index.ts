// Synchronous .dnos export — asks the ORCHESTRATOR agent to read SOUL.md/
// IDENTITY.md/TOOLS.md/AGENTS.md live from the VPS (via its own file-access
// tools) and return the raw content in one chat completion. No agent-task,
// no polling, no cron scheduling.
//
// Por que não ler direto via HTTP do gateway (como antes): confirmado por
// teste real (2026-07-19) que o gateway em produção não expõe NENHUM
// endpoint de leitura de arquivo funcional (/api/files, agents.files.get RPC,
// /api/agents/{id}/{key} — todos 404 ou "method not supported"). O único
// jeito real de ler o arquivo é pedir pro agente, que tem acesso de
// filesystem próprio na VPS.
//
// Por que não usar Loop Architecture (agent-task) pra isso: é uma operação
// só de LEITURA, sem efeito colateral — não precisa do controle de estado
// (checkpoint/complete/watchdog) que existe pra proteger contra duplicar
// TRABALHO. Repetir uma leitura não machuca nada; uma chamada de chat
// direta, com timeout generoso, é suficiente e mais simples.
//
// O agente só devolve o CONTEÚDO BRUTO dos arquivos — toda a substituição de
// placeholder, sanitização de UUID e extração de conectores/capacidades
// continua determinística, em código (as mesmas funções de sempre), não
// delegada ao LLM.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(to);
  }
}

// Extrai o primeiro objeto JSON válido de um texto — o agente pode responder
// com o JSON puro, ou embrulhado em prosa/cerca de código (```json ... ```).
function extractJsonObject(text: string): any | null {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* tenta variações abaixo */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* segue tentando */ }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* falhou de vez */ }
  }
  return null;
}

// Pede pro orquestrador ler os arquivos AO VIVO na VPS (com as próprias
// ferramentas de arquivo dele) e devolver o conteúdo bruto — sem placeholder,
// sem interpretação. Timeout generoso (leitura real de múltiplos arquivos).
async function readWorkspaceFilesViaOrchestrator(
  gatewayUrl: string,
  token: string,
  executorId: string,
  targetAgentId: string,
): Promise<{ soul: string | null; identity: string | null; tools: string | null; agents: string | null }> {
  const prompt =
    `Leia estes arquivos do workspace do agente "${targetAgentId}" na VPS:\n` +
    `/root/.openclaw/workspace-${targetAgentId}/SOUL.md\n` +
    `/root/.openclaw/workspace-${targetAgentId}/IDENTITY.md\n` +
    `/root/.openclaw/workspace-${targetAgentId}/TOOLS.md\n` +
    `/root/.openclaw/workspace-${targetAgentId}/AGENTS.md\n\n` +
    `Responda APENAS com um JSON, sem nenhum texto antes ou depois, neste formato exato:\n` +
    `{"SOUL.md": "<conteúdo literal completo>", "IDENTITY.md": "<conteúdo literal completo>", ` +
    `"TOOLS.md": "<conteúdo literal ou null se o arquivo não existir>", ` +
    `"AGENTS.md": "<conteúdo literal ou null se o arquivo não existir>"}\n` +
    `Não resuma, não interprete, não aplique nenhuma substituição — devolva o texto EXATO de cada arquivo.`;

  const res = await fetchWithTimeout(`${gatewayUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Força Flash SÓ nesta chamada (não muda a config do agente) — ler
      // arquivo e formatar texto é tool-calling simples, exatamente onde o
      // Flash é ~2,3x mais rápido que o modelo padrão do orquestrador
      // (geralmente Pro). Contrato confirmado hoje (Lia, teste real).
      "x-openclaw-model": "deepseek-v4-flash",
    },
    body: JSON.stringify({
      model: `openclaw:${executorId}`,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  }, 170_000);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gateway retornou ${res.status} ao pedir leitura ao orquestrador: ${errText.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => null);
  const replyText: string | undefined = data?.choices?.[0]?.message?.content;
  if (typeof replyText !== "string" || !replyText.trim()) {
    throw new Error("O orquestrador não retornou nenhum conteúdo.");
  }
  const parsed = extractJsonObject(replyText);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Não foi possível interpretar a resposta do orquestrador como JSON.");
  }
  const asStr = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return {
    soul: asStr(parsed["SOUL.md"]),
    identity: asStr(parsed["IDENTITY.md"]),
    tools: asStr(parsed["TOOLS.md"]),
    agents: asStr(parsed["AGENTS.md"]),
  };
}

// Replace live company data with placeholders (fallback when .templates/ absent)
function restorePlaceholders(content: string, profile: Record<string, unknown> | null): string {
  if (!content || !profile) return content;
  const map: Array<[unknown, string]> = [
    [profile.name ?? profile.company_name, "{{COMPANY_NAME}}"],
    [profile.founder_name, "{{FOUNDER_NAME}}"],
    [profile.segment, "{{COMPANY_SEGMENT}}"],
    [profile.description, "{{COMPANY_DESCRIPTION}}"],
    [profile.target_audience, "{{TARGET_AUDIENCE}}"],
    [profile.products_services ?? profile.product, "{{COMPANY_PRODUCT}}"],
    [profile.tone ?? profile.brand_voice, "{{BRAND_VOICE}}"],
    [profile.mission, "{{MISSION}}"],
    [profile.differentials, "{{DIFFERENTIALS}}"],
    [profile.gateway_url, "{{GATEWAY_URL}}"],
  ];
  const pairs = map
    .filter(([v]) => typeof v === "string" && (v as string).trim().length >= 3) as Array<[string, string]>;
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = content;
  for (const [value, token] of pairs) {
    const esc = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), token);
  }
  return out;
}

const CONNECTOR_KEYWORDS: Array<[string, string[]]> = [
  ["meta-ads", ["meta ads", "meta-ads", "meta_ads"]],
  ["meta", ["facebook graph", "meta graph"]],
  ["instagram", ["instagram"]],
  ["google-ads", ["google ads", "google-ads"]],
  ["google-oauth", ["google sheets", "google drive"]],
  ["linkedin", ["linkedin"]],
  ["telegram", ["telegram"]],
  ["slack", ["slack"]],
  ["whatsapp", ["whatsapp"]],
  ["canva", ["canva"]],
  ["elevenlabs", ["elevenlabs", "eleven labs"]],
  ["perplexity", ["perplexity"]],
  ["anthropic", ["anthropic", "claude"]],
  ["deepseek", ["deepseek"]],
  ["gemini", ["gemini"]],
];

function extractConnectors(soul: string, identity: string): string[] {
  const hay = `${soul}\n${identity}`.toLowerCase();
  const set = new Set<string>();
  for (const [id, keys] of CONNECTOR_KEYWORDS) {
    if (keys.some((k) => hay.includes(k))) set.add(id);
  }
  return [...set];
}

function extractCapabilities(soul: string): string[] {
  const set = new Set<string>();
  const re = /(?:capacidades|habilidades|skills)[^\n]*\n((?:\s*[-*]\s+.+\n?)+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(soul)) !== null) {
    m[1].split("\n").forEach((line) => {
      const item = line.replace(/^\s*[-*]\s+/, "").trim();
      if (item) set.add(item.toLowerCase().slice(0, 60));
    });
  }
  return [...set];
}

// Strip platform-specific UUIDs (dn.task boards/lists/members, etc.) so
// the .dnos is safe to share across instances. Keeps contextual hints
// when the UUID is labeled inline, e.g. `board dn.ia (5e6c...)`.
/**
 * Infra e nomes: o que o replace por company_profile não alcança — flagrado
 * na auditoria do primeiro .dnos real (29/07): IP da VPS com usuário SSH,
 * URL do projeto Supabase (14x), e primeiros nomes soltos ("Rodrigo" não
 * casa com "Rodrigo Nascimento"). A função CONHECE esses valores (vps_config
 * + próprio ambiente + profile), então a limpeza é determinística.
 */
function sanitizeInfraAndNames(
  content: string,
  gatewayUrl: string,
  profile: Record<string, unknown> | null,
  extraNames: string[] = [],
): string {
  if (!content) return content;
  let out = content;

  // URL do Supabase desta instalação (a função sabe a própria casa).
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (supabaseUrl) {
    const host = supabaseUrl.replace(/^https?:\/\//, "");
    out = out.split(supabaseUrl).join("{{SUPABASE_URL}}");
    out = out.split(host).join("{{SUPABASE_HOST}}");
  }

  // Host/IP do gateway (vem do vps_config). Também pega "root@IP".
  const gwHost = gatewayUrl.replace(/^https?:\/\//, "").replace(/:\d+.*$/, "");
  if (gwHost) {
    out = out.split(`root@${gwHost}`).join("{{VPS_SSH}}");
    out = out.split(gwHost).join("{{VPS_HOST}}");
  }

  // Regra categórica: num arquivo exportável NÃO EXISTE IP legítimo — o
  // vps_config pode guardar um domínio (gateway atrás de Cloudflare) e o IP
  // cru aparecer só no texto (flagrado: "root@<ip>" na seção SSH do
  // TOOLS.md da Lia, 29/07). Loopback fica; o resto vira placeholder.
  out = out.replace(/\buser@\d{1,3}(?:\.\d{1,3}){3}\b|\broot@\d{1,3}(?:\.\d{1,3}){3}\b/g, "{{VPS_SSH}}");
  out = out.replace(/\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}(?:\.\d{1,3}){3}\b/g, "{{IP_ADDRESS}}");

  // Nomes próprios: cada palavra (4+ letras) dos campos de gente/empresa do
  // profile vira placeholder, por palavra inteira, sem case. "dn.ia" também
  // gera a variante sem pontuação ("dnia").
  const nameTokens = new Set<string>();
  const collect = (v: unknown, minLen = 4) => {
    if (typeof v !== "string") return;
    for (const w of v.split(/[\s,;/]+/)) {
      const clean = w.trim();
      if (clean.length >= minLen) {
        nameTokens.add(clean);
        const noPunct = clean.replace(/[^\p{L}\p{N}]/gu, "");
        if (noPunct.length >= minLen && noPunct !== clean) nameTokens.add(noPunct);
      }
    }
  };
  const p = (profile ?? {}) as Record<string, unknown>;
  collect(p.founder_name);
  collect(p.name ?? p.company_name, 3);
  // Nomes dos usuários da instalação (tabela profiles): as pessoas da
  // empresa, por definição — fonte determinística pros nomes que o
  // company_profile não carrega (ex.: sócios que não são o founder).
  for (const n of extraNames) collect(n);
  for (const token of [...nameTokens].sort((a, b) => b.length - a.length)) {
    const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), "{{COMPANY_REF}}");
  }
  return out;
}

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
function sanitizeUuids(content: string): string {
  if (!content) return content;
  return content.replace(UUID_RE, (match, offset: number, full: string) => {
    // Look at ~40 chars before the UUID to guess a semantic placeholder.
    const ctx = full.slice(Math.max(0, offset - 60), offset).toLowerCase();
    if (/\bboard\b/.test(ctx)) return "{{DN_TASK_BOARD_ID}}";
    if (/\blist(a)?\b/.test(ctx)) return "{{DN_TASK_LIST_ID}}";
    if (/\b(member|membro|user|usuario|usuário)\b/.test(ctx)) return "{{DN_TASK_MEMBER_ID}}";
    if (/\bcard\b/.test(ctx)) return "{{DN_TASK_CARD_ID}}";
    if (/\bcron\b/.test(ctx)) return "{{CRON_ID}}";
    if (/\bagent(e)?\b/.test(ctx)) return "{{AGENT_UUID}}";
    return "{{PLATFORM_UUID}}";
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const agentId = String(body?.agent_id ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(agentId)) return json({ error: "agent_id inválido" }, 400);

  const service = createClient(supabaseUrl, serviceKey);
  const config = await getGatewayConfig(service);
  if (!config.url || !config.token) {
    return json({ error: "Gateway não configurado — conecte o Gateway em Configurações primeiro" }, 400);
  }

  // Resolve o orquestrador (líder) — nunca hardcoded, funciona em qualquer remix.
  const { data: leader } = await service
    .from("agent_profiles")
    .select("agent_id, openclaw_id")
    .eq("is_leader", true)
    .limit(1)
    .maybeSingle();
  const executorId = leader?.openclaw_id ?? leader?.agent_id;
  if (!executorId) {
    return json({ error: "Orquestrador não encontrado (agent_profiles.is_leader ausente)" }, 400);
  }

  // Fonte primária: a tabela agent_files, mantida fresca pela ponte
  // determinística (dnos-files-bridge, timer de 60s na VPS). Zero LLM.
  // Fallback: o caminho antigo via orquestrador — só para instalação que
  // ainda não tem a ponte rodando.
  let soul: string | null = null;
  let identity: string | null = null;
  let tools: string | null = null;
  let agents: string | null = null;
  let source = "bridge";

  const { data: bridged } = await service
    .from("agent_files")
    .select("file_name, content, synced_at")
    .eq("agent_id", agentId)
    .in("file_name", ["SOUL.md", "IDENTITY.md", "TOOLS.md", "AGENTS.md", "LEARNINGS.md"]);

  const byName = new Map((bridged ?? []).map((r: { file_name: string; content: string | null }) => [r.file_name, r.content]));
  const asStr2 = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  soul = asStr2(byName.get("SOUL.md"));
  identity = asStr2(byName.get("IDENTITY.md"));
  tools = asStr2(byName.get("TOOLS.md"));
  agents = asStr2(byName.get("AGENTS.md"));
  // Aprendizado portável: limpo por construção (regras no AGENTS.md do
  // agente), e ainda assim passa pela mesma sanitização dos demais — cinto
  // e suspensório para o arquivo que viaja entre empresas.
  let learnings = asStr2(byName.get("LEARNINGS.md"));

  if (!soul || !identity) {
    // Ponte ainda não espelhou este agente — tenta o caminho antigo.
    source = "orchestrator";
    try {
      const read = await readWorkspaceFilesViaOrchestrator(config.url, config.token, executorId, agentId);
      soul = read.soul ?? soul;
      identity = read.identity ?? identity;
      tools = read.tools ?? tools;
      agents = read.agents ?? agents;
    } catch (e) {
      return json({
        error: `Não foi possível exportar: ${(e as Error).message} ` +
          "A ponte de arquivos ainda não espelhou este agente e a leitura via orquestrador falhou. " +
          "Confira se o dnos-files-bridge está ativo na VPS (systemctl status dnos-files-bridge.timer) " +
          "e tente novamente em ~1 minuto.",
        code: "ORCHESTRATOR_READ_FAILED",
      }, 502);
    }
  }

  if (!soul || !identity) {
    return json({
      error: "Não foi possível exportar: os arquivos deste agente (SOUL.md/IDENTITY.md) não foram " +
        "encontrados. Possíveis causas: (1) o agente ainda não terminou o onboarding; " +
        "(2) a ponte de arquivos (dnos-files-bridge) não está rodando na VPS. ",
      code: "TEMPLATES_NOT_FOUND",
    }, 404);
  }

  // Sanitize live files with company_profile → replaces real company data
  // with {{PLACEHOLDERS}} so the .dnos is safe to share.
  const { data: profile } = await service.from("company_profile").select("*").maybeSingle();
  soul = restorePlaceholders(soul, profile as any);
  identity = restorePlaceholders(identity, profile as any);
  if (tools) tools = restorePlaceholders(tools, profile as any);
  if (agents) agents = restorePlaceholders(agents, profile as any);
  if (learnings) learnings = restorePlaceholders(learnings, profile as any);

  // Strip platform-specific UUIDs from every shipped file.
  soul = sanitizeUuids(soul);
  identity = sanitizeUuids(identity);
  if (tools) tools = sanitizeUuids(tools);
  if (agents) agents = sanitizeUuids(agents);
  if (learnings) learnings = sanitizeUuids(learnings);

  // Terceira passada: infra (IP/host da VPS, URL do Supabase) e nomes de
  // pessoas — o que o replace por valores exatos do profile não alcança.
  const { data: peopleRows } = await service.from("profiles").select("full_name").limit(50);
  const peopleNames = (peopleRows ?? [])
    .map((r: { full_name: string | null }) => r.full_name ?? "")
    .filter(Boolean);
  const scrub = (c: string) => sanitizeInfraAndNames(c, config.url, profile as Record<string, unknown> | null, peopleNames);
  soul = scrub(soul);
  identity = scrub(identity);
  if (tools) tools = scrub(tools);
  if (agents) agents = scrub(agents);
  if (learnings) learnings = scrub(learnings);

  const { data: agent } = await service
    .from("agent_profiles")
    .select("agent_id, name, role, department, color, emoji, description")
    .eq("agent_id", agentId)
    .maybeSingle();

  const files: Record<string, string> = {
    "SOUL.md": soul,
    "IDENTITY.md": identity,
  };
  if (tools) files["TOOLS.md"] = tools;
  if (agents) files["AGENTS.md"] = agents;
  if (learnings) files["LEARNINGS.md"] = learnings;

  // Skills REAIS do agente (não só a lista de frases extraída do SOUL): o
  // conteúdo completo vai no .dnos e a importação as recria via skill-manage.
  // Também sanitizadas — skill escrita por agente pode citar dados da empresa.
  const { data: skillRows } = await service
    .from("agent_skills")
    .select("skills(slug, name, description, content)")
    .eq("agent_id", agentId);
  const skills = (skillRows ?? [])
    .map((r: { skills: { slug: string; name: string; description: string | null; content: string | null } | null }) => r.skills)
    .filter((s): s is NonNullable<typeof s> => !!s?.slug && !!s?.content)
    .map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description ?? "",
      content: scrub(sanitizeUuids(restorePlaceholders(s.content!, profile as any))),
    }));

  const dnos = {
    dnos_version: "1.1",
    exported_at: new Date().toISOString(),
    source,
    agent: {
      agent_id: agent?.agent_id ?? agentId,
      name: agent?.name ?? agentId,
      role: agent?.role ?? null,
      department: agent?.department ?? null,
      description: agent?.description ?? null,
      author: "exportado via dn.os",
      color: agent?.color ?? null,
      emoji: agent?.emoji ?? null,
    },
    required_connectors: extractConnectors(soul, identity),
    capabilities: extractCapabilities(soul),
    skills,
    files,
  };

  return json(dnos, 200);
});
