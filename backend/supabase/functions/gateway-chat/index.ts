import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { extractUsage, recordUsage, type UsageEvent } from "../_shared/usage.ts";

/** Client de serviço só para gravar métrica — nunca para responder ao usuário. */
function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** "openclaw:kira" → "kira". O modelo carrega o agente nesta plataforma. */
function agentIdFromModel(model: unknown): string {
  const m = String(model ?? "");
  return m.includes(":") ? (m.split(":").pop() || m) : m || "desconhecido";
}

/**
 * Lê a cópia do stream em paralelo, só para colher o `usage` do último chunk.
 * O usuário não espera por isso: a outra ponta do tee já está sendo entregue.
 */
function meterStream(
  stream: ReadableStream<Uint8Array>,
  base: Omit<UsageEvent, "source" | "input_tokens" | "output_tokens" | "total_tokens">,
) {
  (async () => {
    try {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let tail = "";
      // Só o fim do fluxo interessa — manter uma janela evita segurar a
      // conversa inteira em memória.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        tail = (tail + decoder.decode(value, { stream: true })).slice(-8000);
      }
      for (const line of tail.split("\n").reverse()) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const u = extractUsage(payload);
        if (u) {
          await recordUsage(admin(), {
            ...base,
            model: u.model ?? base.model ?? null,
            input_tokens: u.input,
            output_tokens: u.output,
            cached_tokens: u.cached,
            total_tokens: u.total,
            source: "turn",
          });
          return;
        }
      }
      console.log("[usage] stream sem bloco usage — gateway pode ignorar stream_options");
    } catch (e) {
      console.warn("[usage] meterStream:", e instanceof Error ? e.message : e);
    }
  })();
}


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AGENT_SESSION_VERSION = "v2";


function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function summarizeGatewayError(status: number, detail: string) {
  const lower = detail.toLowerCase();

  if (lower.includes("bad gateway") || status === 502) {
    return "Serviço externo indisponível no momento (502 Bad Gateway).";
  }
  if (lower.includes("timeout") || lower.includes("timed out") || status === 524) {
    return "Serviço externo demorou demais para responder (Timeout).";
  }
  if (lower.includes("unknown error") || status === 520) {
    return "Serviço externo retornou um erro temporário desconhecido (520).";
  }
  if (lower.includes("connection")) {
    return "Não foi possível conectar ao gateway. Tente novamente.";
  }
  if (detail.trim().startsWith("<!DOCTYPE html>")) {
    return `Serviço externo indisponível no momento (HTTP ${status}).`;
  }

  return detail.slice(0, 500) || `Serviço externo indisponível (HTTP ${status}).`;
}



