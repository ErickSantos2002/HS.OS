// OpenClaw Gateway client (frontend).
// Source of truth: public.vps_config table (super_admin only).
// All actual gateway calls go through edge functions that hold the token
// server-side — the browser never makes raw fetches with the token.

import { supabase } from "@/integrations/supabase/client";

// No hardcoded default gateway — the URL comes from public.vps_config,
// configured per install via Settings → Gateway (super_admin).
const DEFAULT_URL = "";

export interface GatewayConfig {
  url: string;
  token: string;
}

// In-memory cache for sync access (populated on first async load)
let cachedConfig: GatewayConfig | null = null;

/** Sync accessor — returns cached config or `{ url, token: "" }` when not loaded. */
export function getGatewayConfig(): GatewayConfig {
  if (cachedConfig) return cachedConfig;
  return { url: DEFAULT_URL, token: "" };
}

/** Load gateway config from Supabase (call once on app init). Times out after 3s. */
export async function loadGatewayConfig(): Promise<GatewayConfig> {
  try {
    const result = await Promise.race([
      supabase.from("vps_config").select("gateway_url, admin_token").limit(1).maybeSingle(),
      new Promise<{ data: null }>((resolve) => setTimeout(() => resolve({ data: null }), 3000)),
    ]);
    const data = (result as { data: { gateway_url?: string; admin_token?: string } | null }).data;
    if (data?.gateway_url) {
      cachedConfig = {
        url: data.gateway_url.replace(/\/$/, ""),
        token: data.admin_token || "",
      };
    } else {
      cachedConfig = { url: DEFAULT_URL, token: "" };
    }
  } catch {
    cachedConfig = { url: DEFAULT_URL, token: "" };
  }
  return cachedConfig;
}

export async function saveGatewayConfig(config: GatewayConfig): Promise<{ error: unknown }> {
  const next = { url: config.url.replace(/\/$/, ""), token: config.token };
  cachedConfig = next;

  // Upsert against the single config row. If the table is empty (first run),
  // insert; otherwise update the existing row.
  const { data: existing } = await supabase
    .from("vps_config")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("vps_config")
      .update({
        gateway_url: next.url,
        admin_token: next.token,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return { error };
  }

  const { error } = await supabase.from("vps_config").insert({
    gateway_url: next.url,
    admin_token: next.token,
  });
  return { error };
}

export interface TestResult {
  success: boolean;
  version?: string | null;
  error?: string;
}

/**
 * Tests the gateway connection via the `test-gateway-connection` edge function.
 * The token is sent to the function and never exposed in browser DevTools'
 * Authorization header on a third-party host.
 */
export async function testConnection(config: GatewayConfig): Promise<TestResult> {
  const { data, error } = await supabase.functions.invoke("test-gateway-connection", {
    body: { gateway_url: config.url, admin_token: config.token },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: Boolean(data?.success),
    version: data?.version ?? null,
    error: data?.error,
  };
}
