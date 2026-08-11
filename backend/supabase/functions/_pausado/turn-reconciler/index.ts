// turn-reconciler — o circuito de controle sem LLM (task #13).
//
// Chamado a cada minuto pelo pg_cron (invoke_edge_function). Compara os turnos
// pendentes de agent_turns com o estado real das sessões no gateway e decide
// POR TABELA — nenhuma decisão passa por modelo:
//
//   sessão rodando, dentro do orçamento  -> wait (não escreve evento repetido)
//   sessão rodando além do orçamento     -> watchdog_flag (só anota; agir é a task #14)
//   sessão concluída, resposta já pousou -> ledger_fix (marca delivered — livro-caixa,
//                                           acontece nos DOIS modos)
//   sessão concluída com texto final     -> deliver (via agent-reply-webhook, que já
//                                           tem dedup validado)
//   sessão concluída SEM texto final     -> nudge (sessions_send: "componha a resposta")
//                                           — no máximo 1 por turno
//   sessão não encontrada                -> tenta de novo; após o teto, abandona
//
// MODO (app_settings.reconciler_mode): "observe" registra o que TERIA feito e
// não age sobre o usuário; "active" entrega e cutuca de verdade. O livro-caixa
// e os contadores rodam nos dois modos.
//
// PROTEÇÕES: teto de tentativas por turno, no máximo 1 cutucão por turno,
// disjuntor por sessão (máx. 3 ações/hora), abandono após 24h com motivo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Orçamentos e tetos. Valores de partida deliberadamente folgados — trabalho
// longo é legítimo (requisito explícito); o watchdog só ANOTA por enquanto.
const GRACE_MS = 90_000;            // turno mais novo que isto ainda está no fluxo normal
// Os orçamentos do watchdog vivem em app_settings (watchdog_soft_minutes /
// watchdog_hard_minutes) — ajustar cadência não exige deploy.
const MAX_ATTEMPTS = 10;            // sessão não encontrada N vezes -> abandona
const ABANDON_HOURS = 24;
const BREAKER_MAX_ACTIONS = 3;      // ações por sessão por hora
const BATCH_LIMIT = 20;             // turnos por rodada — mantém a função rápida
// Timeouts folgados: o ensaio de 27/07 mostrou o gateway levando mais de 8s
// no sessions_history de sessão pesada (143k tokens) — a chamada chegava lá
// (aparecia no feed de atividades) e quem desistia era este lado, virando
// "history_unavailable" em todas as tentativas.
const LIST_TIMEOUT_MS = 15_000;
const HISTORY_TIMEOUT_MS = 25_000;
const SEND_TIMEOUT_MS = 15_000;

// Quanto tempo um sub-agente concluído espera antes de virar promessa vencida
// — dá chance de a sessão-mãe reportar sozinha pelo caminho natural.
const SUBAGENT_GRACE_MS = 120_000;
const SUBAGENT_WINDOW_MIN = 180; // janela do subagents list

// ATENÇÃO (29/07): sessions_send NÃO existe na superfície HTTP do gateway
// (404 "Tool not available"). O ramo done_no_text abaixo ainda tenta — e o
// diário registra a falha com o motivo. Transporte alternativo do cutucão de
// turno é pendência aberta na task #18; o caso dos SUB-AGENTES já não
// depende dele (o relatório é composto por nós, das sessões-filhas).
const NUDGE_MESSAGE =
  "Seu turno anterior terminou numa chamada de ferramenta, sem resposta final ao usuário. " +
  "Os resultados já estão disponíveis na sessão. Componha AGORA a resposta final e envie — " +
  "não execute novas ferramentas além do estritamente necessário para responder.";

interface Turn {
  id: string;
  agent_id: string;
  user_id: string;
  session_key: string;
  user_message_ts: string;
  status: string;
  dispatched_at: string;
  attempts: number;
  nudged_at: string | null;
  last_decision: string | null;
  warned_soft_at: string | null;
  warned_hard_at: string | null;
}

// Prefixos dos avisos do watchdog. São status, não resposta: o trigger de
// entrega e o dedup os ignoram, senão o próprio aviso de "ainda trabalhando"
// fecharia o turno e o reconciliador pararia de vigiá-lo.
const SOFT_PREFIX = "⏳ Ainda trabalhando";
const HARD_PREFIX = "⚠️ Sem retorno há";

