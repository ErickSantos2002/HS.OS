import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";

// Official agents are read from `agent_profiles.is_official = true` per request
// (no hardcoded list, so remix deployments don't need code changes).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function validateApiKey(req: Request): Promise<boolean> {
  const apiKey = req.headers.get("x-api-key");
  const expectedKey = await getIntegrationSecret(getClient(), "BROADCAST_API_KEY");
  return !!expectedKey && apiKey === expectedKey;
}

// ─── Resolve channel by name or UUID ───
async function resolveChannel(supabase: ReturnType<typeof getClient>, channel: string) {
  const { data: byName } = await supabase
    .from("channels")
    .select("id, name")
    .ilike("name", channel)
    .limit(1)
    .maybeSingle();
  if (byName) return byName;

  const { data: byId } = await supabase
    .from("channels")
    .select("id, name")
    .eq("id", channel)
    .maybeSingle();
  return byId;
}

// ─── POST result handler ───
async function handlePostResult(supabase: ReturnType<typeof getClient>, body: Record<string, unknown>) {
  const { agent_id, title, description, category, value } = body as {
    agent_id?: string; title?: string; description?: string; category?: string; value?: number;
  };

  if (!agent_id || !title) {
    return jsonRes({ error: "agent_id and title are required for type 'result'" }, 400);
  }

  const { data: inserted, error } = await supabase
    .from("agent_results")
    .insert({
      agent_id,
      title,
      description: description || null,
      category: category || "task",
      value: value ?? null,
      user_id: "sistema",
    })
    .select("id")
    .single();

  if (error) {
    console.error("Result insert error:", error);
    return jsonRes({ error: "Failed to insert result", details: error.message }, 500);
  }

  console.log(`[RESULT] Inserted result ${inserted.id} for agent ${agent_id}`);
  return jsonRes({ ok: true, result_id: inserted.id });
}

