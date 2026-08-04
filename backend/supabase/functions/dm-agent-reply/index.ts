/**
 * dm-agent-reply — Fire-and-forget agent reply for DM conversations.
 *
 * Returns 200 immediately with { ok: true, status: "processing" }.
 * The gateway call runs in background — the Deno isolate stays alive
 * for pending promises (up to the wall clock limit).
 *
 * The frontend polls `conversations` table for the result.
 *
 * Duplicate protection: before inserting, checks if an agent reply
 * already exists after the user's last message.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { markTurnFailed, registerTurn } from "../_shared/agent-turns.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AGENT_SESSION_VERSION = "v2";


function extractReplyTexts(data: any): string[] {
  const results: string[] = [];

  // Collect from every choice (multi-message bursts)
  const choices = Array.isArray(data?.choices) ? data.choices : [];
  for (const ch of choices) {
    const content = ch?.message?.content;
    if (typeof content === "string" && content.trim()) {
      results.push(content.trim());
    } else if (Array.isArray(content)) {
      const parts = content
        .filter((p: any) => typeof p?.text === "string")
        .map((p: any) => p.text);
      if (parts.length) results.push(parts.join("\n").trim());
    }
  }

  // Responses API format: data.output[] with multiple assistant messages
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item.type === "message" && item.role === "assistant") {
        if (typeof item.content === "string" && item.content.trim()) {
          results.push(item.content.trim());
        } else if (Array.isArray(item.content)) {
          const texts = item.content
            .filter((c: any) => c.type === "output_text" || c.type === "text")
            .map((c: any) => c.text)
            .filter(Boolean);
          if (texts.length) results.push(texts.join("\n").trim());
        }
      }
    }
  }
  if (results.length === 0 && typeof data?.output_text === "string" && data.output_text.trim()) {
    results.push(data.output_text.trim());
  }

  // Split each by the MSG_BREAK_TOKEN convention
  const MSG_BREAK_RE = /\[\[MSG_BREAK\]\]|\n?<<<MSG_BREAK>>>\n?/g;
  const expanded: string[] = [];
  for (const r of results) {
    const parts = r.split(MSG_BREAK_RE).map((p) => p.trim()).filter(Boolean);
    expanded.push(...(parts.length ? parts : [r]));
  }
  return expanded;
}

const fetchWithTimeout = async (url: string, opts: RequestInit, timeoutMs = 300_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const INVALID_RESPONSES = [
  "no response from openclaw.",
  "no response from openclaw",
  "sem resposta do agente.",
  "no response from",
];

/**
 * A4 (idempotência): pergunta ao gateway se a sessão do turno já está sendo
 * processada, em vez de só confiar no relógio de 12s. Elimina o reenvio
 * duplicado em turnos com thinking + tool calls (que quase sempre passam de
 * 12s) sem atrasar a resposta quando o stream realmente caiu.
 *
 * Fail-open por natureza: qualquer erro/formato inesperado retorna `false`
 * (não sabemos se está rodando) e o caller cai no comportamento de hoje —
 * nunca faz a situação piorar, só melhora quando a consulta funciona.
 */