// Default defensivo: chamada sem timeout explícito ganha 15s em vez de
// abortar em 0ms (setTimeout com undefined) — a classe de bug de 17:56.
function fetchWithTimeout(url: string, init: RequestInit, ms = 15_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

type ToolResult = { ok: true; data: unknown } | { ok: false; why: string };

/**
 * Chama uma tool do gateway via /tools/invoke — o mesmo caminho do
 * dm-agent-reply. Devolve o MOTIVO da falha, não só null: o ensaio mostrou
 * que "falhou" sem causa não permite distinguir timeout de gateway fora.
 */
async function invokeTool(
  gateway: { url: string; token: string },
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
): Promise<ToolResult> {
  try {
    const res = await fetchWithTimeout(`${gateway.url}/tools/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gateway.token}`,
        "Content-Type": "application/json",
      },
      // O campo é `args`, NÃO `arguments` — descoberto por sonda na VPS em
      // 27/07: o /tools/invoke IGNORA `arguments` em silêncio (sessions_list
      // com agentId=milo devolvia as 100 sessões da Lia, o agente padrão).
      // Com `args`, os parâmetros chegam de verdade ao tool.
      body: JSON.stringify({ tool, args }),
    }, timeoutMs);
    if (!res.ok) {
      // O corpo do erro é o diagnóstico: "http_400" sozinho não diz se foi
      // argumento inválido, sessão inexistente ou tool não exposta.
      const body = await res.text().catch(() => "");
      console.warn(`[reconciler] ${tool} HTTP ${res.status}: ${body.slice(0, 200)}`);
      return { ok: false, why: `http_${res.status}: ${body.slice(0, 140)}` };
    }
    const envelope = await res.json();
    const text = envelope?.result?.content?.[0]?.text;
    if (typeof text !== "string") {
      return { ok: false, why: "envelope_sem_texto" };
    }
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const why = e instanceof DOMException && e.name === "AbortError"
      ? `timeout_${timeoutMs}ms`
      : `fetch: ${msg.slice(0, 80)}`;
    console.warn(`[reconciler] ${tool} failed:`, why);
    return { ok: false, why };
  }
}

/** Extrai o texto final da última mensagem do assistente no histórico. */
function extractFinalText(history: unknown): { text: string | null; stopReason: string | null } {
  const messages = (history as { messages?: unknown[] })?.messages;
  if (!Array.isArray(messages)) return { text: null, stopReason: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown; stopReason?: string };
    if (m?.role !== "assistant") continue;
    const blocks = Array.isArray(m.content) ? m.content : [];
    const texts = blocks
      .filter((b: unknown) => (b as { type?: string })?.type === "text")
      .map((b: unknown) => String((b as { text?: string }).text ?? ""))
      .filter((t: string) => t.trim().length > 0);
    const joined = texts.length > 0 ? texts.join("\n\n").trim() : "";
    // Placeholders não são resposta. NO_REPLY é a convenção dos agentes para
    // "não vou responder" (o diário flagrou um "TERIA entregue: NO_REPLY");
    // os demais são os marcadores conhecidos do dm-agent-reply.
    const lower = joined.toLowerCase();
    const isPlaceholder =
      joined === "" ||
      lower === "no_reply" ||
      lower === "noreply" ||
      lower.startsWith("no response from") ||
      lower.startsWith("sem resposta do agente");
    return {
      text: isPlaceholder ? null : joined,
      stopReason: m.stopReason ?? null,
    };
  }
  return { text: null, stopReason: null };
}

/**
 * A resposta deste turno já pousou em conversations? (mesmo dedup do
 * dm-agent-reply). Marcadores de falha puros NÃO contam como entrega — a
 * mesma regra do trigger; sem isto, um "No response from OpenClaw" gravado
 * pelo frontend suprimiria a entrega da resposta real. O fragmento com
 * "⌛ Resposta interrompida" CONTA: o usuário viu texto parcial de verdade.
 */
async function replyAlreadyPersisted(turn: Turn): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("agent_id", turn.agent_id)
    .eq("user_id", turn.user_id)
    .eq("role", "agent")
    .gt("created_at", turn.user_message_ts)
    .not("content", "ilike", "no response from%")
    .not("content", "ilike", "sem resposta do agente%")
    .not("content", "like", "⚠️ Não consegui finalizar%")
    .not("content", "like", `${SOFT_PREFIX}%`)
    .not("content", "like", `${HARD_PREFIX}%`)
    .limit(1);
  if (error) {
    console.warn("[reconciler] dedup check failed:", error.message);
    // Na dúvida, diz que sim: falso positivo aqui significa NÃO entregar — o
    // erro barato. O contrário entregaria duplicado.
    return true;
  }
  return (data?.length ?? 0) > 0;
}

/** Disjuntor: quantas ações reais nesta sessão na última hora? */
async function actionsInLastHour(sessionKey: string): Promise<number> {
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from("agent_turn_events")
    .select("id", { count: "exact", head: true })
    .eq("session_key", sessionKey)
    .eq("acted", true)
    .gt("created_at", oneHourAgo);
  return count ?? 0;
}