// ─── POST handler ───
async function handlePost(req: Request) {
  const supabase = getClient();
  const body = await req.json();

  // Route to result handler if type is "result"
  if (body.type === "result") {
    return await handlePostResult(supabase, body);
  }

  const { channel, sender_name, sender_avatar, message } = body;

  if (!channel || !sender_name || !message) {
    return jsonRes({ error: "channel, sender_name, and message are required" }, 400);
  }

  if (channel === "dm") {
    const { to, sender_name: sName, sender_avatar: sAvatar, message: msg, media: dmMedia } = body;
    if (!to || !sName || !msg) {
      return jsonRes({ error: "channel 'dm' requires to, sender_name, and message" }, 400);
    }

    // Resolve recipient by email or UUID
    let recipient: any = null;
    const { data: byEmail } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", to)
      .limit(1)
      .maybeSingle();
    if (byEmail) {
      recipient = byEmail;
    } else {
      const { data: byId } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", to)
        .maybeSingle();
      recipient = byId;
    }

    // ── Agent-to-Agent DM ──
    const recipientNormalized = (to as string).trim().toLowerCase().replace(/\s+/g, "-");
    let recipientIsOfficialAgent = false;
    if (!recipient) {
      const { data: agentRow } = await supabase
        .from("agent_profiles")
        .select("agent_id")
        .eq("agent_id", recipientNormalized)
        .eq("is_official", true)
        .maybeSingle();
      recipientIsOfficialAgent = !!agentRow;
    }
    if (!recipient && recipientIsOfficialAgent) {
      const senderAgentId = body.agent_id || sName.toLowerCase().replace(/\s+/g, "-");
      console.log(`[A2A-DM] ${senderAgentId} → ${recipientNormalized}`);

      const { data: a2aChannelId, error: a2aErr } = await supabase.rpc("find_or_create_agent_agent_dm", {
        _sender_agent_id: senderAgentId,
        _recipient_agent_id: recipientNormalized,
      });

      if (a2aErr || !a2aChannelId) {
        console.error("[A2A-DM] Channel creation error:", a2aErr);
        return jsonRes({ error: "Failed to create agent-agent DM channel" }, 500);
      }

      const { data: a2aMsg, error: a2aMsgErr } = await supabase
        .from("channel_messages")
        .insert({
          channel_id: a2aChannelId,
          author_id: senderAgentId,
          author_type: "agent",
          author_name: sName,
          author_avatar: sAvatar || null,
          content: msg,
        })
        .select("id")
        .single();

      if (a2aMsgErr) {
        console.error("[A2A-DM] Message insert error:", a2aMsgErr);
        return jsonRes({ error: "Failed to insert agent-agent message" }, 500);
      }

      // Trigger recipient agent to respond
      try {
        await supabase.functions.invoke("channel-agent-reply", {
          body: {
            channel_id: a2aChannelId,
            agent_id: recipientNormalized,
            message_count: 10,
            latest_user_message: msg,
            user_id: null,
          },
        });
        console.log(`[A2A-DM] Triggered ${recipientNormalized} reply in channel ${a2aChannelId}`);
      } catch (replyErr) {
        console.error("[A2A-DM] Reply trigger error (non-fatal):", replyErr);
      }

      return jsonRes({ ok: true, message_id: a2aMsg.id, agent_dm: true });
    }

    if (!recipient) {
      return jsonRes({ error: `Recipient "${to}" not found` }, 404);
    }

    const agentId = body.agent_id || sName.toLowerCase().replace(/\s+/g, "-");

    const { data: inserted, error: insertErr } = await supabase
      .from("conversations")
      .insert({
        agent_id: agentId,
        user_id: recipient.id,
        role: "agent",
        content: msg,
        ...(dmMedia ? { media: dmMedia } : {}),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("DM insert error:", insertErr);
      return jsonRes({ error: "Failed to insert DM" }, 500);
    }

    // Create notification for badge
    const { data: dmChannelId } = await supabase.rpc("find_or_create_agent_dm", {
      _agent_id: agentId,
      _agent_name: sName,
      _target_user_id: recipient.id,
    });

    if (dmChannelId) {
      await supabase.from("notifications").insert({
        user_id: recipient.id,
        channel_id: dmChannelId,
        agent_id: agentId,
        author_name: sName,
        content_preview: (msg as string).slice(0, 100),
      });
    }

    return jsonRes({ ok: true, message_id: inserted.id });
  }

  const channelRow = await resolveChannel(supabase, channel);
  if (!channelRow) {
    return jsonRes({ error: `Channel "${channel}" not found` }, 404);
  }

  const agentId = sender_name.toLowerCase().replace(/\s+/g, "-");

  const { data: inserted, error: insertError } = await supabase
    .from("channel_messages")
    .insert({
      channel_id: channelRow.id,
      author_id: agentId,
      author_type: "agent",
      author_name: sender_name,
      author_avatar: sender_avatar || null,
      content: message,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Insert error:", insertError);
    return jsonRes({ error: "Failed to insert message" }, 500);
  }

  // Notify human members
  const { data: members } = await supabase
    .from("channel_members")
    .select("user_id, member_type")
    .eq("channel_id", channelRow.id);

  if (members) {
    const humans = (members as any[]).filter((m) => m.member_type === "human");
    if (humans.length > 0) {
      await supabase.from("notifications").insert(
        humans.map((m) => ({
          user_id: m.user_id,
          channel_id: channelRow.id,
          author_name: sender_name,
          content_preview: message.slice(0, 100),
        }))
      );
    }
  }

  return jsonRes({ ok: true, message_id: inserted.id });
}

// ─── DELETE handler ───
async function handleDelete(req: Request) {
  const supabase = getClient();
  const { message_id } = await req.json();

  if (!message_id) {
    return jsonRes({ error: "message_id is required" }, 400);
  }

  console.log(`[DELETE] Request for message_id: ${message_id}`);

  // 1. Verify message exists
  const { data: existing, error: selectErr } = await supabase
    .from("channel_messages")
    .select("id, channel_id, author_name, content, author_type")
    .eq("id", message_id)
    .maybeSingle();

  if (selectErr) {
    console.error("[DELETE] Pre-select error:", selectErr);
    return jsonRes({ error: "Failed to look up message", details: selectErr.message }, 500);
  }

  if (!existing) {
    console.warn(`[DELETE] Message not found: ${message_id}`);
    return jsonRes({ ok: false, error: "Message not found" }, 404);
  }

  console.log(`[DELETE] Found message in channel ${existing.channel_id} by ${existing.author_name} (${existing.author_type}): "${(existing.content || "").slice(0, 80)}"`);

  // 2. Delete the message using service_role (bypasses RLS)
  const { error: deleteErr, count } = await supabase
    .from("channel_messages")
    .delete({ count: "exact" })
    .eq("id", message_id);

  if (deleteErr) {
    console.error("[DELETE] Delete error:", deleteErr);
    return jsonRes({ ok: false, error: "Failed to delete message", details: deleteErr.message }, 500);
  }

  console.log(`[DELETE] Delete returned count: ${count}`);

  if (count === 0) {
    console.error(`[DELETE] Delete count is 0 — RLS or permission issue`);
    return jsonRes({ ok: false, error: "Delete operation failed — no rows affected. Possible RLS issue." }, 500);
  }

  // 3. Verify deletion
  const { data: stillExists } = await supabase
    .from("channel_messages")
    .select("id")
    .eq("id", message_id)
    .maybeSingle();

  if (stillExists) {
    console.error(`[DELETE] Message ${message_id} still exists after DELETE`);
    return jsonRes({ ok: false, error: "Delete operation failed — message still exists." }, 500);
  }

  // 4. Clean up related notifications
  await supabase
    .from("notifications")
    .delete()
    .eq("message_id", message_id);

  console.log(`[DELETE] Message ${message_id} successfully deleted`);
  return jsonRes({ ok: true, deleted_id: message_id });
}

// ─── GET handler ───
async function handleGet(req: Request) {
  const supabase = getClient();
  const url = new URL(req.url);
  const channelParam = url.searchParams.get("channel");
  const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(limitParam, 1), 200);

  // If no channel param, return user directory (existing behavior)
  if (!channelParam) {
    return await handleGetUsers(supabase);
  }

  // Return channel messages
  const channelRow = await resolveChannel(supabase, channelParam);
  if (!channelRow) {
    return jsonRes({ error: `Channel "${channelParam}" not found` }, 404);
  }

  const { data: messages, error: msgErr } = await supabase
    .from("channel_messages")
    .select("id, content, author_name, author_type, author_avatar, created_at")
    .eq("channel_id", channelRow.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (msgErr) {
    console.error("Messages fetch error:", msgErr);
    return jsonRes({ error: "Failed to fetch messages" }, 500);
  }

  return jsonRes({
    ok: true,
    channel: channelRow.name,
    channel_id: channelRow.id,
    messages: (messages as any[]).map((m) => ({
      id: m.id,
      content: m.content,
      sender_name: m.author_name,
      sender_type: m.author_type,
      sender_avatar: m.author_avatar,
      created_at: m.created_at,
    })),
  });
}

// ─── GET /users (no channel param) ───
async function handleGetUsers(supabase: ReturnType<typeof getClient>) {
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, status")
    .eq("status", "active");

  if (pErr) {
    console.error("Profiles fetch error:", pErr);
    return jsonRes({ error: "Failed to fetch users" }, 500);
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_id, role");

  const roleMap = new Map<string, string>();
  if (roles) {
    for (const r of roles as any[]) {
      roleMap.set(r.user_id, r.role);
    }
  }

  const users = (profiles as any[]).map((p) => ({
    id: p.id,
    username: p.email ? p.email.split("@")[0] : p.id,
    display_name: p.full_name || p.email || "",
    role: roleMap.get(p.id) || "user",
    email: p.email,
    avatar: p.avatar_url || null,
  }));

  return jsonRes({ ok: true, users });
}

// ─── Main handler ───
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!(await validateApiKey(req))) {
    return jsonRes({ error: "Unauthorized" }, 401);
  }

  try {
    if (req.method === "GET") return await handleGet(req);
    if (req.method === "POST") return await handlePost(req);
    if (req.method === "DELETE") return await handleDelete(req);
    return jsonRes({ error: "Method not allowed" }, 405);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Broadcast error:", msg);
    return jsonRes({ error: msg }, 500);
  }
});
