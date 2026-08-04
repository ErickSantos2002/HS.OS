// save-install-block — recebe o bloco impresso pelo setup.sh e distribui os
// valores para os lugares certos.
//
// Antes, o usuário do remix tinha de: anotar o IP e o token do gateway do
// terminal, preencher 12 campos de secret à mão no painel do Lovable, e só então
// voltar ao assistente. Agora o instalador imprime tudo de uma vez e isto aqui
// recebe a colagem.
//
// Onde cada coisa vai:
//   GATEWAY_URL + OPENCLAW_ADMIN_TOKEN -> vps_config (já existia, é a conexão)
//   os 8 segredos de integração        -> integration_secrets (tabela nova)
//
// Só super_admin: é configuração de instalação, e o bloco contém credenciais.
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

// Allowlist explícita. Sem ela, um bloco adulterado poderia inserir qualquer
// chave na tabela de segredos — inclusive sobrescrever algo que o sistema use
// para outro fim. Só entram os nomes que o setup.sh gera.
const INTEGRATION_SECRETS = new Set([
  "AGENT_REPLY_WEBHOOK_SECRET",
  "AUTOMATION_WEBHOOK_SECRET",
  "BROADCAST_API_KEY",
  "GUARDRAILS_API_TOKEN",
  "SKILL_SYNC_SECRET",
  "INGEST_KEY",
  "COLLECTOR_API_TOKEN",
  "AGENT_ACTIVITY_BRIDGE_TOKEN",
]);

/**
 * Extrai pares NOME=VALOR do texto colado.
 *
 * Tolerante de propósito: o usuário copia do terminal, então vêm linhas de
 * enfeite, comentários e espaços em branco. Melhor ignorar o que não reconhece
 * do que rejeitar a colagem inteira por causa de uma borda de caixa.
 */
function parseBlock(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    // Nome de variável de ambiente, para não capturar texto solto que por acaso
    // tenha um "=" no meio.
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !value) continue;
    out[name] = value;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
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

    const { block } = await req.json().catch(() => ({}));
    if (typeof block !== "string" || !block.trim()) {
      return json({ error: "Cole o bloco gerado pelo instalador." }, 400);
    }

    const parsed = parseBlock(block);
    const gatewayUrl = parsed["GATEWAY_URL"];
    const adminToken = parsed["OPENCLAW_ADMIN_TOKEN"];

    // Sem o endereço do gateway o resto não serve para nada — falha explicando
    // o que faltou, em vez de gravar pela metade.
    if (!gatewayUrl) {
      return json({
        error: "O bloco não contém GATEWAY_URL. Copie o bloco inteiro, da primeira à última linha.",
        code: "missing_gateway_url",
      }, 400);
    }

    // 1) Conexão com o gateway.
    const { data: existing } = await supabase
      .from("vps_config")
      .select("id")
      .limit(1)
      .maybeSingle();

    const vpsPayload: Record<string, unknown> = {
      gateway_url: gatewayUrl.replace(/\/$/, ""),
      updated_at: new Date().toISOString(),
    };
    // O token só é sobrescrito se vier no bloco — recolar um bloco sem ele não
    // deve apagar o token que já funciona.
    if (adminToken) vpsPayload.admin_token = adminToken;

    const vpsRes = existing?.id
      ? await supabase.from("vps_config").update(vpsPayload).eq("id", existing.id)
      : await supabase.from("vps_config").insert(vpsPayload);
    if (vpsRes.error) return json({ error: vpsRes.error.message }, 400);

    // 2) Segredos de integração.
    const rows = Object.entries(parsed)
      .filter(([name]) => INTEGRATION_SECRETS.has(name))
      .map(([name, value]) => ({ name, value, updated_at: new Date().toISOString() }));

    if (rows.length > 0) {
      const { error } = await supabase
        .from("integration_secrets")
        .upsert(rows, { onConflict: "name" });
      if (error) return json({ error: error.message }, 400);
    }

    // Nomes ausentes, para a interface poder avisar em vez de deixar o usuário
    // descobrir depois que uma integração não autentica.
    const missing = [...INTEGRATION_SECRETS].filter((n) => !(n in parsed));

    // Devolve NOMES, nunca valores — a resposta vai para o navegador.
    return json({
      success: true,
      gatewayUrl: vpsPayload.gateway_url,
      adminTokenSaved: !!adminToken,
      secretsSaved: rows.map((r) => r.name),
      secretsMissing: missing,
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
