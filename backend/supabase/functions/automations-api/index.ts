// Public API for automations:
//   GET  /automations-api/pending  → list active scheduled automations (anon-friendly)
//   POST /automations-api          → create automation (Bearer API key, e.g. agents)
//   POST /automations-api/notify   → send a DM confirmation for a saved automation
//                                    (called by the UI after save/update)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const DAY_LABEL_PT: Record<string, string> = {
  daily: "todos os dias",
  monday: "segunda",
  tuesday: "terça",
  wednesday: "quarta",
  thursday: "quinta",
  friday: "sexta",
  saturday: "sábado",
  sunday: "domingo",
};

const pad = (n: number) => String(n).padStart(2, "0");
const BRT_OFFSET = 3; // BRT = UTC - 3

/** Convert stored UTC (day, HH:MM) → BRT (day, HH:MM) for display. */
function toBrt(day: string | null, time: string | null): { day: string | null; time: string | null } {
  if (!time) return { day, time };
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return { day, time };
  let totalMin = hh * 60 + mm - BRT_OFFSET * 60;
  let shift = 0;
  while (totalMin < 0) { totalMin += 1440; shift -= 1; }
  while (totalMin >= 1440) { totalMin -= 1440; shift += 1; }
  const newTime = `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`;
  if (!day || day === "daily") return { day: "daily", time: newTime };
  const idx = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
  if (idx < 0) return { day, time: newTime };
  const newIdx = (idx + shift + 7) % 7;
  return { day: WEEKDAYS[newIdx], time: newTime };
}

/** Convert a BRT (day, HH:MM) → UTC (day, HH:MM) for storage. */
function toUtc(day: string | null, time: string | null) {
  if (!time) return { day, time };
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return { day, time };
  let totalMin = hh * 60 + mm + BRT_OFFSET * 60;
  let shift = 0;
  while (totalMin < 0) { totalMin += 1440; shift -= 1; }
  while (totalMin >= 1440) { totalMin -= 1440; shift += 1; }
  const newTime = `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`;
  if (!day || day === "daily") return { day: "daily", time: newTime };
  const idx = WEEKDAYS.indexOf(day as (typeof WEEKDAYS)[number]);
  if (idx < 0) return { day, time: newTime };
  const newIdx = (idx + shift + 7) % 7;
  return { day: WEEKDAYS[newIdx], time: newTime };
}

function formatScheduleBrt(day: string | null, timeUtc: string | null): string {
  const local = toBrt(day, timeUtc);
  const label = DAY_LABEL_PT[local.day ?? "daily"] ?? local.day ?? "—";
  return `${label} às ${local.time ?? "—"} BRT`;
}

/**
 * Resolve who receives the automation-confirmation DM. Prefers the given user
 * (the automation's creator / the caller); falls back to any super_admin so a
 * remix instance never depends on a hardcoded dn.ia user id.
 */
async function resolveRecipient(
  supabase: ReturnType<typeof getClient>,
  preferred: string | null,
): Promise<string | null> {
  if (preferred && /^[0-9a-f-]{36}$/i.test(preferred)) return preferred;
  const { data } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("role", "super_admin")
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function sendBroadcast(message: string, to: string | null) {
  const apiKey = await getIntegrationSecret(getClient(), "BROADCAST_API_KEY");
  const url = Deno.env.get("SUPABASE_URL")!;
  if (!apiKey) {
    console.warn("[automations-api] BROADCAST_API_KEY missing — skipping DM");
    return;
  }
  if (!to) {
    console.warn("[automations-api] no recipient resolved — skipping DM");
    return;
  }
  try {
    await fetch(`${url}/functions/v1/channel-broadcast`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "dm",
        to,
        sender_name: "Lia",
        sender_avatar: "🌙",
        message,
      }),
    });
  } catch (err) {
    console.error("[automations-api] broadcast failed:", err);
  }
}

// ─── GET /pending ───────────────────────────────────────────────
async function handlePending() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("automations")
    .select("id,name,agent_id,type,scheduled_day,scheduled_time,trigger_event,is_active,last_run_at,last_run_status,created_by,created_at")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return json({ ok: false, error: error.message }, 500);

  const automations = (data ?? []).map((a: any) => ({
    id: a.id,
    name: a.name,
    agent_id: a.agent_id,
    type: a.type,
    scheduled_day: a.scheduled_day,
    scheduled_time_utc: a.scheduled_time,
    scheduled_brt: a.type === "scheduled" ? formatScheduleBrt(a.scheduled_day, a.scheduled_time) : null,
    trigger_event: a.trigger_event,
    created_by: a.created_by,
    last_run_at: a.last_run_at,
    last_run_status: a.last_run_status,
    status: a.last_run_status ?? "pending",
  }));

  return json({ ok: true, count: automations.length, automations });
}

