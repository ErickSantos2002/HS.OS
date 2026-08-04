/**
 * Leitura de segredos de integração VPS <-> plataforma.
 *
 * Ordem: BANCO primeiro, VARIÁVEL DE AMBIENTE como fallback.
 *
 * O fallback não é detalhe — é o que torna a mudança segura. A dn.ia já roda em
 * produção com esses valores nos secrets do Supabase; se passássemos a ler só do
 * banco, toda chamada da VPS para a plataforma (respostas de agente, automações,
 * sync de skills, guardrails, métricas) deixaria de autenticar de uma vez.
 * Com o fallback: instalação existente segue pelo ambiente, instalação nova usa
 * o banco, e ninguém quebra.
 *
 * O banco vem primeiro porque é a fonte que dá para atualizar — rotacionar um
 * segredo pelo ambiente exigiria mexer nos secrets do Supabase à mão.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Cache por isolate. TTL curto para que uma rotação apareça em pouco tempo. */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: string; at: number }>();

/**
 * Devolve o valor do segredo, ou null se não existir em lugar nenhum.
 *
 * Nunca lança: uma falha de leitura no banco cai para o ambiente em vez de
 * derrubar a requisição — o objetivo é degradar, não interromper.
 */
export async function getIntegrationSecret(
  supabase: SupabaseClient,
  name: string,
): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  let fromDb: string | null = null;
  try {
    const { data } = await supabase
      .from("integration_secrets")
      .select("value")
      .eq("name", name)
      .maybeSingle();
    const v = (data as { value?: string } | null)?.value;
    if (typeof v === "string" && v.trim()) fromDb = v.trim();
  } catch (e) {
    // Tabela ausente (migration ainda não aplicada) ou indisponível: segue para
    // o ambiente. Instalações antigas nem chegam a ter a tabela.
    console.warn(`[integration-secret] leitura do banco falhou para ${name}:`, e instanceof Error ? e.message : e);
  }

  const value = fromDb ?? Deno.env.get(name) ?? null;
  if (value) cache.set(name, { value, at: Date.now() });
  return value;
}

/**
 * Compara o header Authorization com o segredo esperado.
 *
 * Centralizado aqui porque a verificação estava repetida em ~10 edge functions,
 * cada uma com sua variação de parsing do header — e toda vez que uma delas
 * mudasse de fonte (ambiente -> banco), a checagem teria de ser reescrita.
 */
export async function authorizeWithSecret(
  supabase: SupabaseClient,
  req: Request,
  secretName: string,
): Promise<boolean> {
  const expected = await getIntegrationSecret(supabase, secretName);
  if (!expected) return false;
  const provided = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return !!provided && provided === expected;
}
