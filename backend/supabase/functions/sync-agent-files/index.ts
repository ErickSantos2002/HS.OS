// Sync agent workspace files (.md) from the orchestrator (Lia on the VPS) or
// a super_admin user. Same auth pattern as sync-agent-leadership /
// upsert-agent-guardrails: shared GUARDRAILS_API_TOKEN OR super_admin JWT.
//
// Body:
//   {
//     "agent_id": "kira",
//     "files": [
//       { "file_name": "SOUL.md", "content": "..." },
//       { "file_name": "AGENTS.md", "content": "..." }
//     ],
//     "replace": true   // optional, defaults to false. If true, deletes files
//                       // for this agent that are not in the payload.
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FileSchema = z.object({
  file_name: z.string().min(1).max(255),
  content: z.string().max(500_000).nullable().optional(),
});

const BodySchema = z.object({
  agent_id: z.string().min(1).max(120),
  files: z.array(FileSchema).max(500),
  replace: z.boolean().optional(),
  // Marca as linhas para a ponte escrever no disco da VPS (fluxo de
  // importação). Sem isto, o upsert é o push normal VPS→tabela.
  pending_write: z.boolean().optional(),
  origin: z.enum(["vps", "import", "ui"]).optional(),
});

// Ações da ponte (dnos-files-bridge, na VPS):
//   pull_pending — devolve as linhas pending_write=true para escrever no disco
//   ack_written  — confirma a escrita; limpa o pending e carimba written_at
const BridgeActionSchema = z.object({
  action: z.enum(["pull_pending", "ack_written"]),
  files: z
    .array(z.object({ agent_id: z.string().min(1).max(120), file_name: z.string().min(1).max(255) }))
    .max(500)
    .optional(),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // Client dedicado só para ler o segredo — o `admin` deste handler é criado
  // mais abaixo, e a autenticação precisa acontecer antes dele.
  const secretsClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const expectedToken = await getIntegrationSecret(secretsClient, "GUARDRAILS_API_TOKEN");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!bearer) return json({ error: "Unauthorized" }, 401);

  let authorized = false;
  let authSource = "";

  if (expectedToken && bearer === expectedToken) {
    authorized = true;
    authSource = "token";
  } else {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } },
    );
    const { data: claimsData } = await authClient.auth.getClaims(bearer);
    const uid = claimsData?.claims?.sub;
    if (uid) {
      const { data: roleRow } = await authClient
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .eq("role", "super_admin")
        .maybeSingle();
      if (roleRow) {
        authorized = true;
        authSource = `user:${uid}`;
      }
    }
  }

  if (!authorized) return json({ error: "Unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Ações da ponte vêm com `action` no corpo; o contrato original (upsert de
  // arquivos) segue idêntico quando não há `action`.
  if (raw && typeof raw === "object" && "action" in (raw as Record<string, unknown>)) {
    const bridgeParsed = BridgeActionSchema.safeParse(raw);
    if (!bridgeParsed.success) return json({ error: bridgeParsed.error.flatten() }, 400);
    const { action, files: ackFiles } = bridgeParsed.data;

    if (action === "pull_pending") {
      const { data, error } = await admin
        .from("agent_files")
        .select("agent_id, file_name, content")
        .eq("pending_write", true)
        .limit(200);
      if (error) return json({ error: error.message }, 500);
      console.log(`[sync-agent-files] auth=${authSource} pull_pending=${data?.length ?? 0}`);
      return json({ success: true, files: data ?? [] });
    }

    // ack_written — só limpa o pending de quem a ponte CONFIRMOU ter escrito,
    // um a um; nada de limpar em massa (uma escrita que falhou continua
    // pendente e volta na próxima rodada).
    let acked = 0;
    for (const f of ackFiles ?? []) {
      const { error } = await admin
        .from("agent_files")
        .update({ pending_write: false, written_at: new Date().toISOString() })
        .eq("agent_id", f.agent_id)
        .eq("file_name", f.file_name)
        .eq("pending_write", true);
      if (!error) acked++;
    }
    console.log(`[sync-agent-files] auth=${authSource} ack_written=${acked}`);
    return json({ success: true, acked });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  const { agent_id, files, replace, pending_write, origin } = parsed.data;

  const now = new Date().toISOString();
  const rows = files.map((f) => ({
    agent_id,
    file_name: f.file_name,
    content: f.content ?? "",
    synced_at: now,
    ...(pending_write !== undefined ? { pending_write } : {}),
    ...(origin ? { origin } : {}),
  }));

  let upserted = 0;
  if (rows.length > 0) {
    const { error, data } = await admin
      .from("agent_files")
      .upsert(rows, { onConflict: "agent_id,file_name" })
      .select("file_name");
    if (error) return json({ error: error.message }, 500);
    upserted = data?.length ?? 0;
  }

  let deleted = 0;
  if (replace) {
    const keep = files.map((f) => f.file_name);
    let query = admin.from("agent_files").delete().eq("agent_id", agent_id);
    if (keep.length > 0) query = query.not("file_name", "in", `(${keep.map((n) => `"${n.replace(/"/g, '""')}"`).join(",")})`);
    const { error, count } = await query.select("*", { count: "exact", head: true });
    if (error) return json({ error: error.message }, 500);
    deleted = count ?? 0;
  }

  console.log(`[sync-agent-files] auth=${authSource} agent=${agent_id} upserted=${upserted} deleted=${deleted}`);

  return json({
    success: true,
    agent_id,
    upserted,
    deleted,
    total: files.length,
  });
});