// ─── POST / (create via API key) ────────────────────────────────
async function handleCreate(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const expected = await getIntegrationSecret(getClient(), "BROADCAST_API_KEY");
  if (!expected || !auth.startsWith("Bearer ") || auth.slice(7) !== expected) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const name = (body.name || "").toString().trim();
  const agentId = (body.agent_id || "").toString().trim();
  const instruction = (body.instruction || body.prompt || "").toString().trim();
  const createdBy = body.created_by ? String(body.created_by) : null;
  const type = (body.type || "scheduled") as "scheduled" | "trigger";
  const isActive = body.is_active ?? body.enabled ?? true;

  if (!name || !agentId || !instruction) {
    return json({ ok: false, error: "name, agent_id, and instruction (or prompt) are required" }, 400);
  }

  // Schedule: accept either { scheduled_day, scheduled_time } already in BRT,
  // or an ISO `scheduled_time` (UTC timestamp) we'll decompose to (weekday, HH:MM).
  let scheduledDay: string | null = null;
  let scheduledTimeUtc: string | null = null;

  if (type === "scheduled") {
    if (body.scheduled_day && body.scheduled_time && !String(body.scheduled_time).includes("T")) {
      // Treat as BRT day + HH:MM, convert to UTC.
      const utc = toUtc(String(body.scheduled_day), String(body.scheduled_time));
      scheduledDay = utc.day;
      scheduledTimeUtc = utc.time;
    } else if (body.scheduled_time) {
      const d = new Date(body.scheduled_time);
      if (Number.isNaN(d.getTime())) {
        return json({ ok: false, error: "invalid scheduled_time" }, 400);
      }
      scheduledDay = WEEKDAYS[d.getUTCDay()];
      scheduledTimeUtc = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    } else {
      return json({ ok: false, error: "scheduled_time required for type=scheduled" }, 400);
    }
  }

  // created_by must be a uuid; for agent callers we accept null (column is nullable).
  const createdByUuid = createdBy && /^[0-9a-f-]{36}$/i.test(createdBy) ? createdBy : null;

  const supabase = getClient();
  const { data, error } = await supabase
    .from("automations")
    .insert({
      name,
      agent_id: agentId,
      type,
      scheduled_day: scheduledDay,
      scheduled_time: scheduledTimeUtc,
      trigger_event: type === "trigger" ? (body.trigger_event ?? null) : null,
      instruction,
      is_active: !!isActive,
      created_by: createdByUuid,
    })
    .select()
    .single();

  if (error) return json({ ok: false, error: error.message }, 500);

  const recipient = await resolveRecipient(supabase, createdByUuid);
  await sendBroadcast(
    `✅ Automação "${data.name}" agendada para ${formatScheduleBrt(data.scheduled_day, data.scheduled_time)} (criada por ${createdBy ?? "agente"})`,
    recipient,
  );

  return json({ ok: true, automation: data });
}

// ─── POST /notify (UI calls after save) ─────────────────────────
async function handleNotify(req: Request) {
  // Require an authenticated supabase user (verified via JWT) so the UI can
  // call this without exposing the broadcast key client-side.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claims?.claims) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const { automation_id, action } = body;
  if (!automation_id) return json({ ok: false, error: "automation_id required" }, 400);

  const svc = getClient();
  const { data: a, error } = await svc
    .from("automations")
    .select("id,name,type,scheduled_day,scheduled_time,trigger_event,created_by")
    .eq("id", automation_id)
    .single();
  if (error || !a) return json({ ok: false, error: "automation not found" }, 404);

  const callerId = (claims.claims as Record<string, unknown>).sub as string | undefined;
  const recipient = await resolveRecipient(svc, callerId ?? a.created_by ?? null);

  const verb = action === "updated" ? "atualizada" : "agendada";
  const when = a.type === "scheduled"
    ? `para ${formatScheduleBrt(a.scheduled_day, a.scheduled_time)}`
    : `no gatilho ${a.trigger_event}`;
  await sendBroadcast(`✅ Automação "${a.name}" ${verb} ${when}`, recipient);

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  // Path looks like /automations-api or /automations-api/pending
  const sub = url.pathname.replace(/^\/+/, "").split("/").slice(1).join("/"); // strip function name

  try {
    if (req.method === "GET" && (sub === "pending" || sub === "")) {
      if (sub === "pending") return await handlePending();
    }
    if (req.method === "POST") {
      if (sub === "notify") return await handleNotify(req);
      if (sub === "" || sub === "create") return await handleCreate(req);
    }
    return json({ ok: false, error: "Not found" }, 404);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[automations-api] error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