async function isSessionActivelyRunning(
  gateway: GatewayConfig,
  agentId: string,
  sessionUser: string,
): Promise<boolean> {
  try {
    const expectedKey = `agent:${agentId}:openai-user:${sessionUser}`;
    const res = await fetchWithTimeout(`${gateway.url}/tools/invoke`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gateway.token}`,
        "Content-Type": "application/json",
      },
      // `args`, não `arguments`: o /tools/invoke IGNORA `arguments` em
      // silêncio (sonda na VPS, 27/07). Com `arguments`, esta chamada sempre
      // devolvia as sessões do agente PADRÃO (Lia) — ou seja, para qualquer
      // outro agente a expectedKey nunca casava e o check retornava false:
      // a proteção contra execução duplicada nunca funcionou fora da Lia.
      body: JSON.stringify({ tool: "sessions_list", args: { agentId, limit: 20 } }),
    }, 3_000);

    if (!res.ok) return false;
    const envelope = await res.json();
    const text = envelope?.result?.content?.[0]?.text;
    if (typeof text !== "string") return false;

    const parsed = JSON.parse(text);
    const sessions: any[] = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    const match = sessions.find((s) => s?.key === expectedKey);
    if (!match) return false;

    return match.status === "running";
  } catch (e) {
    console.warn("[dm-agent-reply] isSessionActivelyRunning check failed (fail-open):", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Process the gateway call and persist the result — runs in background */
async function processInBackground(
  supabase: ReturnType<typeof createClient>,
  gateway: GatewayConfig,
  payload: any,
  agentId: string,
  userId: string,
  userMessageTimestamp: string,
  sessionUser: string,
  /**
   * Override de LLM da conversa, no formato `provedor/modelo`. PRECISA ser
   * aplicado aqui também: este é o caminho de fallback do mesmo turno, e se só
   * o streaming mandasse o header, um turno longo seria respondido por um
   * modelo diferente do que o usuário escolheu — sem nada na tela indicando.
   */
  modelOverride?: string,
) {
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 2000;
  // Give the foreground streaming path (chat-sender → gateway-chat) a head
  // start. If the user keeps the tab open, the stream usually completes well
  // before this, and we'll abort below to avoid a duplicate parallel call.
  // 15s (era 12s) só dá mais folga antes da 1ª checagem; a proteção real contra
  // turnos longos (thinking + tool calls) é a consulta de status abaixo (A4).
  const STREAM_HEAD_START_MS = 15_000;
  let replyParts: string[] = [];

  const filterTimestamp = userMessageTimestamp || new Date(Date.now() - 5 * 60_000).toISOString();

  const hasExistingAgentReply = async (): Promise<boolean> => {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("agent_id", agentId)
      .eq("user_id", userId)
      .eq("role", "agent")
      .gt("created_at", filterTimestamp)
      .limit(1);
    if (error) {
      console.warn("[dm-agent-reply] dedup check failed:", error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  };

  // Wait for the foreground stream to settle, then abort if it already wrote.
  await new Promise((r) => setTimeout(r, STREAM_HEAD_START_MS));
  if (await hasExistingAgentReply()) {
    console.log("[dm-agent-reply] Foreground stream already persisted reply, skipping gateway call.");
    return;
  }

  // A4 (idempotência): sem resposta persistida ainda, mas o turno pode
  // simplesmente estar demorando (thinking + tool calls). Pergunta ao gateway
  // se a sessão está ativa antes de disparar uma execução duplicada.
  if (sessionUser && await isSessionActivelyRunning(gateway, agentId, sessionUser)) {
    console.log("[dm-agent-reply] Gateway reports session still running — skipping duplicate call.");
    return;
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const gatewayEndpoint = `${gateway.url}/v1/chat/completions`;
    console.log(`[dm-agent-reply] Attempt ${attempt}: URL=${gatewayEndpoint}, model=${payload.model}, timeout=300s`);
    try {
      const t0 = Date.now();
      const res = await fetchWithTimeout(gatewayEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gateway.token}`,
          "Content-Type": "application/json",
          ...(modelOverride ? { "x-openclaw-model": modelOverride } : {}),
        },
        body: JSON.stringify(payload),
      });

      console.log(`[dm-agent-reply] Response in ${Date.now() - t0}ms, status: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        // Medição desligada aqui: o trajectory do gateway registra esta
        // mesma chamada com mais precisão e é importado pelo usage-push.
        replyParts = extractReplyTexts(data);
        if (replyParts.length > 1) {
          console.log(`[dm-agent-reply] Multi-message reply detected: ${replyParts.length} parts`);
        }
        break;
      }

      const errText = await res.text().catch(() => "");
      console.error(`[dm-agent-reply] Gateway error ${res.status} (attempt ${attempt}): ${errText.slice(0, 200)}`);

      // 524 (Cloudflare timeout) means the upstream agent likely is still
      // working — retrying would just start a new long task in parallel and
      // also time out. Bail and let the failure marker surface the issue.
      if (res.status === 524) {
        console.log("[dm-agent-reply] 524 from Cloudflare — upstream still processing, not retrying.");
        break;
      }
      if ((res.status === 502 || res.status === 503 || res.status >= 520) && attempt < MAX_ATTEMPTS) {
        console.log(`[dm-agent-reply] Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[dm-agent-reply] Gateway fetch failed (attempt ${attempt}):`, msg);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
    break;
  }

  // Filter out placeholders
  replyParts = replyParts.filter((part) => {
    if (!part) return false;
    const lower = part.toLowerCase().trim();
    return !INVALID_RESPONSES.some((invalid) => lower === invalid.toLowerCase().trim());
  });

  if (replyParts.length === 0) {
    console.error(`[dm-agent-reply] Gateway failed for agent=${agentId} user=${userId} — no reply from foreground path.`);
    // The upstream agent is very likely still processing (esp. on 524).
    // The VPS will push the final result via agent-reply-webhook, which will
    // overwrite any placeholder. To avoid showing a false "failed" message to
    // the user when the task actually completes, wait a while for the webhook
    // and only insert the failure marker if nothing lands.
    const WEBHOOK_WAIT_MS = 90_000;
    const POLL_INTERVAL_MS = 5_000;
    const deadline = Date.now() + WEBHOOK_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (await hasExistingAgentReply()) {
        console.log("[dm-agent-reply] Real reply arrived via webhook, skipping failure marker.");
        return;
      }
    }
    if (await hasExistingAgentReply()) {
      console.log("[dm-agent-reply] Reply landed before failure marker, skipping.");
      return;
    }
    // Primeiro o status, depois o marcador: o trigger de entrega só toca
    // linhas 'pending', então esta ordem impede que o próprio marcador de
    // falha marque o turno como 'delivered'.
    await markTurnFailed(supabase, agentId, userId, "gateway sem resposta apos retries e espera pelo webhook");

    const failureMsg = "⚠️ Não consegui finalizar essa resposta agora (o gateway expirou antes do agente concluir). A tarefa pode ter sido executada no backend — envie uma nova mensagem para continuar.";
    const { error: failErr } = await supabase.from("conversations").insert([{
      agent_id: agentId,
      user_id: userId,
      role: "agent",
      content: failureMsg,
      created_at: new Date().toISOString(),
    }]);
    if (failErr) {
      console.error("[dm-agent-reply] Failure marker insert error:", failErr);
    }
    return;
  }

  // Final guard: if ANY agent reply landed for this turn while we were
  // calling the gateway, the foreground stream won the race. Skip entirely
  // to avoid persisting a parallel (paraphrased) duplicate.
  if (await hasExistingAgentReply()) {
    console.log("[dm-agent-reply] Agent reply landed during gateway call, dropping background reply.");
    return;
  }

  const toInsert = replyParts;

  // Persist each part as its own conversation row with sequential timestamps
  const baseMs = Date.now();
  const rows = toInsert.map((content, i) => ({
    agent_id: agentId,
    user_id: userId,
    role: "agent",
    content,
    created_at: new Date(baseMs + i).toISOString(),
  }));

  const { error: insertError } = await supabase.from("conversations").insert(rows);
  if (insertError) {
    console.error("[dm-agent-reply] Insert error:", insertError);
    return;
  }
  console.log(`[dm-agent-reply] Persisted ${rows.length} message(s) for agent ${agentId}`);

  // Single notification for the burst (last message preview)
  const lastReply = toInsert[toInsert.length - 1];
  try {
    const agentName = agentId.charAt(0).toUpperCase() + agentId.slice(1);

    // Uma falha aqui gera a notificação "órfã" (channel_id nulo): ela ainda
    // acende o badge do agente (o frontend soma por agent_id), mas fica fora
    // de toda contagem por canal. Por isso vale UMA nova tentativa antes de
    // aceitar a degradação — e o insert acontece de qualquer jeito, porque
    // notificação sem canal é melhor que resposta invisível.
    let dmChannelId: string | null = null;
    for (let attempt = 1; attempt <= 2 && !dmChannelId; attempt++) {
      try {
        const { data: chId, error: rpcErr } = await supabase.rpc("find_or_create_agent_dm", {
          _agent_id: agentId,
          _agent_name: agentName,
          _target_user_id: userId,
        });
        if (rpcErr) {
          console.error(`[dm-agent-reply] find_or_create_agent_dm error (attempt ${attempt}):`, rpcErr);
        } else if (typeof chId === "string") {
          dmChannelId = chId;
        }
      } catch (e) {
        console.error(`[dm-agent-reply] DM channel resolve failed (attempt ${attempt}):`, e);
      }
      if (!dmChannelId && attempt === 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!dmChannelId) {
      console.error(
        `[dm-agent-reply] NOTIFICACAO ORFA: channel_id nulo para agent=${agentId} user=${userId} — badge por agent_id cobre, mas investigar o RPC.`,
      );
    }

    const preview = toInsert.length > 1
      ? `(${toInsert.length} mensagens) ${lastReply.slice(0, 100)}`
      : lastReply.slice(0, 120);

    const { error: notifError } = await supabase.from("notifications").insert({
      user_id: userId,
      channel_id: dmChannelId,
      agent_id: agentId,
      author_name: agentName,
      content_preview: preview,
    });
    if (notifError) {
      console.error("[dm-agent-reply] Notification insert error:", notifError);
    }
  } catch (e) {
    console.error("[dm-agent-reply] Notification failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) {
      throw new Error("Missing SUPABASE env");
    }

    // Require authenticated caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { agentId, userId, messages, model, userMessageTimestamp, sessionUser, modelOverride } = await req.json();

    if (!agentId || !userId || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "agentId, userId, and messages[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gateway = await getGatewayConfig(supabase);
    const stripPrefix = (id: string) => (id.includes(":") ? id.split(":").pop() ?? id : id);
    const normalizedAgentId = stripPrefix(String(agentId));
    const resolvedModel = model || `openclaw:${normalizedAgentId}`;
    const resolvedSessionUser =
      (typeof sessionUser === "string" && sessionUser.trim()) ||
      `dm:${userId}:${normalizedAgentId}:${AGENT_SESSION_VERSION}`;

    // Registro do turno (agent_turns): é isto que o reconciliador varre para
    // saber "o que estamos esperando". Fire-and-forget de propósito — o
    // registro nunca pode atrasar nem derrubar o turno. Registrar só aqui
    // basta: todo turno de DM passa por esta função (duplo despacho do
    // chat-sender), inclusive quando o streaming vence a corrida.
    registerTurn(supabase, {
      agentId: String(agentId),
      userId: String(userId),
      sessionKey: `agent:${normalizedAgentId}:openai-user:${resolvedSessionUser}`,
      userMessageTs: userMessageTimestamp || new Date().toISOString(),
    }).catch(() => {});

    const payload = {
      model: resolvedModel,
      messages,
      user: resolvedSessionUser,
      // O caminho principal (streaming, chat-sender.ts → gateway-chat) NÃO
      // limita tokens de saída. Este fallback (usado quando o turno passa de
      // ~15s — exatamente o caso de gerar um live_artifact grande, com CSS +
      // JS + tabela) estava travado em 4096 tokens: um dashboard com Chart.js
      // e tabela de várias linhas facilmente passa disso, cortando a resposta
      // no meio e quebrando a tag de fechamento do artefato. Alinhado ao teto
      // mais alto do que agentes de conteúdo/dashboard realmente precisam.
      max_tokens: 16000,
    };

    // Fire and forget — start background processing without awaiting
    processInBackground(
      supabase,
      gateway,
      payload,
      agentId,
      userId,
      userMessageTimestamp || new Date().toISOString(),
      resolvedSessionUser,
      // Mesma validação de formato do gateway-chat: sem o prefixo de provedor o
      // Gateway assume `deepseek/` e a chamada falha por engano.
      typeof modelOverride === "string" && /^[a-z0-9-]+\/.+/i.test(modelOverride.trim())
        ? modelOverride.trim()
        : undefined,
    ).catch((err) => {
      console.error("[dm-agent-reply] Background processing error:", err);
    });

    // Return immediately — frontend will poll for the result
    return new Response(
      JSON.stringify({ ok: true, status: "processing" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[dm-agent-reply] Error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
