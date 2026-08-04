import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function checkToken(supabase: SupabaseClient, req: Request): Promise<boolean> {
  const expected = await getIntegrationSecret(supabase, "GUARDRAILS_API_TOKEN");
  if (!expected) return false;
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return !!token && token === expected;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Client criado antes da autenticação: o segredo agora pode vir do banco.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!(await checkToken(supabase, req))) return json({ error: "Unauthorized" }, 401);

  try {
    const url = new URL(req.url);
    const agentId = (url.searchParams.get("agent_id") ?? "").trim();
    if (!agentId) return json({ error: "agent_id is required" }, 400);

    // Filtro opcional por provedor (menor privilégio). Sem ele, esta função
    // devolvia TODAS as credenciais do agente de uma vez — e tudo que entra na
    // resposta entra no contexto do agente, no transcript da sessão e
    // potencialmente na memória dele (foi assim que um token da Meta acabou
    // citado literalmente no MEMORY.md de um agente). Pedir só o que vai usar
    // reduz essa superfície.
    // ADITIVO de propósito: sem `provider` o comportamento antigo é mantido,
    // para não quebrar agente que já dependa de receber tudo numa chamada.
    const provider = (url.searchParams.get("provider") ?? "").trim().toLowerCase();


    const { data, error } = await supabase
      .from("integrations")
      .select("name, is_configured, agents_using, credentials, key_name")
      .eq("is_configured", true)
      .contains("agents_using", [agentId]);

    if (error) return json({ error: error.message }, 400);

    const credentials: Record<string, string> = {};
    const integrations: Array<{ name: string; keys: string[] }> = [];

    // Casa o `provider` contra nome e key_name da integração, sem exigir grafia
    // exata: "linkedin" precisa achar "LinkedIn", e "meta" precisa achar
    // "Meta Ads" ou uma chave META_ACCESS_TOKEN.
    const matchesProvider = (row: any): boolean => {
      if (!provider) return true;
      const haystack = [row?.name, row?.key_name]
        .map((v) => (v ?? "").toString().toLowerCase())
        .join(" ");
      return haystack.includes(provider);
    };

    for (const row of (data ?? []).filter(matchesProvider)) {
      const creds = Array.isArray((row as any).credentials) ? (row as any).credentials : [];
      const keys: string[] = [];
      // Iterate in order; later entries (more recent rotations) win per key.
      for (const c of creds) {
        const keyName = (c?.key_name ?? c?.key ?? "").toString().trim();
        const value = (c?.value ?? "").toString();
        if (!keyName || !value) continue;
        credentials[keyName] = value;
        if (!keys.includes(keyName)) keys.push(keyName);
      }
      if (keys.length > 0) integrations.push({ name: (row as any).name, keys });
    }

    // Filtro que não casou com nada devolve vazio — mas vazio silencioso seria
    // lido como "este agente não tem credencial". Diz explicitamente que houve
    // filtro e o que existe, pra quem chamou saber que errou o nome do provedor
    // em vez de concluir que a integração não está configurada.
    const filteredToNothing = !!provider && integrations.length === 0;

    return json({
      success: true,
      agent_id: agentId,
      ...(provider && { provider }),
      credentials,
      integrations,
      count: Object.keys(credentials).length,
      ...(filteredToNothing && {
        note:
          `Nenhuma integração deste agente casa com provider="${provider}". ` +
          `Disponíveis: ${(data ?? []).map((r: any) => r?.name).filter(Boolean).join(", ") || "nenhuma"}.`,
      }),
    });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
