import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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

function extractToken(credentials: any): string | null {
  if (!credentials) return null;
  // credentials can be an object { access_token, token, api_key } OR
  // an array of { key_name, value } pairs (as used in `integrations` table).
  if (Array.isArray(credentials)) {
    const pick = (name: string) =>
      credentials.find(
        (c: any) => (c?.key_name ?? c?.key ?? "").toString().toLowerCase() === name,
      )?.value;
    return (
      pick("access_token") ||
      pick("token") ||
      pick("api_key") ||
      (credentials[0]?.value ?? null)
    );
  }
  if (typeof credentials === "object") {
    return (
      credentials.access_token ||
      credentials.token ||
      credentials.api_key ||
      null
    );
  }
  return null;
}

function extractRowToken(row: any): string | null {
  return extractToken(row?.credentials) || Deno.env.get(row?.key_name ?? "") || null;
}

async function resolveMetaAccountId(token: string): Promise<string | null> {
  const response = await fetch("https://graph.facebook.com/v20.0/me/adaccounts?fields=id,account_id,name,account_status&limit=1", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  const id = first?.id || first?.account_id;
  if (!id) return null;
  return String(id).startsWith("act_") ? String(id) : `act_${id}`;
}

function canonicalIntegrationType(row: any): string {
  const rawType = (row?.integration_type ?? "").toString().toLowerCase();
  const name = (row?.name ?? "").toString().toLowerCase();
  const keyName = (row?.key_name ?? "").toString().toLowerCase();

  if (rawType === "meta" || name.includes("meta") || keyName.includes("meta") || keyName.includes("prisma_user_token")) {
    return "meta";
  }

  return rawType;
}

const fallbackPlaybooks: Record<string, any> = {
  meta: {
    base_url: "https://graph.facebook.com/v20.0",
    data_endpoints: {
      insights: {
        method: "GET",
        path: "/{account_id}/insights",
      },
      campaigns: {
        method: "GET",
        path: "/{account_id}/campaigns",
      },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  try {
    // 1. Authenticate the user via their JWT
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: authError } = await userClient.auth.getUser();
    if (authError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    // Service role client for reading integrations + templates (bypasses RLS,
    // but we already verified the caller is an authenticated user).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate-limit por usuário: a integração usa credenciais (e cota/custo) da
    // empresa, e qualquer usuário logado pode disparar via live artifacts.
    // Limita abuso sem bloquear uso legítimo. Fail-open se o limitador não
    // existir/estiver indisponível (nunca trava uso legítimo por erro do limiter).
    try {
      const { data: allowed, error: rlError } = await admin.rpc("check_invoke_rate", {
        _user_id: userData.user.id,
        _limit: 100,
        _window_secs: 60,
      });
      if (!rlError && allowed === false) {
        return json(
          { ok: false, error: "Muitas chamadas de integração em pouco tempo. Aguarde um instante.", code: "rate_limited" },
          200,
        );
      }
    } catch {
      /* fail-open: erro no limitador não deve bloquear uso legítimo */
    }

    const body = await req.json().catch(() => ({}));
    const { integration, endpoint, params } = body ?? {};
    const requestedIntegration = String(integration ?? "").toLowerCase();

    if (!integration || !endpoint) {
      return json({ error: "'integration' and 'endpoint' are required" }, 400);
    }

    // 2. Load credentials from `integrations`
    const { data: integrationRows, error: intError } = await admin
      .from("integrations")
      .select("name, key_name, integration_type, credentials")
      .eq("is_configured", true)
      .order("updated_at", { ascending: false });

    if (intError) return json({ error: intError.message }, 400);
    const integrationRow = (integrationRows ?? []).find((row: any) => canonicalIntegrationType(row) === requestedIntegration);
    if (!integrationRow) {
      // Expected state (user hasn't connected this integration yet).
      // Return 200 with structured error so the browser doesn't log it as
      // a network failure and the runtime error tracker stays quiet.
      return json({ ok: false, error: `Integração '${integration}' não configurada`, code: "integration_not_configured" }, 200);
    }

    // 3. Load playbook from `integration_templates`
    const { data: template, error: tmplError } = await admin
      .from("integration_templates")
      .select("playbook")
      .eq("integration_type", requestedIntegration)
      .maybeSingle();

    if (tmplError) return json({ error: tmplError.message }, 400);
    if (!template?.playbook && !fallbackPlaybooks[requestedIntegration]) {
      return json({ ok: false, error: `Playbook não encontrado para '${integration}'`, code: "playbook_not_found" }, 200);
    }

    const playbook: any = template?.playbook ?? fallbackPlaybooks[requestedIntegration];

    // 4. Locate the requested data_endpoint
    const dataEndpoint = playbook?.data_endpoints?.[endpoint];
    if (!dataEndpoint) {
      return json(
        { ok: false, error: `Endpoint '${endpoint}' não existe no playbook de '${integration}'`, code: "endpoint_not_found" },
        200,
      );
    }

    // 5. Extract token
    const token = extractRowToken(integrationRow);
    if (!token) {
      return json({
        ok: false,
        error: `Integração '${integration}' está marcada como configurada, mas não tem um token utilizável. Reconecte em Configurações → Integrações.`,
        code: "integration_token_missing",
      }, 200);
    }

    // 6. Build URL with path params + query params
    const baseUrl = playbook.base_url;
    if (!baseUrl) return json({ error: "playbook.base_url ausente" }, 500);

    let path: string = dataEndpoint.path ?? "";
    const mergedParams = { ...(params ?? {}) };
    if (requestedIntegration === "meta" && !mergedParams.account_id) {
      const adAccountId = Deno.env.get("META_AD_ACCOUNT_ID") || Deno.env.get("META_ACCOUNT_ID") || Deno.env.get("PRISMA_META_AD_ACCOUNT_ID");
      if (adAccountId) mergedParams.account_id = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
      else mergedParams.account_id = await resolveMetaAccountId(token);
    }
    if (requestedIntegration === "meta" && !mergedParams.account_id && path.includes("{account_id}")) {
      return json({ ok: false, error: "account_id ausente para consulta Meta", code: "missing_account_id" }, 200);
    }

    // Meta insights require a non-empty time_range. Default to last 30 days
    // when caller omits it (or passes empty/invalid value).
    if (requestedIntegration === "meta") {
      const fieldsStr = String(mergedParams.fields ?? "");
      const wantsInsights = fieldsStr.includes("insights") || String(path).includes("insights");
      const tr = mergedParams.time_range;
      const trOk = tr && (typeof tr === "object"
        ? !!(tr as any).since && !!(tr as any).until
        : String(tr).trim().length > 2);
      if (wantsInsights && !trOk && !mergedParams.date_preset) {
        const until = new Date();
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        mergedParams.time_range = {
          since: since.toISOString().slice(0, 10),
          until: until.toISOString().slice(0, 10),
        };
      }
    }

    const urlParams = new URLSearchParams();
    for (const [key, val] of Object.entries(mergedParams)) {
      if (val === undefined || val === null) continue;
      if (path.includes(`{${key}}`)) {
        path = path.replaceAll(`{${key}}`, encodeURIComponent(String(val)));
      } else {
        // Meta Graph API expects certain params (filtering, fields lists as arrays)
        // to be JSON-encoded arrays. Normalize here so callers can pass an object
        // or single filter without hitting "(#100) param filtering must be an array."
        if (key === "filtering") {
          let arr: unknown = val;
          if (typeof val === "string") {
            const trimmed = val.trim();
            if (trimmed.startsWith("[")) {
              try { arr = JSON.parse(trimmed); } catch { arr = [trimmed]; }
            } else if (trimmed.startsWith("{")) {
              try { arr = [JSON.parse(trimmed)]; } catch { arr = [trimmed]; }
            } else {
              arr = [trimmed];
            }
          } else if (!Array.isArray(val)) {
            arr = [val];
          }
          urlParams.set(key, JSON.stringify(arr));
        } else {
          urlParams.set(key, (Array.isArray(val) || (val && typeof val === "object")) ? JSON.stringify(val) : String(val));
        }
      }
    }
    const qs = urlParams.toString();
    const url = `${baseUrl}${path}${qs ? `?${qs}` : ""}`;

    // 7. Call the external API
    const response = await fetch(url, {
      method: dataEndpoint.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const text = await response.text();
    let payload: unknown = text;
    try {
      payload = JSON.parse(text);
    } catch {
      // keep as text
    }

    if (!response.ok) {
      return json(
        { error: `Upstream ${response.status}`, upstream: payload },
        502,
      );
    }

    return json({ success: true, data: payload });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
