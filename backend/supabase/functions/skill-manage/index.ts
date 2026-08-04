import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// SKILL_SYNC_SECRET deixou de ser constante de módulo: agora pode vir do banco
// (integration_secrets) com fallback para o ambiente, e leitura de banco não
// cabe em inicialização de módulo. Lido dentro do handler.
// Env-based gateway URLs — no dn.ia-specific defaults. Each install
// configures its own gateway via env secrets (or public.vps_config).
const GATEWAY_URL = (Deno.env.get("OPENCLAW_GATEWAY_URL") || "").replace(/\/$/, "");
const SKILLS_GATEWAY_URL = (Deno.env.get("SKILLS_GATEWAY_URL") || GATEWAY_URL).replace(/\/$/, "");
const GATEWAY_TOKEN =
  Deno.env.get("OPENCLAW_GATEWAY_TOKEN") || Deno.env.get("OPENCLAW_ADMIN_TOKEN") || "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

// Run a promise in the background without blocking the response.
// Supabase Edge Runtime supports EdgeRuntime.waitUntil; fall back to fire-and-forget.
function runInBackground(promise: Promise<unknown>) {
  try {
    // @ts-ignore — EdgeRuntime is provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(promise);
      return;
    }
  } catch { /* ignore */ }
  promise.catch((e) => console.error("[background]", e));
}

// ─── Gateway sync helpers ─────────────────────────────────────────
function isHtmlResponse(contentType: string | null, body: string) {
  return (contentType ?? "").includes("text/html") || /^\s*<!doctype html/i.test(body) || /^\s*<html/i.test(body);
}

function gatewaySkillUrls(agentId: string, gatewayUrl: string, skillsGatewayUrl: string, slug?: string) {
  const encodedAgent = encodeURIComponent(agentId);
  const encodedSlug = slug ? `/${encodeURIComponent(slug)}` : "";
  // Primary: direct VPS (bypasses Cloudflare). Fallbacks: public gateway paths
  // in case SKILLS_GATEWAY_URL is unreachable from the edge runtime.
  return [
    `${skillsGatewayUrl}/admin/agents/${encodedAgent}/skills${encodedSlug}`,
    `${gatewayUrl}/skills-api/agents/${encodedAgent}/skills${encodedSlug}`,
    `${gatewayUrl}/admin/agents/${encodedAgent}/skills${encodedSlug}`,
  ];
}

function gatewaySkillRequestUrls(agentId: string, gatewayUrl: string, skillsGatewayUrl: string) {
  const encodedAgent = encodeURIComponent(agentId);
  return [
    `${gatewayUrl}/api/skills/${encodedAgent}/request`,
    `${skillsGatewayUrl}/api/skills/${encodedAgent}/request`,
  ];
}

function normalizeGatewaySourceUrl(source?: string | null, sourceUrl?: string | null): { ok: true; sourceUrl: string | null } | { ok: false; error: string } {
  if (source !== "git" || !sourceUrl) return { ok: true, sourceUrl: sourceUrl ?? null };

  const raw = String(sourceUrl).trim();
  if (!/^https?:\/\//i.test(raw) || /\s/.test(raw)) {
    return {
      ok: false,
      error: "URL Git inválida: informe apenas a URL HTTPS do repositório, sem mensagens de erro ou texto adicional.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "URL Git inválida: informe uma URL HTTPS válida do repositório." };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "URL Git inválida: informe uma URL HTTPS válida do repositório." };
  }

  parsed.hash = "";
  parsed.search = "";

  if (parsed.hostname.toLowerCase() === "github.com") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return { ok: false, error: "URL Git inválida: use o formato https://github.com/usuario/repositorio." };
    }
    // Subpastas (/tree/branch/...) são suportadas — o gateway converte automaticamente.
    return { ok: true, sourceUrl: parsed.toString() };
  }


  if (!/\.git$/i.test(parsed.pathname)) {
    return { ok: false, error: "URL Git inválida: repositórios fora do GitHub devem terminar em .git." };
  }

  return { ok: true, sourceUrl: parsed.toString() };
}


