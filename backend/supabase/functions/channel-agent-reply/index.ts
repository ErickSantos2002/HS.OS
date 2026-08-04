/**
 * channel-agent-reply — Fire-and-forget agent reply for channel messages.
 *
 * Mirrors the dm-agent-reply pattern:
 * - Returns 200 immediately with { ok: true, status: "processing" }.
 * - Gateway call runs in background (Deno isolate stays alive for pending promises).
 * - Frontend receives the agent message via realtime on channel_messages.
 *
 * Improvements over the old sync version:
 * - max_tokens 4096 (was 512) — fits real analyses with charts.
 * - 30 messages of context (was 10) — agent recovers the original request.
 * - Retry 2x on 502/503/5xx with 2s backoff.
 * - Duplicate protection before insert.
 * - Robust reply extraction (string / array / output[] / output_text).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { closeTurn, registerTurn } from "../_shared/agent-turns.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AGENT_SESSION_VERSION = "v2";

const AGENT_NAME_OVERRIDES: Record<string, string> = {
  rodrigo: "RodrigoIA",
  cs: "CS",
  rock: "Rock",
};

// Official agents come from `agent_profiles.is_official = true` per request.

const INVALID_RESPONSES = [
  "no response from openclaw.",
  "no response from openclaw",
  "sem resposta do agente.",
  "no response from",
];

function getAgentDisplayName(agentId: string): string {
  const normalizedId = agentId.trim().toLowerCase().replace(/^openclaw:/, "");
  if (AGENT_NAME_OVERRIDES[normalizedId]) return AGENT_NAME_OVERRIDES[normalizedId];
  return normalizedId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) =>
      part.length <= 2 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}


function extractReplyText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const parts = content
      .filter((p: any) => typeof p?.text === "string")
      .map((p: any) => p.text);
    if (parts.length) return parts.join("\n").trim();
  }
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item.type === "message" && item.role === "assistant") {
        if (typeof item.content === "string") return item.content.trim();
        if (Array.isArray(item.content)) {
          const texts = item.content
            .filter((c: any) => c.type === "output_text" || c.type === "text")
            .map((c: any) => c.text)
            .filter(Boolean);
          if (texts.length) return texts.join("\n").trim();
        }
      }
    }
  }
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return "";
}

const fetchWithTimeout = async (url: string, opts: RequestInit, timeoutMs = 140_000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

async function processInBackground(
  supabase: ReturnType<typeof createClient>,
  gateway: GatewayConfig,
  payload: any,
  channelId: string,
  agentId: string,
  agentName: string,
  userMessageTimestamp: string,
  sessionKey: string,
) {
  const MAX_ATTEMPTS = 2;
  const RETRY_DELAY_MS = 2000;
  let replyText = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const gatewayEndpoint = `${gateway.url}/v1/chat/completions`;
    console.log(`[channel-agent-reply] Attempt ${attempt}: URL=${gatewayEndpoint}, model=${payload.model}, timeout=140s`);
    try {
      const t0 = Date.now();
      const res = await fetchWithTimeout(gatewayEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gateway.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      console.log(`[channel-agent-reply] Response in ${Date.now() - t0}ms, status: ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        replyText = extractReplyText(data);
        break;
      }

      const errText = await res.text().catch(() => "");
      console.error(`[channel-agent-reply] Gateway error ${res.status} (attempt ${attempt}): ${errText.slice(0, 200)}`);

      if ((res.status === 502 || res.status === 503 || res.status >= 520) && attempt < MAX_ATTEMPTS) {
        console.log(`[channel-agent-reply] Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[channel-agent-reply] Gateway fetch failed (attempt ${attempt}):`, msg);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
    break;
  }

  if (!replyText) {
    // A11: antes, uma falha aqui era 100% silenciosa — só logada, nada visível
    // no canal. O usuário menciona o agente e nada acontece, sem nenhum sinal
    // de que algo deu errado. Mesmo padrão de failure marker já usado em DMs.
    console.error(`[channel-agent-reply] Gateway failed for channel=${channelId} agent=${agentId} — inserting failure marker.`);
    const { error: failErr } = await supabase.from("channel_messages").insert({
      channel_id: channelId,
      author_id: agentId,
      author_type: "agent",
      author_name: agentName,
      author_avatar: null,
      content: "⚠️ Não consegui responder agora (o gateway falhou ou expirou). Tente mencionar novamente em instantes.",
    });
    if (failErr) console.error("[channel-agent-reply] Failure marker insert error:", failErr);
    await closeTurn(supabase, sessionKey, userMessageTimestamp, "failed", "gateway falhou ou expirou");
    await supabase.from("channel_agent_activity")
      .update({ finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("channel_id", channelId).eq("agent_id", agentId);
    return;
  }

  const isInvalid = INVALID_RESPONSES.some(
    (invalid) => replyText.toLowerCase().trim() === invalid.toLowerCase().trim(),
  );
  if (isInvalid) {
    console.log(`[channel-agent-reply] Invalid placeholder reply ignored for channel=${channelId} agent=${agentId}:`, replyText);
    return;
  }

  // Duplicate check: skip if an agent message from this agent already exists
  // after the user's last message timestamp.
  const filterTimestamp = userMessageTimestamp || new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: existing } = await supabase
    .from("channel_messages")
    .select("id")
    .eq("channel_id", channelId)
    .eq("author_id", agentId)
    .eq("author_type", "agent")
    .gt("created_at", filterTimestamp)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log("[channel-agent-reply] Duplicate detected, skipping insert");
    return;
  }

  const { error: insertError } = await supabase.from("channel_messages").insert({
    channel_id: channelId,
    author_id: agentId,
    author_type: "agent",
    author_name: agentName,
    author_avatar: null,
    content: replyText,
  });

  if (insertError) {
    console.error("[channel-agent-reply] Insert error:", insertError);
    return;
  }

  await closeTurn(supabase, sessionKey, userMessageTimestamp, "delivered");
  await supabase.from("channel_agent_activity")
    .update({ finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("channel_id", channelId).eq("agent_id", agentId);
  console.log(`[channel-agent-reply] Reply persisted for channel=${channelId} agent=${agentId}`);

  // Notify all human members of the channel
  try {
    const { data: members } = await supabase
      .from("channel_members")
      .select("user_id, member_type")
      .eq("channel_id", channelId);

    if (members) {
      const humanMembers = (members as any[]).filter((m) => m.member_type === "human");
      if (humanMembers.length > 0) {
        const notifs = humanMembers.map((m) => ({
          user_id: m.user_id,
          channel_id: channelId,
          author_name: agentName,
          content_preview: replyText.slice(0, 100),
        }));
        const { error: notifError } = await supabase.from("notifications").insert(notifs);
        if (notifError) {
          console.error("[channel-agent-reply] Notification insert error:", notifError);
        }
      }
    }
  } catch (e) {
    console.error("[channel-agent-reply] Notification failed:", e);
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
      throw new Error("SUPABASE env not configured");
    }

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
    const { channel_id, agent_id, message_count = 30, latest_user_message } = await req.json();
    const normalizedAgentId = String(agent_id ?? "").trim().toLowerCase().replace(/^openclaw:/, "");

    if (!channel_id || !normalizedAgentId) {
      return new Response(JSON.stringify({ error: "channel_id and agent_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: officialCheck } = await supabase
      .from("agent_profiles")
      .select("agent_id, name")
      .eq("agent_id", normalizedAgentId)
      .eq("is_official", true)
      .maybeSingle();
    if (!officialCheck) {
      return new Response(JSON.stringify({ error: "agent_id is not in the official catalog" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agentName = officialCheck.name || getAgentDisplayName(normalizedAgentId);
    const model = `openclaw:${normalizedAgentId}`;
    const gateway = await getGatewayConfig(supabase);

    // Shared session per (channel, agent)
    const sessionUser = `channel:${channel_id}:${normalizedAgentId}:${AGENT_SESSION_VERSION}`;

    const { data: history, error: historyError } = await supabase
      .from("channel_messages")
      .select("author_id, author_name, author_type, content, created_at")
      .eq("channel_id", channel_id)
      .is("thread_id", null)
      .order("created_at", { ascending: false })
      .limit(message_count);

    if (historyError) {
      console.error("[channel-agent-reply] History fetch error:", historyError);
      return new Response(JSON.stringify({ error: "Failed to load channel history" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orderedHistory = (history ?? [])
      .slice()
      .reverse()
      .filter((m: any) => m.content && !m.content.startsWith("[error]"));

    const contextMessages = orderedHistory.map((message: any) => ({
      role: message.author_type === "agent" ? "assistant" : "user",
      content: `[${message.author_name}]: ${message.content}`.slice(0, 2000),
    }));

    if (!contextMessages.some((m) => m.role === "user") && latest_user_message) {
      contextMessages.push({ role: "user", content: latest_user_message });
    }
    if (!contextMessages.some((m) => m.role === "user")) {
      contextMessages.push({ role: "user", content: "olá" });
    }

    // Timestamp of the most recent user message — used for dedup
    const lastUserMessage = [...orderedHistory].reverse().find((m: any) => m.author_type !== "agent");
    // Quem DISPAROU é a última mensagem do canal, seja de quem for. Procurar
    // só por humano credita o trabalho ao último humano que falou ali, mesmo
    // quando quem mencionou foi outro agente.
    const gatilho = [...orderedHistory].reverse().find((m: any) => m.author_id !== normalizedAgentId);
    const gatilhoEhAgente = (gatilho as any)?.author_type === "agent";
    const userMessageTimestamp: string =
      (lastUserMessage as any)?.created_at || new Date().toISOString();

    const payload = {
      model,
      user: sessionUser,
      messages: contextMessages,
      max_tokens: 4096,
    };

    // Turno de canal (a migration original deixou isto para depois).
    //
    // Ele NÃO entra na entrega proativa — o reconciliador ignora source
    // 'channel', porque o caminho de entrega dele grava em conversations e
    // despejaria resposta de canal na DM errada. Aqui o turno existe para dar
    // VISIBILIDADE: sem ele, o agente aparecia ocioso na parede durante os até
    // 140 segundos de uma menção, e o trabalho não constava em lugar nenhum.
    const autorGatilho = (gatilho as any)?.author_id ?? (lastUserMessage as any)?.author_id ?? null;
    const chaveTurno = `agent:${normalizedAgentId}:channel:${channel_id}`;
    if (autorGatilho) {
      await registerTurn(supabase, {
        agentId: normalizedAgentId,
        userId: gatilhoEhAgente ? null : autorGatilho,
        originAgentId: gatilhoEhAgente ? autorGatilho : null,
        sessionKey: chaveTurno,
        userMessageTs: userMessageTimestamp,
        source: "channel",
      });
    }

    // Sinal de trabalho para TODO o canal. O store do navegador só avisava
    // quem fez a menção; os outros membros viam um canal parado.
    await supabase.from("channel_agent_activity").upsert({
      channel_id, agent_id: normalizedAgentId,
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      passo: null, finished_at: null,
    }, { onConflict: "channel_id,agent_id" });

    // Fire and forget — background processing
    processInBackground(
      supabase,
      gateway,
      payload,
      channel_id,
      normalizedAgentId,
      agentName,
      userMessageTimestamp,
      chaveTurno,
    ).catch((err) => {
      console.error("[channel-agent-reply] Background processing error:", err);
    });

    return new Response(
      JSON.stringify({ ok: true, status: "processing" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[channel-agent-reply] Edge function error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
