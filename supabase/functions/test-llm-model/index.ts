// test-llm-model — prova que uma LLM está de fato funcionando.
//
// Por que existe: `models.list` diz o que está CONFIGURADO no Gateway, não o
// que FUNCIONA. Confirmado na prática (2026-07-24): gpt-5.4, gpt-5.4-mini e
// gpt-5.5 aparecem no models.list, mas a credencial OAuth da OpenAI está
// expirada — escolher um deles para um agente o deixaria mudo. O único jeito de
// provar que uma LLM responde é chamá-la de verdade; `models.authStatus` não
// serve (só cobre provider com OAuth e expiry, e ainda assim não prova uso).
//
// Contrato confirmado com saída bruta do gateway (2026-07-24, via Lia):
//   - O gateway NÃO aceita model id nu ("deepseek-v4-pro") em
//     /v1/chat/completions — só `openclaw` ou `openclaw:<agentId>`.
//   - O header `x-openclaw-model` troca a LLM só naquela chamada, sem tocar em
//     config nenhuma. Funciona inclusive na rota `openclaw` (sem agente), que
//     é mais barata (~33k de prompt contra ~138k de um agente nomeado).
//   - Formato do header: `provedor/modelo` ("openai/gpt-5.4"). Sem prefixo o
//     gateway assume `deepseek/` e o teste falha por engano.
//   - Modelo inexistente FALHA EM VOZ ALTA — não cai em fallback silencioso.
//     Isso é o que torna este teste confiável; foi verificado com um id
//     inventado de propósito como controle.
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

const KNOWN_PROVIDERS = new Set(["deepseek", "openai", "anthropic", "gemini"]);

/** Resultado do teste, do ponto de vista de quem vai agir sobre ele. */
type TestStatus =
  | "ok"                  // respondeu — a LLM funciona
  | "invalid_credential"  // existe, mas a credencial do provedor não vale
  | "not_registered"      // não está registrado no Gateway
  | "error";              // qualquer outra falha (rede, timeout, formato)

// Prompt mínimo: o custo do teste é dominado pelo system prompt do Gateway
// (~33k), que é cacheado. max_tokens pequeno mantém a saída curta; ver a nota
// sobre "incomplete terminal response" abaixo.
const TEST_MESSAGE = "ok";
const TEST_MAX_TOKENS = 32;
const TIMEOUT_MS = 60_000;

function classify(httpOk: boolean, body: any): { status: TestStatus; message: string } {
  const errMsg = String(body?.error?.message ?? "");
  const errType = String(body?.error?.type ?? "");

  if (httpOk && Array.isArray(body?.choices) && body.choices.length > 0) {
    return { status: "ok", message: "A LLM respondeu — credencial válida e modelo disponível." };
  }

  // Modelo existe e está registrado, mas o provedor recusou a credencial.
  if (errType === "permission_error" || /oauth|refresh token|unauthorized|\b401\b|api key/i.test(errMsg)) {
    return {
      status: "invalid_credential",
      message: "O modelo existe no Gateway, mas a credencial do provedor é inválida ou expirou. Reconecte o provedor.",
    };
  }

  // "Model 'X' is not allowed for agent 'Y'" — id errado ou não registrado em
  // agents.defaults.models.
  if (/is not allowed for agent|not allowed|unknown model|invalid `?model`?/i.test(errMsg)) {
    return {
      status: "not_registered",
      message: "O Gateway não reconhece esse modelo. Verifique se ele está registrado na configuração.",
    };
  }

  // Modelos de reasoning podem estourar o orçamento de saída antes de fechar a
  // resposta. Isso prova que o modelo respondeu (chegou até o provedor com
  // credencial válida) — é sucesso para o propósito deste teste.
  if (/incomplete terminal response|max_tokens|length/i.test(errMsg)) {
    return {
      status: "ok",
      message: "A LLM respondeu (resposta truncada pelo limite do teste) — credencial válida.",
    };
  }

  return {
    status: "error",
    message: errMsg ? "Falha ao testar o modelo." : "O Gateway não respondeu como esperado.",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // super_admin: cada teste consome tokens reais do cliente, e configuração
    // de LLM é superfície de admin. Se um dia o seletor do chat precisar
    // mostrar status para todo mundo, o caminho é cachear o resultado do teste
    // — não abrir a execução para qualquer usuário.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "super_admin",
    });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const { model } = await req.json().catch(() => ({}));
    const requested = String(model ?? "").trim();
    if (!requested) return json({ error: "model required" }, 400);

    // Exige o formato provedor/modelo. Sem prefixo o Gateway assume `deepseek/`
    // e o teste reprovaria um modelo de outro provedor por engano — a própria
    // saída bruta mostrou isso ("gpt-5.4" virou "deepseek/gpt-5.4").
    const [providerRaw, ...rest] = requested.split("/");
    const provider = providerRaw.toLowerCase();
    if (rest.length === 0 || !KNOWN_PROVIDERS.has(provider)) {
      return json({
        error: "Informe o modelo no formato provedor/modelo (ex.: openai/gpt-5.4)",
      }, 400);
    }

    const gateway = await getGatewayConfig(supabase);
    if (!gateway.url || !gateway.token) {
      return json({ error: "Gateway não configurado — conecte o Gateway em Configurações primeiro" }, 400);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(`${gateway.url}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${gateway.token}`,
          // Troca a LLM só nesta chamada — não altera a config de nenhum agente.
          "x-openclaw-model": requested,
        },
        body: JSON.stringify({
          // Rota sem agente: mais barata que openclaw:<agente> e suficiente,
          // já que só queremos saber se a LLM responde.
          model: "openclaw",
          messages: [{ role: "user", content: TEST_MESSAGE }],
          stream: false,
          max_tokens: TEST_MAX_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error)?.name === "AbortError";
      return json({
        success: true,
        model: requested,
        status: "error" as TestStatus,
        message: aborted
          ? `O teste passou de ${TIMEOUT_MS / 1000}s sem resposta. O modelo pode estar muito lento ou indisponível.`
          : "Não foi possível falar com o Gateway.",
        elapsedMs: Date.now() - startedAt,
      });
    }
    clearTimeout(timer);

    const text = await res.text().catch(() => "");
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* mantém raw */ }

    const { status, message } = classify(res.ok, body);
    return json({
      success: true,
      model: requested,
      status,
      message,
      // Mensagem de erro do Gateway, truncada — é o que permite diagnosticar
      // sem adivinhar. Só o texto do erro, nunca o corpo inteiro da resposta.
      detail: String(body?.error?.message ?? "").slice(0, 300) || null,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
