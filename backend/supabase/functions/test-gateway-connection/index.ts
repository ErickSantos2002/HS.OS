// Tests the gateway connection without exposing the token to the browser.
// Accepts an explicit { gateway_url, admin_token } (for the "Test" button while
// editing) OR falls back to the saved vps_config row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

interface TestBody {
  gateway_url?: string;
  admin_token?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: TestBody = {};
  try {
    body = await req.json();
  } catch (_) {
    body = {};
  }

  let url = body.gateway_url?.replace(/\/$/, "") || "";
  let token = body.admin_token || "";

  if (!url || !token) {
    const cfg = await getGatewayConfig(supabase);
    url = url || cfg.url;
    token = token || cfg.token;
  }

  if (!url || !token) {
    return new Response(
      JSON.stringify({ success: false, error: "Configuração do gateway ausente." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const res = await fetch(`${url}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      await supabase
        .from("vps_config")
        .update({ is_connected: false })
        .eq("gateway_url", url);

      return new Response(
        JSON.stringify({ success: false, error: "Gateway não respondeu corretamente." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }

    await supabase
      .from("vps_config")
      .update({
        is_connected: true,
        last_ping: new Date().toISOString(),
        gateway_version: (data.version as string) || null,
      })
      .eq("gateway_url", url);

    return new Response(
      JSON.stringify({ success: true, version: data.version ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (_err) {
    await supabase
      .from("vps_config")
      .update({ is_connected: false })
      .eq("gateway_url", url);

    return new Response(
      JSON.stringify({
        success: false,
        error: "Servidor não encontrado. Verifique a URL e o token.",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
