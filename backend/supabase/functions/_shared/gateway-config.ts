// Shared gateway config loader for all edge functions.
// Single source of truth: public.vps_config table.
// Falls back to env secrets during transition.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface GatewayConfig {
  url: string;
  token: string;
}

// No hardcoded default — every install must configure its own gateway
// through public.vps_config (Settings → Gateway). Env fallback is kept
// as an escape hatch for edge functions running before the row exists.
export async function getGatewayConfig(supabase: SupabaseClient): Promise<GatewayConfig> {
  let dbUrl = "";
  let dbToken = "";
  try {
    const { data } = await supabase
      .from("vps_config")
      .select("gateway_url, admin_token")
      .limit(1)
      .maybeSingle();

    if (data?.gateway_url) dbUrl = String(data.gateway_url);
    if (data?.admin_token) dbToken = String(data.admin_token);
  } catch (_) {
    // fall through to env fallback per-field
  }

  const envUrl = Deno.env.get("OPENCLAW_GATEWAY_URL") || "";
  const envToken = Deno.env.get("OPENCLAW_ADMIN_TOKEN") || "";

  const url = (dbUrl || envUrl).replace(/\/$/, "");
  const token = dbToken || envToken;

  return { url, token };
}

/**
 * Standardized 503 response for edge functions that need a gateway but none
 * is configured. Callers should return this early before attempting any
 * gateway call so remix installs surface a clear, actionable message.
 */
export function gatewayNotConfiguredResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: "Gateway não configurado.",
      action: "Acesse Settings → Configurações e insira a URL do seu VPS.",
      code: "GATEWAY_NOT_CONFIGURED",
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