async function gatewayInstall(
  agentId: string,
  slug: string,
  extra?: { source?: string; source_url?: string | null },
  gateway?: { url?: string; token?: string },
): Promise<{ ok: boolean; error?: string }> {
  const gatewayUrl = (gateway?.url || GATEWAY_URL).replace(/\/$/, "");
  const skillsGatewayUrl = (SKILLS_GATEWAY_URL || gatewayUrl).replace(/\/$/, "");
  const token = gateway?.token || GATEWAY_TOKEN;
  if (!gatewayUrl && !skillsGatewayUrl) return { ok: false, error: "Gateway URL not configured" };
  if (!token) return { ok: false, error: "Gateway token not configured" };
  try {
    const sourceCheck = normalizeGatewaySourceUrl(extra?.source, extra?.source_url);
    if (!sourceCheck.ok) return { ok: false, error: sourceCheck.error };

    const payload: Record<string, unknown> = { skill: slug };
    if (extra?.source) payload.source = extra.source;
    if (sourceCheck.sourceUrl) payload.source_url = sourceCheck.sourceUrl;
    let lastError = "gateway unreachable";
    for (const url of gatewaySkillUrls(agentId, gatewayUrl, skillsGatewayUrl)) {
      let res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return { ok: true };

      let errorText = (await res.text()).slice(0, 500);

      // Gateway leftover: skill folder exists on disk but not registered.
      // Uninstall to clean up, then retry install once.
      if (res.status === 500 && /already exists/i.test(errorText)) {
        console.warn(`[gatewayInstall] cleanup stale folder for agent=${agentId} slug=${slug}`);
        await fetch(`${url}/${encodeURIComponent(slug)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        }).catch(() => {});
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) return { ok: true };
        errorText = (await res.text()).slice(0, 500);
      }

      lastError = `gateway ${res.status} at ${url}: ${isHtmlResponse(res.headers.get("content-type"), errorText) ? "HTML response from proxy/UI" : errorText}`;
      console.error(`[gatewayInstall] url=${url} agent=${agentId} slug=${slug} status=${res.status} error=${errorText}`);

      if (res.status !== 404 && !isHtmlResponse(res.headers.get("content-type"), errorText)) break;
    }
    for (const url of gatewaySkillRequestUrls(agentId, gatewayUrl, skillsGatewayUrl)) {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return { ok: true };
      const errorText = (await res.text()).slice(0, 500);
      lastError = `gateway ${res.status} at ${url}: ${isHtmlResponse(res.headers.get("content-type"), errorText) ? "HTML response from proxy/UI" : errorText}`;
      console.error(`[gatewayInstall] fallback url=${url} agent=${agentId} slug=${slug} status=${res.status} error=${errorText}`);
      if (res.status !== 404 && !isHtmlResponse(res.headers.get("content-type"), errorText)) break;
    }
    return { ok: false, error: lastError };

  } catch (e: any) {
    console.error(`[gatewayInstall] agent=${agentId} slug=${slug} exception=${e?.message ?? "unknown"}`);
    return { ok: false, error: e?.message ?? "gateway unreachable" };
  }
}

async function gatewayUninstall(
  agentId: string,
  slug: string,
  gateway?: { url?: string; token?: string },
): Promise<{ ok: boolean; error?: string }> {
  const gatewayUrl = (gateway?.url || GATEWAY_URL).replace(/\/$/, "");
  const skillsGatewayUrl = (SKILLS_GATEWAY_URL || gatewayUrl).replace(/\/$/, "");
  const token = gateway?.token || GATEWAY_TOKEN;
  if (!gatewayUrl && !skillsGatewayUrl) return { ok: false, error: "Gateway URL not configured" };
  if (!token) return { ok: false, error: "Gateway token not configured" };
  try {
    let lastError = "gateway unreachable";
    for (const url of gatewaySkillUrls(agentId, gatewayUrl, skillsGatewayUrl, slug)) {
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return { ok: true };
      if (res.status === 404) continue;
      lastError = `gateway ${res.status}: ${(await res.text()).slice(0, 200)}`;
      return { ok: false, error: lastError };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "gateway unreachable" };
  }
}


function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function err(msg: string, status = 400) {
  return json({ error: msg }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return err("Unauthorized", 401);

  const syncSecret = await getIntegrationSecret(admin, "SKILL_SYNC_SECRET");
  const isSyncCall = !!syncSecret && authHeader === `Bearer ${syncSecret}`;

  let isSuperAdmin = false;
  if (!isSyncCall) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return err("Unauthorized", 401);
    const { data: roleRow } = await userClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    isSuperAdmin = !!roleRow;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return err("Invalid JSON body");
  }
  const { action } = body ?? {};
  if (!action) return err("Missing action");

  // Exclusão de skill é ato de ADMINISTRADOR, pela interface — nem membro
  // comum, nem agente com o token de sync (o sync cria e atualiza; apagar o
  // conhecimento da rede é decisão humana). Item da task #7: "hoje qualquer
  // agente apaga".
  if (action === "delete" && !isSuperAdmin) {
    return err("Apenas administradores podem excluir skills — e somente pela interface.", 403);
  }

  // ─── LIST ──────────────────────────────────────────────────────
  if (action === "list") {
    const { agent_id } = body;

    if (agent_id) {
      const { data, error } = await admin
        .from("agent_skills")
        .select("skill_id, installed_by, sync_status, sync_error, skills(*)")
        .eq("agent_id", agent_id);
      if (error) return err(error.message);
      return json(data ?? []);
    }

    const { data: skills, error } = await admin
      .from("skills")
      .select("*, agent_skills(agent_id, installed_by, sync_status, sync_error)")
      .order("created_at", { ascending: false });
    if (error) return err(error.message);

    const allAgentIds = Array.from(
      new Set(
        (skills ?? []).flatMap((s: any) =>
          (s.agent_skills ?? []).map((as: any) => as.agent_id)
        )
      )
    );

    const agentMap: Record<string, { name: string; avatar_url?: string }> = {};
    if (allAgentIds.length) {
      const { data: agents } = await admin
        .from("agent_profiles")
        .select("agent_id, name, avatar_url")
        .in("agent_id", allAgentIds);
      for (const a of (agents ?? []) as any[]) {
        agentMap[a.agent_id] = { name: a.name, avatar_url: a.avatar_url };
      }
    }

    const enriched = (skills ?? []).map((s: any) => ({
      ...s,
      agent_skills: (s.agent_skills ?? []).map((as: any) => ({
        ...as,
        agent: agentMap[as.agent_id] ?? { name: as.agent_id },
      })),
    }));

    return json(enriched);
  }

  // Gateway is required only for write/sync actions. Listing skills must keep
  // working on fresh remixes so the app can render an empty/read-only state
  // instead of surfacing a 5xx runtime error.
  const gateway = await getGatewayConfig(admin);
  const resolvedGatewayUrl = (gateway.url || GATEWAY_URL || SKILLS_GATEWAY_URL).replace(/\/$/, "");
  const resolvedGatewayToken = gateway.token || GATEWAY_TOKEN;

  if (!resolvedGatewayUrl && !SKILLS_GATEWAY_URL) {
    return json({
      error: "Gateway não configurado.",
      action: "Acesse Settings → Configurações e insira a URL do seu VPS.",
      code: "GATEWAY_NOT_CONFIGURED",
    }, 409);
  }
  const resolvedGateway = { url: resolvedGatewayUrl, token: resolvedGatewayToken };

  // ─── CREATE ────────────────────────────────────────────────────
  if (action === "create") {
    const { slug, name, description, content, source, source_url, is_default, agent_ids } = body;
    if (!slug || !name || !content) return err("slug, name and content are required");

    const sourceKind = source ?? "manual";
    const sourceCheck = normalizeGatewaySourceUrl(sourceKind, source_url ?? null);
    if (sourceCheck.ok === false) return err(sourceCheck.error);
    const cleanSourceUrl = sourceCheck.sourceUrl;

    const { data: skill, error } = await admin
      .from("skills")
      .insert({
        slug,
        name,
        description: description ?? null,
        content,
        source: sourceKind,
        source_url: cleanSourceUrl,
        is_default: !!is_default,
      })
      .select("id")
      .single();
    if (error) {
      // O slug de instalação via Git vem do último pedaço da URL (ex.:
      // .../skills/social → "social") — colide fácil com skill que já
      // existe. "duplicate key value violates unique constraint" não diz
      // isso a quem instala; a mensagem tem que dizer.
      if (error.code === "23505") {
        return err(
          `Já existe uma skill com o apelido "${slug}". ` +
          `Exclua a existente ou instale com outro nome — o apelido vem do fim da URL do repositório.`,
        );
      }
      return err(error.message);
    }

    const targetSet = new Set<string>(Array.isArray(agent_ids) ? agent_ids : []);

    if (is_default) {
      const { data: agents } = await admin.from("agent_profiles").select("agent_id");
      for (const a of (agents ?? []) as any[]) targetSet.add(a.agent_id);
    }

    const syncResults: Record<string, { ok: boolean; error?: string; note?: string }> = {};
    if (targetSet.size) {
      const rows = Array.from(targetSet).map((agent_id) => ({
        agent_id,
        skill_id: skill.id,
        installed_by: is_default ? "default" : "user",
        sync_status: "pending",
        sync_error: null as string | null,
      }));
      await admin.from("agent_skills").insert(rows);

      // As linhas nascem 'pending'; o puller da VPS instala e reporta.
      for (const agent_id of targetSet) {
        syncResults[agent_id] = { ok: true, note: "aguardando o sincronizador da VPS" };
      }
    }

    return json({ skillId: skill.id, sync: syncResults });
  }


  // ─── ASSIGN / UNASSIGN ─────────────────────────────────────────
  if (action === "assign") {
    const { skill_id, agent_id, remove } = body;
    if (!skill_id || !agent_id) return err("skill_id and agent_id required");

    // Fetch slug + source for gateway call
    const { data: skillRow } = await admin
      .from("skills")
      .select("slug, source, source_url")
      .eq("id", skill_id)
      .maybeSingle();
    const slug = skillRow?.slug;
    const source = (skillRow as any)?.source ?? "manual";
    const source_url = (skillRow as any)?.source_url ?? null;

    if (remove) {
      // Remoção também é intenção: apagar a linha aqui e "desinstalar em
      // segundo plano" deixava a VPS com a skill registrada para sempre
      // quando o empurrão falhava. A linha vira 'removing' e só some quando
      // a VPS confirmar que desregistrou.
      const { error } = await admin
        .from("agent_skills")
        .update({ sync_status: "removing", sync_error: null })
        .eq("skill_id", skill_id)
        .eq("agent_id", agent_id);
      if (error) return err(error.message);
      return json({ ok: true, sync: { ok: true, note: "remoção aguardando o sincronizador da VPS" } });
    } else {
      const { error } = await admin
        .from("agent_skills")
        .upsert(
          { skill_id, agent_id, installed_by: "user", sync_status: "pending", sync_error: null },
          { onConflict: "agent_id,skill_id" }
        );
      if (error) return err(error.message);

      // A linha fica 'pending' e o PULLER da VPS executa: o empurrão daqui
      // morria no Cloudflare (POST engolido na borda — 01/08), e skill manual
      // nem tinha como materializar arquivos por esse caminho. O selo do
      // agente vira 'synced' quando a VPS reportar — segundos, via realtime.
      return json({ ok: true, sync: { ok: true, note: "aguardando o sincronizador da VPS" } });
    }

  }

  // ─── UPDATE ────────────────────────────────────────────────────
  if (action === "update") {
    const { skill_id, name, description, content, is_default } = body;
    if (!skill_id) return err("skill_id required");

    const patch: Record<string, unknown> = { sync_status: "pending" };
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;

    if (content !== undefined) {
      patch.content = content;
      const { data: current } = await admin
        .from("skills")
        .select("version")
        .eq("id", skill_id)
        .single();
      if (current?.version) {
        const parts = String(current.version).split(".").map((n) => Number(n) || 0);
        while (parts.length < 3) parts.push(0);
        parts[2] = parts[2] + 1;
        patch.version = parts.join(".");
      }
    }

    if (is_default !== undefined) {
      patch.is_default = !!is_default;
      if (is_default) {
        const { data: agents } = await admin.from("agent_profiles").select("agent_id");
        const { data: existing } = await admin
          .from("agent_skills")
          .select("agent_id")
          .eq("skill_id", skill_id);
        const existingIds = new Set((existing ?? []).map((e: any) => e.agent_id));
        const newRows = (agents ?? [])
          .filter((a: any) => !existingIds.has(a.agent_id))
          .map((a: any) => ({
            agent_id: a.agent_id,
            skill_id,
            installed_by: "default",
            sync_status: "pending",
          }));
        if (newRows.length) await admin.from("agent_skills").insert(newRows);
      }
    }

    const { error } = await admin.from("skills").update(patch).eq("id", skill_id);
    if (error) return err(error.message);
    return json({ ok: true });
  }

  // ─── DELETE ────────────────────────────────────────────────────
  if (action === "delete") {
    const { skill_id } = body;
    if (!skill_id) return err("skill_id required");

    // Fetch slug + all agents that have it, so we can uninstall from gateway
    const { data: skillRow } = await admin
      .from("skills")
      .select("slug, agent_skills(agent_id)")
      .eq("id", skill_id)
      .maybeSingle();
    const slug: string | undefined = (skillRow as any)?.slug;
    const agentIds: string[] = ((skillRow as any)?.agent_skills ?? []).map((r: any) => r.agent_id);

    if (slug && agentIds.length) {
      runInBackground(Promise.all(agentIds.map((aid) => gatewayUninstall(aid, slug, resolvedGateway))));
    }

    const { error } = await admin.from("skills").delete().eq("id", skill_id);
    if (error) return err(error.message);
    return json({ ok: true });
  }

  // ─── UPSERT (reverse sync from Lia / cron) ─────────────────────
  if (action === "upsert") {
    const { slug, name, description, content, agent_id } = body;
    if (!slug || !name || !content || !agent_id) {
      return err("slug, name, content and agent_id required");
    }

    const { data: skill, error } = await admin
      .from("skills")
      .upsert(
        {
          slug,
          name,
          description: description ?? "",
          content,
          source: "agent",
        },
        { onConflict: "slug" }
      )
      .select("id")
      .single();
    if (error) return err(error.message);

    await admin.from("agent_skills").upsert(
      {
        skill_id: skill.id,
        agent_id,
        installed_by: "agent",
        sync_status: "synced",
      },
      { onConflict: "agent_id,skill_id" }
    );

    return json({ ok: true });
  }

  // ─── UNASSIGN (reverse sync: skill removed from agent externally) ──
  // ─── PULL / REPORT — o sincronizador da VPS ───────────────────
  // Só o token de sync usa estas ações. A VPS puxa as intenções (conexão de
  // dentro para fora — o Cloudflare não intercepta), executa localmente
  // (materializa arquivos, registra no agente, desregistra) e reporta.
  if (action === "pull") {
    if (!isSyncCall) return err("pull é exclusivo do sincronizador", 403);
    // LONG-POLL: segura a resposta até aparecer trabalho (máx. 20s). O clique
    // na UI vira instalação em 1-2s em vez de esperar o próximo ciclo — e o
    // total de chamadas CAI: uma a cada ~20s ocioso, contra uma a cada 7s.
    const esperaMax = Math.min(Number(body.waitSeconds) || 0, 20) * 1000;
    const inicio = Date.now();
    let rows: any[] | null = null;
    for (;;) {
      const { data, error } = await admin
        .from("agent_skills")
        .select("skill_id, agent_id, sync_status, skills ( slug, name, source, source_url, content )")
        .in("sync_status", ["pending", "removing"])
        .limit(20);
      if (error) return err(error.message);
      rows = data;
      if ((rows?.length ?? 0) > 0 || Date.now() - inicio >= esperaMax) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const tasks = (rows ?? []).map((r: any) => ({
      skill_id: r.skill_id,
      agent_id: r.agent_id,
      op: r.sync_status === "removing" ? "remove" : "install",
      slug: r.skills?.slug ?? null,
      name: r.skills?.name ?? null,
      source: r.skills?.source ?? "manual",
      source_url: r.skills?.source_url ?? null,
      // Conteúdo vai junto: é assim que skill manual (criada no editor)
      // finalmente ganha arquivos no disco da VPS.
      content: r.skills?.content ?? null,
    })).filter((t: any) => t.slug);
    return json({ tasks });
  }

  if (action === "report") {
    if (!isSyncCall) return err("report é exclusivo do sincronizador", 403);
    const results: Array<{ skill_id: string; agent_id: string; status: string; error?: string }> =
      Array.isArray(body.results) ? body.results : [];
    let aplicados = 0;
    for (const r of results) {
      if (!r?.skill_id || !r?.agent_id) continue;
      if (r.status === "removed") {
        // A VPS confirmou que desregistrou: agora sim a linha some.
        const { error } = await admin
          .from("agent_skills")
          .delete()
          .eq("skill_id", r.skill_id).eq("agent_id", r.agent_id)
          .eq("sync_status", "removing");
        if (!error) aplicados++;
      } else if (r.status === "synced" || r.status === "error") {
        const { error } = await admin
          .from("agent_skills")
          .update({
            sync_status: r.status,
            sync_error: r.status === "error" ? (r.error ?? "falha no sincronizador").slice(0, 500) : null,
          })
          .eq("skill_id", r.skill_id).eq("agent_id", r.agent_id)
          // Não sobrescreve uma intenção nova que chegou enquanto a VPS trabalhava.
          .in("sync_status", ["pending", "removing"]);
        if (!error) aplicados++;
      }
    }
    return json({ ok: true, aplicados });
  }

  if (action === "unassign") {
    const { slug, agent_id } = body;
    if (!slug || !agent_id) return err("slug and agent_id required");

    const { data: skillRow } = await admin
      .from("skills")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (!skillRow?.id) return json({ ok: true, note: "skill not found, nothing to unassign" });

    const { error } = await admin
      .from("agent_skills")
      .delete()
      .eq("skill_id", skillRow.id)
      .eq("agent_id", agent_id);
    if (error) return err(error.message);

    return json({ ok: true });
  }

  return err("Unknown action");
});
