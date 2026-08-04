// One-shot: imports existing cron jobs from OpenClaw gateway into public.automations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function parseCronSchedule(expr: string): { scheduled_day: string | null; scheduled_time: string | null } {
  try {
    const parts = expr.trim().split(/\s+/);
    if (parts.length < 5) return { scheduled_day: null, scheduled_time: null };
    const [minute, hour, , , dayOfWeek] = parts;
    const scheduled_time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    let scheduled_day: string | null = "daily";
    if (dayOfWeek !== "*" && dayOfWeek !== "?") {
      const dayNum = parseInt(dayOfWeek);
      if (!isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) scheduled_day = DAYS[dayNum];
    }
    return { scheduled_day, scheduled_time };
  } catch {
    return { scheduled_day: null, scheduled_time: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const gateway = await getGatewayConfig(supabase);
    if (!gateway.token) {
      return new Response(JSON.stringify({ error: "Gateway token not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await fetch(`${gateway.url}/api/v1/admin/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${gateway.token}` },
      body: JSON.stringify({ method: "cron.list", params: {} }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return new Response(JSON.stringify({ error: `Gateway error ${res.status}`, detail: txt }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();
    const jobs: Array<{
      id: string; name: string; enabled: boolean; agentId: string;
      schedule: { kind: string; expr?: string; everyMs?: number; tz?: string };
      payload?: { kind?: string; message?: string };
    }> = json?.payload?.jobs ?? json?.payload ?? json?.result?.jobs ?? json?.result ?? [];

    const cronJobs = (Array.isArray(jobs) ? jobs : []).filter((j) => j.schedule?.kind === "cron");

    const imports = cronJobs.map((job) => {
      const { scheduled_day, scheduled_time } = parseCronSchedule(job.schedule.expr || "");
      return {
        name: job.name,
        agent_id: job.agentId,
        type: "scheduled",
        scheduled_day,
        scheduled_time,
        instruction: job.payload?.message || "",
        is_active: job.enabled,
        created_by: null,
      };
    }).filter((j) => j.scheduled_day && j.scheduled_time && j.instruction && j.agent_id);

    if (!imports.length) {
      return new Response(JSON.stringify({ imported: 0, skipped: cronJobs.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabase
      .from("automations")
      .upsert(imports, { onConflict: "name,agent_id", ignoreDuplicates: true });

    if (error) {
      return new Response(JSON.stringify({ error: `Import error: ${error.message}` }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ imported: imports.length, skipped: (Array.isArray(jobs) ? jobs.length : 0) - imports.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
