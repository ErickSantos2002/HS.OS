// CORS proxy for OpenClaw gateway /api/files/* endpoints.
// The gateway itself doesn't emit CORS headers, so browser calls fail with
// "Failed to fetch". This function forwards requests server-side with the
// gateway token and returns proper CORS headers to the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGatewayConfig as getSharedGatewayConfig, gatewayNotConfiguredResponse } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  // path passed via ?path=agentId/filename
  const subPath = (url.searchParams.get("path") ?? "").replace(/^\/+/, "");

  // Reject paths with .. or starting with /
  if (subPath.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid path" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const config = await getGatewayConfig();
  if (!config.url) {
    return gatewayNotConfiguredResponse(corsHeaders);
  }
  const targetUrl = `${config.url}/api/files${subPath ? `/${subPath}` : ""}`;
  const OPENCLAW_RPC = `${config.url}/api/v1/admin/rpc`;


  const pathParts = subPath.split("/").filter(Boolean);

  async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 8_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function callOpenClawRpc(method: string, params: Record<string, unknown>) {
    const token = config.token;
    const rpcRes = await fetchWithTimeout(OPENCLAW_RPC, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ method, params }),
    }, 6_000);
    const raw = await rpcRes.text();
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = { raw }; }
    if (!rpcRes.ok) throw new Error(parsed?.error?.message || parsed?.error || raw || `OpenClaw RPC ${rpcRes.status}`);
    return parsed?.payload ?? parsed?.result ?? parsed;
  }

  function normalizeFileList(data: any, agentId: string) {
    const list = Array.isArray(data?.files) ? data.files : Array.isArray(data) ? data : [];
    return list.map((f: any) => ({
      name: f?.name ?? f?.filename ?? f?.file_name ?? "",
      size: f?.size ?? new TextEncoder().encode(String(f?.content ?? "")).length,
      modified: f?.modified ?? f?.updated_at ?? f?.synced_at ?? f?.mtime ?? new Date().toISOString(),
      agentId,
    })).filter((f: any) => !!f.name);
  }

  async function tryRpcFilesFallback(): Promise<Response | null> {
    if (pathParts.length < 1 || pathParts.length > 2) return null;
    const agentId = pathParts[0];
    if (!agentId) return null;
    try {
      if (req.method === "GET" && pathParts.length === 1) {
        const data = await callOpenClawRpc("agents.files.list", { agentId });
        return new Response(JSON.stringify(normalizeFileList(data, agentId)), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (req.method === "GET" && pathParts.length === 2) {
        const data = await callOpenClawRpc("agents.files.get", { agentId, name: pathParts[1] });
        const file = data?.file ?? data;
        return new Response(JSON.stringify({
          name: file?.name ?? pathParts[1],
          content: file?.content ?? "",
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (req.method === "POST" && pathParts.length === 1) {
        const body = await req.clone().json().catch(() => ({}));
        const name = body?.filename ?? body?.name ?? body?.file_name;
        if (!name) return null;
        const data = await callOpenClawRpc("agents.files.set", {
          agentId,
          name,
          content: String(body?.content ?? ""),
        });
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (req.method === "DELETE" && pathParts.length === 2) {
        const data = await callOpenClawRpc("agents.files.delete", { agentId, name: pathParts[1] });
        return new Response(JSON.stringify(data ?? { success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      console.log(`[gateway-files-proxy] RPC fallback failed: ${(e as Error).message}`);
      return null;
    }
    return null;
  }

  // Fallback to the public /api/agents/<id>(/<key>) endpoint when the legacy
  // /api/files/* path returns 404 / empty. Exposes SOUL.md, IDENTITY.md,
  // MEMORY.md, USER.md, TOOLS.md, AGENTS.md, HEARTBEAT.md per agent.
  const FILE_KEYS = ["soul", "identity", "memory", "user", "tools", "agents", "heartbeat"];
  const FILE_NAMES: Record<string, string> = {
    soul: "SOUL.md",
    identity: "IDENTITY.md",
    memory: "MEMORY.md",
    user: "USER.md",
    tools: "TOOLS.md",
    agents: "AGENTS.md",
    heartbeat: "HEARTBEAT.md",
  };
  function fileNameToKey(filename: string): string | null {
    const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
    return FILE_KEYS.includes(base) ? base : null;
  }

  function knownAgentDocList(agentId: string) {
    return FILE_KEYS.map((key) => ({
      name: FILE_NAMES[key] ?? `${key.toUpperCase()}.md`,
      size: 0,
      modified: new Date().toISOString(),
      agentId,
      pendingSync: true,
    }));
  }

  // Fallback base URL comes from the configured gateway (public.vps_config).
  // No dn.ia-specific defaults — remix installs point at their own gateway.
  const AGENTS_API_BASES = config.url ? [config.url] : [];

  async function fetchFromAgentsApi(suffix: string): Promise<Response | null> {
    for (const base of AGENTS_API_BASES) {
      try {
        const r = await fetchWithTimeout(`${base}/api/agents${suffix}`, {}, 8_000);
        if (r.ok) return r;
        console.log(`[gateway-files-proxy] agents-api ${base} status ${r.status}`);
      } catch (e) {
        console.log(`[gateway-files-proxy] agents-api ${base} error: ${(e as Error).message}`);
      }
    }
    return null;
  }

  async function tryAgentsFallback(): Promise<Response | null> {
    if (req.method !== "GET") return null;
    const agentId = pathParts[0];
    if (!agentId) return null;

    if (pathParts.length === 1) {
      const r = await fetchFromAgentsApi(`/${agentId}`);
      if (!r) return null;
      try {
        const data = await r.json();
        const filesObj = data?.files ?? {};
        const list: any[] = [];
        for (const key of Object.keys(filesObj)) {
          const f = filesObj[key];
          if (!f || f.exists === false) continue;
          const name = f.filename || `${key.toUpperCase()}.md`;
          const content = typeof f.content === "string" ? f.content : "";
          list.push({
            name,
            size: new TextEncoder().encode(content).length,
            modified: f.modified || f.updated_at || new Date().toISOString(),
          });
        }
        return new Response(JSON.stringify(list), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        return null;
      }
    }

    if (pathParts.length === 2) {
      const key = fileNameToKey(pathParts[1]);
      if (!key) return null;
      const r = await fetchFromAgentsApi(`/${agentId}/${key}`);
      if (!r) return null;
      try {
        const text = await r.text();
        return new Response(JSON.stringify({ name: pathParts[1], content: text }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch {
        return null;
      }
    }
    return null;
  }

  try {
    const init: RequestInit = {
      method: req.method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": req.headers.get("Content-Type") || "application/json",
      },
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = await req.text();
    }

    const res = await fetchWithTimeout(targetUrl, init, 8_000);
    const body = await res.text();

    if (req.method === "GET" && pathParts.length >= 1 && pathParts.length <= 2) {
      const looksEmpty =
        res.status === 404 ||
        (res.ok && (body.trim() === "" || body.trim() === "[]"));
      if (looksEmpty) {
        if (pathParts.length === 1) {
          const fb = await tryAgentsFallback() ?? await tryRpcFilesFallback();
          if (fb) return fb;
          return new Response(JSON.stringify(knownAgentDocList(pathParts[0])), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const fb = await tryAgentsFallback() ?? await tryRpcFilesFallback();
        if (fb) return fb;
        // Always return 200 with empty content so the UI does not blank out
        return new Response(JSON.stringify({
          name: pathParts[1],
          content: "",
          pendingSync: true,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (req.method === "GET" && res.status === 404 && pathParts.length <= 1) {
      return new Response(JSON.stringify(pathParts[0] ? knownAgentDocList(pathParts[0]) : []), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = res.headers.get("Content-Type") || "application/json";
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders, "Content-Type": contentType },
    });
  } catch (err: any) {
    if (req.method === "GET" && pathParts.length === 1 && pathParts[0]) {
      return new Response(JSON.stringify(knownAgentDocList(pathParts[0])), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (["GET", "POST", "DELETE"].includes(req.method)) {
      const fb = await tryRpcFilesFallback() ?? (req.method === "GET" ? await tryAgentsFallback() : null);
      if (fb) return fb;
    }
    return new Response(
      JSON.stringify({
        error: err?.name === "AbortError" ? "Gateway timeout" : (err?.message || "Gateway error"),
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