async function recordEvent(
  turn: Turn,
  observed: string,
  decision: string,
  acted: boolean,
  detail?: string,
): Promise<void> {
  // 'wait' repetido não vira evento — um turno longo geraria uma linha por
  // minuto e afogaria o diário. O last_checked_at no turno prova que ele foi
  // visto; o evento só entra quando a DECISÃO muda ou quando há ação.
  if (decision === turn.last_decision && !acted) return;
  const { error } = await supabase.from("agent_turn_events").insert({
    turn_id: turn.id,
    session_key: turn.session_key,
    observed,
    decision,
    acted,
    detail: detail?.slice(0, 500) ?? null,
  });
  if (error) console.warn("[reconciler] event insert failed:", error.message);
}

async function updateTurn(turn: Turn, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("agent_turns")
    .update({ ...patch, last_checked_at: new Date().toISOString() })
    .eq("id", turn.id);
  if (error) console.warn("[reconciler] turn update failed:", error.message);
}

/**
 * Publica um aviso de status no chat. NÃO passa pelo agent-reply-webhook:
 * aquilo é para resposta de agente e dispararia a lógica de entrega. Aqui é
 * insert direto + notificação, para o badge acender como em mensagem normal.
 *
 * A notificação vai com agent_id e sem canal — o caminho que só passou a
 * contar badge depois da correção de 27/07 (task #8).
 */