const GATEWAY_TIMEOUT_MS = 180_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Require authenticated caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const payload = await req.json();
    const { action, agentId, model, messages, stream, userId, sessionUser, commandText, modelOverride } = payload;

    // Override de LLM por conversa: vira o header x-openclaw-model, que troca o
    // modelo SÓ nesta chamada, sem tocar na config do agente. Exige o formato
    // `provedor/modelo` — sem prefixo o Gateway assume `deepseek/` e a chamada
    // falha por engano (confirmado: "gpt-5.4" virou "deepseek/gpt-5.4").
    // Valor malformado é IGNORADO em vez de repassado: melhor responder no
    // modelo padrão do que quebrar o turno por causa do seletor.
    const overrideHeader: Record<string, string> =
      typeof modelOverride === "string" && /^[a-z0-9-]+\/.+/i.test(modelOverride.trim())
        ? { "x-openclaw-model": modelOverride.trim() }
        : {};
    if (modelOverride && !overrideHeader["x-openclaw-model"]) {
      console.warn(`[gateway-chat] modelOverride ignorado (formato inválido): ${String(modelOverride).slice(0, 60)}`);
    }

    // Stable session key: prefer caller-provided sessionUser, otherwise derive from (userId, model)
    const stripPrefix = (id: string) => (id.includes(":") ? id.split(":").pop() ?? id : id);
    const resolvedSessionUser =
      (typeof sessionUser === "string" && sessionUser.trim()) ||
      (userId && model ? `dm:${userId}:${stripPrefix(String(model))}:${AGENT_SESSION_VERSION}` : undefined);

    const gateway = await getGatewayConfig(supabase);

    // ── Session reset action (auto-recovery from context overflow) ──
    if (action === "reset_session") {
      if (!agentId) return jsonResponse({ error: "agentId required" }, 400);
      const resetEndpoint = `${gateway.url}/v1/sessions/reset`;
      try {
        const res = await fetch(resetEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gateway.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ agentId }),
        });
        // Treat 404/501 as soft-success — the gateway just doesn't expose the endpoint
        if (res.status === 404 || res.status === 501) {
          console.log(`[gateway-chat] reset_session unsupported (${res.status}) — soft-ack`);
          return jsonResponse({ ok: true, supported: false, agentId });
        }
        const body = await res.text().catch(() => "");
        console.log(`[gateway-chat] reset_session ${res.status} for ${agentId}`);
        return jsonResponse({ ok: res.ok, status: res.status, agentId, detail: body.slice(0, 200) }, res.ok ? 200 : 502);
      } catch (e) {
        console.warn(`[gateway-chat] reset_session error:`, e instanceof Error ? e.message : e);
        // Soft-ack so the client can still proceed with the new session implicitly
        return jsonResponse({ ok: true, supported: false, agentId });
      }
    }

    // ── Slash command proxy (catch-all: /new, /reset, /compact, and any future
    // OpenClaw command). Everything is sent as a normal chat message to the
    // gateway's /v1/chat/completions endpoint — the gateway itself interprets
    // the slash command. This way the frontend never needs a whitelist.
    if (action === "command_session") {
      if (!agentId) return jsonResponse({ error: "agentId required" }, 400);
      if (typeof commandText !== "string" || !commandText.trim().startsWith("/")) {
        return jsonResponse({ error: "commandText must be a slash command" }, 400);
      }

      const canonicalAgentId = String(agentId).includes(":")
        ? String(agentId).split(":").pop() ?? String(agentId)
        : String(agentId);
      const normalizedCommand = commandText.trim();
      const lowerCommand = normalizedCommand.toLowerCase();
      const isResetCommand = lowerCommand === "/new" || lowerCommand === "/reset";

      const sessionId =
        (typeof sessionUser === "string" && sessionUser.trim()) ||
        `dm:${userData.user.id}:${canonicalAgentId}:${AGENT_SESSION_VERSION}`;

      const chatEndpoint = `${gateway.url}/v1/chat/completions`;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch(chatEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gateway.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: `openclaw:${canonicalAgentId}`,
            user: sessionId,
            messages: [{ role: "user", content: normalizedCommand }],
            stream: false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const raw = await res.text().catch(() => "");
        console.log(
          `[gateway-chat] command_session ${res.status} for ${canonicalAgentId}/${sessionId}: ${normalizedCommand}`,
        );

        if (!res.ok) {
          return jsonResponse(
            { ok: false, status: res.status, error: summarizeGatewayError(res.status, raw), raw: raw.slice(0, 500) },
            200,
          );
        }

        let parsed: any = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = null;
        }
        const text =
          parsed?.choices?.[0]?.message?.content ||
          (isResetCommand
            ? (lowerCommand === "/new" ? "Nova sessão iniciada." : "Sessão resetada.")
            : `Comando ${normalizedCommand} executado.`);
        return jsonResponse({ ok: true, status: res.status, data: { text }, raw });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.warn(`[gateway-chat] command_session error:`, message);
        return jsonResponse(
          { ok: false, error: summarizeGatewayError(503, message || "Failed to fetch command") },
          200,
        );
      }
    }

    if (!model || !messages) {
      return jsonResponse({ error: "model and messages required" }, 400);
    }

    const gatewayEndpoint = `${gateway.url}/v1/chat/completions`;
    console.log(`[gateway-chat] URL: ${gatewayEndpoint}, model: ${model}, stream: ${!!stream}`);

    if (stream) {
      // SSE streaming proxy — gateway only, no fallback
      let gatewayRes: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
        const t0 = Date.now();
        gatewayRes = await fetch(gatewayEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gateway.token}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...overrideHeader,
          },
          // stream_options.include_usage: pede o bloco `usage` no último chunk.
          // Sem isso o streaming não reporta consumo e a medição fica cega
          // justamente no caminho de maior volume (task #19).
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
            ...(resolvedSessionUser && { user: resolvedSessionUser }),
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        console.log(`[gateway-chat] Stream response in ${Date.now() - t0}ms, status: ${gatewayRes.status}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("Gateway stream network error:", errMsg);
        if (err instanceof DOMException && err.name === "AbortError") {
          return jsonResponse(
            { error: "SERVICE_UNAVAILABLE", detail: "Gateway demorou para responder. Tente novamente." },
            200,
          );
        }
        return jsonResponse(
          { error: "SERVICE_UNAVAILABLE", detail: summarizeGatewayError(503, errMsg) },
          200,
        );
      }

      if (!gatewayRes.ok) {
        const errText = await gatewayRes.text().catch(() => "");
        console.error(`Gateway stream error ${gatewayRes.status}: ${errText.slice(0, 300)}`);
        return jsonResponse(
          { error: "SERVICE_UNAVAILABLE", detail: summarizeGatewayError(gatewayRes.status, errText) },
          200,
        );
      }

      // Duplica o fluxo: um lado vai para o usuário sem atraso, o outro é
      // lido em paralelo só para colher o `usage` do último chunk.
      // Medição do stream desligada: o trajectory do gateway registra a MESMA
      // chamada com mais precisão (modelo real, divisão do cache, tokens de
      // raciocínio) e é importado pelo dnos-usage-push. Contar aqui também
      // dobraria a conta. O tee fica no código, pronto caso a importação
      // precise ser desativada.
      return new Response(gatewayRes.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // Synchronous request — gateway only, no fallback
      let gatewayRes: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
        const t0 = Date.now();
        gatewayRes = await fetch(gatewayEndpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gateway.token}`,
            "Content-Type": "application/json",
            ...overrideHeader,
          },
          body: JSON.stringify({ model, messages, ...(resolvedSessionUser && { user: resolvedSessionUser }) }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        console.log(`[gateway-chat] Sync response in ${Date.now() - t0}ms, status: ${gatewayRes.status}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("Gateway sync network error:", errMsg);
        if (err instanceof DOMException && err.name === "AbortError") {
          return jsonResponse(
            { error: "SERVICE_UNAVAILABLE", detail: "Gateway demorou para responder. Tente novamente." },
            200,
          );
        }
        return jsonResponse(
          { error: "SERVICE_UNAVAILABLE", detail: summarizeGatewayError(503, errMsg) },
          200,
        );
      }

      if (!gatewayRes.ok) {
        const errText = await gatewayRes.text().catch(() => "");
        console.error(`Gateway sync error ${gatewayRes.status}: ${errText.slice(0, 300)}`);
        return jsonResponse(
          { error: "SERVICE_UNAVAILABLE", detail: summarizeGatewayError(gatewayRes.status, errText) },
          200,
        );
      }

      const result = await gatewayRes.text();
      // (medição vem do trajectory — ver comentário acima)
      return new Response(result, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Edge function error:", message);
    return jsonResponse({ error: message }, 500);
  }
});
