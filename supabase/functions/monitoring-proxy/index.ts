import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGatewayConfig as getSharedGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_ENDPOINTS = [
  "agents", "health", "cron", "usage", "skills",
  "gateway-status", "processes", "events",
];
const OPTIONAL_ENDPOINTS = new Set([
  "cron", "usage", "skills", "gateway-status", "processes", "events",
]);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getGatewayConfig(): Promise<{ url: string; token: string }> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return await getSharedGatewayConfig(supabase);
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Require authenticated caller
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  let callerUserId: string | null = null;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    callerUserId = String(userData.user.id);
  } catch {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  const config = await getGatewayConfig();

  // POST actions require super_admin
  if (req.method === "POST") {
    try {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: isAdmin } = await adminClient.rpc("has_role", {
        _user_id: callerUserId,
        _role: "super_admin",
      });
      if (!isAdmin) {
        return jsonResponse({ error: "Forbidden: super_admin required" }, 403);
      }
    } catch {
      return jsonResponse({ error: "Forbidden" }, 403);
    }
    try {
      const body = await req.json().catch(() => ({}));
      const action = body.action;

      if (action === "restart") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        try {
          const res = await fetch(`${config.url}/api/monitoring/gateway/restart`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            if (res.status === 404) {
              return jsonResponse({ success: false, error: "Endpoint de restart não disponível no gateway" }, 200);
            }
            return jsonResponse({ success: false, error: `Gateway retornou ${res.status}`, detail: text.slice(0, 500) }, 503);
          }
          const data = await res.json().catch(() => ({ success: true }));
          return jsonResponse(data);
        } catch (err: any) {
          clearTimeout(timeout);
          if (err.name === "AbortError") {
            return jsonResponse({ success: false, error: "Timeout ao reiniciar gateway" }, 503);
          }
          return jsonResponse({ success: false, error: err.message }, 503);
        }
      }

      if (action === "cleanup-chrome") {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(`${config.url}/api/monitoring/cleanup-chrome`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.token}`,
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (!res.ok) {
            if (res.status === 404) {
              return jsonResponse({ success: false, error: "Endpoint de limpeza não disponível" }, 200);
            }
            const text = await res.text().catch(() => "");
            return jsonResponse({ success: false, error: text.slice(0, 500) }, 503);
          }
          const data = await res.json().catch(() => ({ success: true }));
          return jsonResponse(data);
        } catch (err: any) {
          clearTimeout(timeout);
          return jsonResponse({ success: false, error: err.message }, 503);
        }
      }

      return jsonResponse({ error: "Ação inválida" }, 400);
    } catch {
      return jsonResponse({ error: "Body inválido" }, 400);
    }
  }

  // GET endpoints
  const endpoint = url.searchParams.get("endpoint");

  if (!endpoint || !ALLOWED_ENDPOINTS.includes(endpoint)) {
    return jsonResponse({ error: "Endpoint inválido. Permitidos: " + ALLOWED_ENDPOINTS.join(", ") }, 400);
  }

  // Map endpoint names to gateway paths
  const pathMap: Record<string, string> = {
    "gateway-status": "monitoring/gateway/status",
    "processes": "monitoring/processes",
    "events": "monitoring/events",
  };
  const apiPath = pathMap[endpoint] || endpoint;

  // Forward extra query params (e.g. date for usage)
  const extraParams = new URLSearchParams();
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== "endpoint") extraParams.set(k, v);
  }
  const qs = extraParams.toString();
  const targetUrl = `${config.url}/api/${apiPath}${qs ? `?${qs}` : ""}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(targetUrl, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");

      if (res.status === 404 && OPTIONAL_ENDPOINTS.has(endpoint)) {
        return jsonResponse(null, 200);
      }

      return jsonResponse(
        { error: `Gateway retornou ${res.status}`, detail: text.slice(0, 500) },
        res.status >= 500 ? 503 : res.status
      );
    }

    const data = await res.json();
    return jsonResponse(data);
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return jsonResponse({ error: "Gateway não respondeu em 10 segundos (timeout)" }, 503);
    }
    return jsonResponse({ error: "Falha ao conectar ao gateway", detail: err.message }, 503);
  }
});
