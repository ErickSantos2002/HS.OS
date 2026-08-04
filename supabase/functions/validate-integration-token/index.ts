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

/** Validate a token against the real provider API. */
async function validateLinkedIn(token: string) {
  const r = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    let msg = `LinkedIn retornou ${r.status}`;
    try {
      const j = JSON.parse(text);
      msg = j.message || j.error_description || j.error || msg;
    } catch {
      if (text) msg = text.slice(0, 200);
    }
    return { valid: false, error: msg };
  }
  const data = await r.json().catch(() => ({}));
  const user = data?.name || data?.given_name || data?.email || "membro";
  return { valid: true, user };
}

async function validateGeneric(endpoint: string, method: string, token: string) {
  const r = await fetch(endpoint, {
    method: method || "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return { valid: false, error: `HTTP ${r.status}${text ? ` — ${text.slice(0, 160)}` : ""}` };
  }
  return { valid: true, user: "ok" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Modo novo: `integration_id` — o token é lido AQUI, com service role.
    // O navegador nunca toca a credencial crua (a coluna credentials tem
    // REVOKE para authenticated; é assim que deve continuar).
    let integrationType = (body?.integration_type ?? "").toString().toLowerCase().trim();
    let token = "";
    let integrationId: string | null = null;

    if (typeof body?.integration_id === "string" && body.integration_id.trim()) {
      integrationId = body.integration_id.trim();
      const { data: row } = await supabase
        .from("integrations")
        .select("name, integration_type, credentials, key_name")
        .eq("id", integrationId)
        .maybeSingle();
      if (!row) return json({ valid: false, error: "Conexão não encontrada" }, 404);
      integrationType = integrationType || (row.integration_type ?? "").toString().toLowerCase().trim();

      // Conexão criada por agente vem com tipo genérico ("api_key") mesmo
      // quando o NOME diz o provedor — o LinkedIn real da dn.ia era assim, e
      // caía no "não sei validar". Tipo genérico → inferir do nome.
      if (!integrationType || ["api_key", "custom", "api"].includes(integrationType)) {
        const nameKey = (row.name ?? "").toString().toLowerCase().replace(/[^a-z]/g, "");
        const known = ["linkedin", "meta", "facebook", "instagram", "telegram", "slack", "whatsapp", "canva", "elevenlabs", "perplexity"];
        if (known.includes(nameKey)) {
          integrationType = nameKey === "facebook" ? "meta" : nameKey;
        }
      }

      const credsArr = Array.isArray(row.credentials) ? row.credentials : [];
      // Preferir a credencial cujo nome parece token de acesso — com 2+
      // credenciais (access_token + client_secret), pegar "a última" validava
      // o secret contra a API e falhava à toa.
      let fallback = "";
      for (const c of credsArr) {
        const v = (c?.value ?? "").toString().trim();
        if (!v) continue;
        fallback = v;
        const keyName = (c?.key_name ?? c?.key ?? "").toString().toLowerCase();
        if (/access[_-]?token|api[_-]?key|bearer|^token$/.test(keyName)) token = v;
      }
      if (!token) token = fallback;
    } else {
      const creds = body?.credentials ?? {};
      token = (creds?.access_token ?? creds?.token ?? creds?.api_key ?? "").toString().trim();
    }

    if (!integrationType) return json({ valid: false, error: "integration_type é obrigatório" }, 400);
    if (!token) return json({ valid: false, error: "Esta conexão não tem credencial guardada para validar" }, 400);

    // Persiste o resultado quando validando por id — o card mostra "validada
    // há X" com carimbo, em vez do estado congelado da última escrita.
    const persist = async (result: { valid: boolean; error?: string }) => {
      if (!integrationId) return;
      await supabase.from("integrations").update({
        last_validated_at: new Date().toISOString(),
        last_validation_ok: result.valid,
        last_validation_error: result.valid ? null : (result.error ?? "").slice(0, 300),
      }).eq("id", integrationId);
    };
    const respond = async (result: { valid: boolean; error?: string; user?: string }) => {
      await persist(result);
      return json(result);
    };

    // Guard rail: detect obvious Client Secret pasted instead of token.
    if (integrationType === "linkedin" && /^WPL_AP/i.test(token)) {
      return respond({
        valid: false,
        error: "Isso parece o Client Secret (WPL_AP...), não o Access Token. Gere o token via OAuth.",
      });
    }

    // Quick-path providers
    if (integrationType === "linkedin") {
      return respond(await validateLinkedIn(token));
    }

    // Generic path: look up validation_endpoint in integration_templates
    const { data: tpl } = await supabase
      .from("integration_templates")
      .select("validation_endpoint, validation_method")
      .eq("integration_type", integrationType)
      .maybeSingle();

    if (!tpl?.validation_endpoint) {
      // "Não sei validar" não é falha da credencial — não carimba resultado.
      return json({
        valid: false,
        unsupported: true,
        error: `Validação automática não disponível para "${integrationType}".`,
      });
    }

    return respond(await validateGeneric(tpl.validation_endpoint, tpl.validation_method ?? "GET", token));
  } catch (e) {
    return json({ valid: false, error: String((e as Error).message ?? e) }, 500);
  }
});