async function postStatus(turn: Turn, content: string): Promise<boolean> {
  const { error } = await supabase.from("conversations").insert({
    agent_id: turn.agent_id,
    user_id: turn.user_id,
    role: "agent",
    content,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.warn("[reconciler] status insert failed:", error.message);
    return false;
  }
  const agentName = turn.agent_id.charAt(0).toUpperCase() + turn.agent_id.slice(1);
  await supabase.from("notifications").insert({
    user_id: turn.user_id,
    agent_id: turn.agent_id,
    author_name: agentName,
    content_preview: content.slice(0, 160),
  });
  return true;
}

/**
 * Lista sub-agentes ativos para enriquecer o aviso — "aguardando 2
 * sub-agentes" diz muito mais que "sem retorno". Best-effort: se a tool não
 * responder, o aviso sai sem essa parte.
 */
async function describeSubagents(gateway: { url: string; token: string }): Promise<string> {
  const res = await invokeTool(gateway, "subagents", { action: "list", recentMinutes: 60 }, LIST_TIMEOUT_MS);
  if (!res.ok) return "";
  const list = (res.data as { subagents?: unknown[]; items?: unknown[] });
  const arr = Array.isArray(list?.subagents) ? list.subagents : Array.isArray(list?.items) ? list.items : [];
  const running = arr.filter((s: unknown) => {
    const st = String((s as { status?: string })?.status ?? "").toLowerCase();
    return st === "running" || st === "active" || st === "";
  });
  if (running.length === 0) return "";
  const names = running
    .map((s: unknown) => (s as { taskName?: string; label?: string })?.taskName ?? (s as { label?: string })?.label)
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  return names
    ? ` Aguardando ${running.length} sub-agente(s): ${names}.`
    : ` Aguardando ${running.length} sub-agente(s).`;
}

/** Entrega via agent-reply-webhook — reusa o caminho com dedup já validado. */
async function deliverViaWebhook(turn: Turn, content: string): Promise<{ ok: boolean; why?: string }> {
  const secret = await getIntegrationSecret(supabase, "AGENT_REPLY_WEBHOOK_SECRET");
  if (!secret) {
    return { ok: false, why: "AGENT_REPLY_WEBHOOK_SECRET indisponivel" };
  }
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const res = await fetchWithTimeout(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/agent-reply-webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": secret,
          // O webhook não está no config.toml, então verify_jwt fica LIGADO:
          // sem um JWT válido a plataforma devolve 401 antes de a função
          // rodar — foi o "webhook falhou" da primeira entrega real (16:54
          // de 27/07). A service key satisfaz o gate; o segredo continua
          // sendo a autenticação de verdade, conferida dentro da função.
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
        },
        body: JSON.stringify({
          agent_id: turn.agent_id,
          user_id: turn.user_id,
          content,
          in_reply_to_ts: turn.user_message_ts,
          status: "completed",
        }),
      },
      // Sem este argumento o abort dispara IMEDIATAMENTE (setTimeout com
      // undefined = 0ms) — foi o "The signal has been aborted" de 17:56.
      20_000,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, why: `http_${res.status}: ${body.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, why: `fetch: ${msg.slice(0, 80)}` };
  }
}

/** Evento de expectativa (sem turno): registra no mesmo diário, turn_id nulo. */
async function recordExpectationEvent(
  sessionKey: string,
  observed: string,
  decision: string,
  acted: boolean,
  detail?: string,
): Promise<void> {
  const { error } = await supabase.from("agent_turn_events").insert({
    turn_id: null,
    session_key: sessionKey,
    observed,
    decision,
    acted,
    detail: detail?.slice(0, 500) ?? null,
  });
  if (error) console.warn("[reconciler] expectation event failed:", error.message);
}

/** Alguma entrega REAL ao usuário depois de `afterIso`? (mesmos filtros de marcador) */
async function deliveredAfter(agentId: string, userId: string, afterIso: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("agent_id", agentId)
    .eq("user_id", userId)
    .eq("role", "agent")
    .gt("created_at", afterIso)
    .not("content", "ilike", "no response from%")
    .not("content", "ilike", "sem resposta do agente%")
    .not("content", "like", "⚠️ Não consegui finalizar%")
    .not("content", "like", `${SOFT_PREFIX}%`)
    .not("content", "like", `${HARD_PREFIX}%`)
    .limit(1);
  if (error) return true; // na dúvida, considera entregue — o erro barato
  return (data?.length ?? 0) > 0;
}

/**
 * Expectativas de sub-agente (task #18). Caso real de 28/07: "vou ver o
 * status" + silêncio, com o resultado pronto — o usuário teve que perguntar.
 *
 * O ciclo: lista os sub-agentes, anota em subagent_watch, e quando um lote
 * conclui sem NENHUMA entrega ao usuário depois disso (carência de 2min),
 * cutuca a sessão-mãe UMA vez e registra um turno sintético em agent_turns —
 * daí em diante o pipeline normal entrega. Um dono só para a entrega.
 */
async function sweepSubagents(
  gateway: { url: string; token: string },
  canAct: boolean,
  bump: (k: string) => void,
): Promise<void> {
  // Fonte: sessions_list com busca por "subagent" — sondado em 28/07. A tool
  // `subagents` é ESCOPADA AO CHAMADOR (por HTTP executa como o agente padrão
  // e devolve sempre vazio); já as sessões-filhas aparecem no sessions_list
  // com chave agent:{id}:subagent:{uuid} e carregam parentSessionKey — o
  // campo exato de quem é a mãe. Uma chamada por agente conhecido.
  const { data: profileRows } = await supabase
    .from("agent_profiles")
    .select("agent_id")
    .limit(30);
  const agentIds = (profileRows ?? [])
    .map((r: { agent_id: string }) => r.agent_id)
    .filter((id: string) => /^[a-z0-9-]{2,32}$/.test(id));

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const seenKeys = new Set<string>();
  for (const sweepAgentId of agentIds) {
    const res = await invokeTool(gateway, "sessions_list", {
      agentId: sweepAgentId,
      search: "subagent",
      activeMinutes: SUBAGENT_WINDOW_MIN,
      limit: 50,
    }, LIST_TIMEOUT_MS);
    if (!res.ok) {
      console.warn(`[reconciler] sessions_list(subagent) ${sweepAgentId} failed:`, res.why);
      continue;
    }
    const sessions = ((res.data as { sessions?: unknown[] })?.sessions ?? []) as Array<Record<string, unknown>>;
    for (const s of sessions) {
      const childKey = str(s.key);
      // Só sessões-filhas de verdade — a busca textual pode trazer outras.
      if (!childKey || !/^agent:[a-z0-9-]+:subagent:/.test(childKey)) continue;
      seenKeys.add(childKey);
      const parentKey = str(s.parentSessionKey) ?? str(s.spawnedBy) ?? "";
      const agentId = str(s.agentId) ?? sweepAgentId;
      const label = str(s.label) ?? str(s.displayName);
      const statusRaw = String(s.status ?? "").toLowerCase();
      const isDone = statusRaw !== "" && statusRaw !== "running";

      const { data: existing } = await supabase
        .from("subagent_watch")
        .select("child_key, completed_at")
        .eq("child_key", childKey)
        .maybeSingle();

      if (!existing) {
        await supabase.from("subagent_watch").insert({
          child_key: childKey,
          agent_id: agentId,
          parent_session_key: parentKey,
          label,
          status: statusRaw || "running",
          completed_at: isDone ? new Date().toISOString() : null,
        });
      } else if (isDone && !existing.completed_at) {
        await supabase.from("subagent_watch")
          .update({ status: statusRaw || "done", completed_at: new Date().toISOString() })
          .eq("child_key", childKey);
      }
    }
  }

  // Semântica provável da lista: quem terminou pode simplesmente SUMIR dela,
  // em vez de aparecer com status "done". Sub-agente vigiado que estava
  // rodando e não apareceu nesta rodada (com 2min de tolerância desde a
  // primeira vez visto) é tratado como concluído.
  const vanishCutoff = new Date(Date.now() - SUBAGENT_GRACE_MS).toISOString();
  const { data: vanished } = await supabase
    .from("subagent_watch")
    .select("child_key")
    .is("completed_at", null)
    .is("resolved_at", null)
    .lt("first_seen_at", vanishCutoff);
  const vanishedKeys = (vanished ?? [])
    .map((r: { child_key: string }) => r.child_key)
    .filter((k: string) => !seenKeys.has(k));
  if (vanishedKeys.length > 0) {
    await supabase.from("subagent_watch")
      .update({ status: "gone", completed_at: new Date().toISOString() })
      .in("child_key", vanishedKeys);
  }

  // Promessas vencidas: concluídos há mais de 2min, não resolvidos, agrupados
  // pela sessão-mãe — um cutucão cobre o lote inteiro.
  const graceCutoff = new Date(Date.now() - SUBAGENT_GRACE_MS).toISOString();
  const { data: open } = await supabase
    .from("subagent_watch")
    .select("child_key, agent_id, parent_session_key, label, completed_at, nudged_at")
    .is("resolved_at", null)
    .not("completed_at", "is", null)
    .lt("completed_at", graceCutoff)
    .limit(100);

  const byParent = new Map<string, NonNullable<typeof open>>();
  for (const row of open ?? []) {
    if (!row.parent_session_key) continue;
    const list = byParent.get(row.parent_session_key) ?? [];
    list.push(row);
    byParent.set(row.parent_session_key, list);
  }

  for (const [parentKey, children] of byParent) {
    // Só sabemos entregar para sessão de DM — dela extraímos agente e usuário.
    const m = parentKey.match(/^agent:([a-z0-9-]{2,32}):openai-user:dm:([0-9a-f-]{36}):/);
    if (!m) {
      // Sessão-mãe fora do padrão de DM (main, cron, telegram): não há a quem
      // entregar por este canal — resolve com nota para não reprocessar.
      await supabase.from("subagent_watch")
        .update({ resolved_at: new Date().toISOString() })
        .in("child_key", children.map((c) => c.child_key));
      await recordExpectationEvent(parentKey, "subagents_done", "skip_non_dm", false, `${children.length} sub-agente(s)`);
      bump("subagent_skip_non_dm");
      continue;
    }
    const [, agentId, userId] = m;
    const earliest = children.reduce((min, c) => (c.completed_at! < min ? c.completed_at! : min), children[0].completed_at!);

    if (await deliveredAfter(agentId, userId, earliest)) {
      await supabase.from("subagent_watch")
        .update({ resolved_at: new Date().toISOString() })
        .in("child_key", children.map((c) => c.child_key));
      await recordExpectationEvent(parentKey, "subagents_done", "resolved_naturally", false, `${children.length} sub-agente(s) reportados`);
      bump("subagent_resolved");
      continue;
    }

    if ((await actionsInLastHour(parentKey)) >= BREAKER_MAX_ACTIONS) {
      await recordExpectationEvent(parentKey, "subagents_done_unreported", "breaker_open", false);
      bump("breaker_open");
      continue;
    }

    // O relatório é composto POR NÓS, lendo o resultado direto das sessões-
    // filhas — sessions_history funciona por HTTP em qualquer sessão. Zero
    // LLM, zero cutucão. (A 1ª versão usava sessions_send para cutucar a mãe
    // + turno sintético: o sessions_send NÃO existe na superfície HTTP — 404
    // em 29/07 — e o turno sintético entregou o último texto REQUENTADO da
    // sessão, duplicando a tabela de disparo na tela do usuário.)
    const parts: string[] = [];
    for (const c of children.slice(0, 6)) {
      const hist = await invokeTool(gateway, "sessions_history", {
        sessionKey: c.child_key,
        limit: 4,
        includeTools: false,
      }, HISTORY_TIMEOUT_MS);
      if (!hist.ok) continue;
      const { text } = extractFinalText(hist.data);
      const name = c.label ?? c.child_key.split(":").pop()?.slice(0, 8) ?? "sub-agente";
      if (text) parts.push(`**${name}**\n${text.slice(0, 1200)}`);
    }

    if (parts.length === 0) {
      // Filhos concluídos sem texto final legível — nada digno de entrega.
      // Anota e resolve para não insistir a cada ciclo.
      await supabase.from("subagent_watch")
        .update({ resolved_at: new Date().toISOString() })
        .in("child_key", children.map((c) => c.child_key));
      await recordExpectationEvent(parentKey, "subagents_done_unreported", "children_sem_texto", false, `${children.length} filho(s) sem texto final`);
      bump("subagent_no_text");
      continue;
    }

    const report = `🤖 Resultado dos sub-agentes (${parts.length}/${children.length}):\n\n${parts.join("\n\n")}`;

    if (canAct) {
      const pseudoTurn = {
        agent_id: agentId,
        user_id: userId,
        user_message_ts: earliest,
      } as Turn;
      const delivery = await deliverViaWebhook(pseudoTurn, report);
      if (delivery.ok) {
        await supabase.from("subagent_watch")
          .update({ resolved_at: new Date().toISOString(), nudged_at: new Date().toISOString() })
          .in("child_key", children.map((c) => c.child_key));
        await recordExpectationEvent(parentKey, "subagents_done_unreported", "deliver_report", true, `${parts.length} resultado(s) entregues`);
        bump("subagent_report_delivered");
      } else {
        // Fica em aberto para a próxima rodada; o disjuntor limita insistência.
        await recordExpectationEvent(parentKey, "subagents_done_unreported", "deliver_report", false, `webhook: ${delivery.why}`);
        bump("subagent_report_failed");
      }
    } else {
      await supabase.from("subagent_watch")
        .update({ nudged_at: new Date().toISOString() })
        .in("child_key", children.map((c) => c.child_key));
      await recordExpectationEvent(parentKey, "subagents_done_unreported", "deliver_report", false, `TERIA entregue: ${report.slice(0, 160)}`);
      bump("subagent_would_deliver");
    }
  }

  // Higiene: registros antigos saem sozinhos.
  await supabase.from("subagent_watch").delete().lt("first_seen_at", new Date(Date.now() - 7 * 86400_000).toISOString());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");

  const t0 = Date.now();
  const summary: Record<string, number> = {};
  const bump = (k: string) => { summary[k] = (summary[k] ?? 0) + 1; };

  // Modo: observe (padrão) ou active. A troca é um UPDATE em app_settings.
  const { data: modeRow } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "reconciler_mode")
    .maybeSingle();
  const mode = modeRow?.value === "active" ? "active" : "observe";
  const canAct = mode === "active";

  // Orçamentos do watchdog em app_settings: ajustar cadência é UPDATE, não
  // deploy. Os valores certos só aparecem com uso real.
  const { data: budgetRows } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["watchdog_soft_minutes", "watchdog_hard_minutes"]);
  const readMinutes = (key: string, fallback: number) => {
    const raw = budgetRows?.find((r: { key: string }) => r.key === key)?.value;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const softBudgetMs = readMinutes("watchdog_soft_minutes", 8) * 60_000;
  const hardBudgetMs = readMinutes("watchdog_hard_minutes", 30) * 60_000;

  // Gateway antes de tudo: a varredura de sub-agentes roda MESMO sem turno
  // pendente — promessa vencida não depende de haver turno em aberto.
  const gateway = await getGatewayConfig(supabase);
  if (gateway.url && gateway.token) {
    try {
      await sweepSubagents(gateway, canAct, bump);
    } catch (e) {
      console.warn("[reconciler] sweepSubagents threw:", e instanceof Error ? e.message : e);
    }
  }

  // Abandono por idade — antes de tudo, para não gastar consultas com fósseis.
  const abandonBefore = new Date(Date.now() - ABANDON_HOURS * 3600_000).toISOString();
  const { data: fossils } = await supabase
    .from("agent_turns")
    .update({ status: "abandoned", detail: `pendente ha mais de ${ABANDON_HOURS}h` })
    .eq("status", "pending")
    .lt("dispatched_at", abandonBefore)
    .select("id");
  if (fossils && fossils.length > 0) summary.abandoned_by_age = fossils.length;

  // Os pendentes fora do período de graça.
  const graceBefore = new Date(Date.now() - GRACE_MS).toISOString();
  const { data: turnRows, error: turnsErr } = await supabase
    .from("agent_turns")
    .select("id, agent_id, user_id, session_key, user_message_ts, status, dispatched_at, attempts, nudged_at, last_decision, warned_soft_at, warned_hard_at")
    .eq("status", "pending")
    // Canal fica de fora: a entrega dele acontece em channel_messages, e todo
    // o caminho de entrega daqui grava em conversations. Reconciliar um turno
    // de canal aqui despejaria a resposta na DM errada. O turno de canal
    // existe para dar VISIBILIDADE (parede, analytics); quem entrega é o
    // channel-agent-reply, que já tem retry e marcador de falha próprios.
    .neq("source", "channel")
    .lt("dispatched_at", graceBefore)
    .order("dispatched_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (turnsErr) {
    return Response.json({ ok: false, error: turnsErr.message }, { status: 500 });
  }
  const turns = (turnRows ?? []) as Turn[];
  if (turns.length === 0) {
    return Response.json({ ok: true, mode, checked: 0, summary, ms: Date.now() - t0 });
  }

  if (!gateway.url || !gateway.token) {
    // Gateway não configurado: nada a fazer, mas deixa rastro de que olhou.
    return Response.json({ ok: true, mode, checked: 0, note: "gateway não configurado" });
  }

  // Uma sessions_list por agente, não por turno.
  const agentIds = [...new Set(turns.map((t) => t.session_key.split(":")[1]).filter(Boolean))];
  const sessionsByKey = new Map<string, { status?: string }>();
  let gatewayReachable = true;
  let listFailWhy = "";
  // activeMinutes derruba o custo da listagem: a Lia tem 238+ sessões e o
  // sessions_list sem filtro estourava 15s (timeout_15000ms no diário de
  // 27/07). Turno pendente é recente por definição — só interessam sessões
  // atualizadas desde o turno mais velho da rodada, com folga.
  const oldestMs = Math.min(...turns.map((t) => new Date(t.dispatched_at).getTime()));
  const activeMinutes = Math.max(30, Math.ceil((Date.now() - oldestMs) / 60_000) + 30);
  for (const agentId of agentIds) {
    const result = await invokeTool(gateway, "sessions_list", { agentId, activeMinutes, limit: 60 }, LIST_TIMEOUT_MS);
    if (!result.ok) {
      gatewayReachable = false;
      listFailWhy = result.why;
      continue;
    }
    const sessions = (result.data as { sessions?: Array<{ key?: string; status?: string }> })?.sessions ?? [];
    for (const s of sessions) {
      if (s?.key) sessionsByKey.set(s.key, s);
    }
  }

  if (!gatewayReachable && sessionsByKey.size === 0) {
    // Gateway fora do ar: registra a janela (insumo do recovery, task #15) e
    // não conta tentativa contra os turnos — a falha não é deles.
    for (const turn of turns) {
      await recordEvent(turn, "gateway_unreachable", "outage", false, listFailWhy);
      await updateTurn(turn, { last_decision: "outage" });
      bump("outage");
    }
    return Response.json({ ok: true, mode, checked: turns.length, summary, ms: Date.now() - t0 });
  }

  for (const turn of turns) {
    bump("checked");

    // Teto de tentativas na ENTRADA, valendo para qualquer ramo. O diário
    // flagrou um turno com 30 tentativas: o abandono só existia no ramo de
    // sessão não encontrada, e o retry do history girava sem limite.
    if (turn.attempts >= MAX_ATTEMPTS) {
      await recordEvent(turn, "attempts_exhausted", "abandon", true, `${turn.attempts} tentativas (ultima: ${turn.last_decision ?? "?"})`);
      await updateTurn(turn, { status: "abandoned", detail: `teto de ${MAX_ATTEMPTS} tentativas`, last_decision: "abandon" });
      bump("abandoned");
      continue;
    }

    const session = sessionsByKey.get(turn.session_key);

    // Sessão não encontrada — pode ser corrida (recém-criada) ou chave errada.
    if (!session) {
      const attempts = turn.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await recordEvent(turn, "session_not_found", "abandon", true, `apos ${attempts} tentativas`);
        await updateTurn(turn, { status: "abandoned", attempts, detail: "sessao nunca encontrada no gateway", last_decision: "abandon" });
        bump("abandoned");
      } else {
        await recordEvent(turn, "session_not_found", "retry_later", false, `tentativa ${attempts}`);
        await updateTurn(turn, { attempts, last_decision: "retry_later" });
        bump("not_found");
      }
      continue;
    }

    // Rodando: trabalho longo é LEGÍTIMO e não se interrompe. O watchdog só
    // tira o silêncio — dois avisos, um de cada nível, uma vez cada.
    if (session.status === "running") {
      const ageMs = Date.now() - new Date(turn.dispatched_at).getTime();
      const minutes = Math.round(ageMs / 60_000);

      if (ageMs >= hardBudgetMs && !turn.warned_hard_at) {
        const extra = canAct ? await describeSubagents(gateway) : "";
        const msg =
          `${HARD_PREFIX} ${minutes} minutos.${extra} ` +
          `A tarefa continua rodando no servidor e pode terminar sozinha — ` +
          `se preferir não esperar, use o botão de parar aqui no chat.`;
        const ok = canAct ? await postStatus(turn, msg) : false;
        await recordEvent(turn, "running_over_hard_budget", "watchdog_hard", ok, canAct ? `${minutes}min` : `TERIA avisado (${minutes}min)`);
        await updateTurn(turn, ok
          ? { warned_hard_at: new Date().toISOString(), last_decision: "watchdog_hard" }
          : { last_decision: "watchdog_hard" });
        bump(ok ? "warned_hard" : "would_warn_hard");
        continue;
      }

      if (ageMs >= softBudgetMs && !turn.warned_soft_at && !turn.warned_hard_at) {
        const extra = canAct ? await describeSubagents(gateway) : "";
        const msg = `${SOFT_PREFIX} nisso — já são ${minutes} minutos.${extra} Te aviso quando terminar.`;
        const ok = canAct ? await postStatus(turn, msg) : false;
        await recordEvent(turn, "running_over_soft_budget", "watchdog_soft", ok, canAct ? `${minutes}min` : `TERIA avisado (${minutes}min)`);
        await updateTurn(turn, ok
          ? { warned_soft_at: new Date().toISOString(), last_decision: "watchdog_soft" }
          : { last_decision: "watchdog_soft" });
        bump(ok ? "warned_soft" : "would_warn_soft");
        continue;
      }

      await updateTurn(turn, { last_decision: "wait" });
      bump("waiting");
      continue;
    }

    // Sessão concluída. Primeiro o livro-caixa: a resposta já pousou por outro
    // caminho? Marca e sai — isto NÃO é ação sobre o usuário, roda nos 2 modos.
    if (await replyAlreadyPersisted(turn)) {
      await recordEvent(turn, "done_reply_persisted", "ledger_fix", true, "resposta ja estava em conversations");
      await updateTurn(turn, { status: "delivered", delivered_at: new Date().toISOString(), last_decision: "ledger_fix" });
      bump("ledger_fixed");
      continue;
    }

    // Concluída e nada persistido: o que a sessão tem a dizer?
    const historyResult = await invokeTool(gateway, "sessions_history", {
      sessionKey: turn.session_key,
      limit: 6,
      includeTools: false,
    }, HISTORY_TIMEOUT_MS);
    if (!historyResult.ok) {
      const attempts = turn.attempts + 1;
      await recordEvent(turn, "history_unavailable", "retry_later", false, `tentativa ${attempts}: ${historyResult.why}`);
      await updateTurn(turn, { attempts, last_decision: "retry_later" });
      bump("history_failed");
      continue;
    }

    const { text, stopReason } = extractFinalText(historyResult.data);

    // Disjuntor antes de qualquer ação sobre o usuário.
    const recentActions = await actionsInLastHour(turn.session_key);
    if (recentActions >= BREAKER_MAX_ACTIONS) {
      await recordEvent(turn, text ? "done_with_text" : "done_no_text", "breaker_open", false, `${recentActions} acoes na ultima hora`);
      await updateTurn(turn, { last_decision: "breaker_open" });
      bump("breaker_open");
      continue;
    }

    if (text) {
      // Turno perdido clássico: sessão terminou com resposta e ninguém entregou.
      if (canAct) {
        const delivery = await deliverViaWebhook(turn, text);
        const ok = delivery.ok;
        await recordEvent(turn, "done_with_text", "deliver", ok, ok ? `entregue: ${text.slice(0, 120)}` : `webhook falhou: ${delivery.why}`);
        if (ok) {
          // O webhook insere em conversations -> o trigger marca delivered.
          bump("delivered");
        } else {
          await updateTurn(turn, { attempts: turn.attempts + 1, last_decision: "deliver_failed" });
          bump("deliver_failed");
        }
      } else {
        await recordEvent(turn, "done_with_text", "deliver", false, `TERIA entregue: ${text.slice(0, 200)}`);
        await updateTurn(turn, { last_decision: "deliver" });
        bump("would_deliver");
      }
      continue;
    }

    // Concluída sem texto final (o caso dos sub-agentes: stopReason toolUse).
    if (turn.nudged_at) {
      // Já cutucou uma vez e continua sem texto — não insiste; anota e conta.
      const attempts = turn.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await recordEvent(turn, "done_no_text", exhausted ? "abandon" : "nudge_exhausted", exhausted, `stopReason=${stopReason ?? "?"}`);
      await updateTurn(turn, exhausted
        ? { status: "abandoned", attempts, detail: "sem texto final mesmo apos cutucao", last_decision: "abandon" }
        : { attempts, last_decision: "nudge_exhausted" });
      bump(exhausted ? "abandoned" : "nudge_exhausted");
      continue;
    }

    if (canAct) {
      const sendResult = await invokeTool(gateway, "sessions_send", {
        sessionKey: turn.session_key,
        message: NUDGE_MESSAGE,
        timeoutSeconds: 0,
      }, SEND_TIMEOUT_MS);
      const ok = sendResult.ok;
      await recordEvent(turn, "done_no_text", "nudge", ok, `stopReason=${stopReason ?? "?"}${ok ? "" : ` (sessions_send: ${sendResult.ok ? "" : sendResult.why})`}`);
      await updateTurn(turn, ok
        ? { nudged_at: new Date().toISOString(), last_decision: "nudge" }
        : { attempts: turn.attempts + 1, last_decision: "nudge_failed" });
      bump(ok ? "nudged" : "nudge_failed");
    } else {
      await recordEvent(turn, "done_no_text", "nudge", false, `TERIA cutucado (stopReason=${stopReason ?? "?"})`);
      await updateTurn(turn, { last_decision: "nudge" });
      bump("would_nudge");
    }
  }

  return Response.json({ ok: true, mode, summary, ms: Date.now() - t0 });
});
