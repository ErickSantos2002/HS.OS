// Web Push sender. Invoked by trigger_send_push_on_notification.
// Also exposes GET /public-key for the frontend to fetch the VAPID public key.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const RAW_VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

// Normalize subject: web-push requires "mailto:..." or "https://..."
function normalizeVapidSubject(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^mailto:\s*/i, "mailto:");
  const mailtoMatch = v.match(/^mailto:<\s*([^>\s]+@[^>\s]+)\s*>$/i);
  if (mailtoMatch) return `mailto:${mailtoMatch[1]}`;
  const bareEmailMatch = v.match(/^<?\s*([^<>\s]+@[^<>\s]+)\s*>?$/i);
  if (bareEmailMatch) return `mailto:${bareEmailMatch[1]}`;
  v = v.replace(/[<>]/g, "").replace(/\s+/g, "");
  if (!v) return "mailto:admin@example.com";
  if (v.startsWith("mailto:") || v.startsWith("https://") || v.startsWith("http://")) return v;
  if (v.includes("@")) return `mailto:${v}`;
  return `https://${v}`;
}
const VAPID_SUBJECT = normalizeVapidSubject(RAW_VAPID_SUBJECT);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log("[send-push] VAPID configured. subject=", VAPID_SUBJECT);
  } catch (e) {
    console.error("[send-push] setVapidDetails failed:", e, "subject=", VAPID_SUBJECT);
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface PushPayload {
  user_id: string;
  title?: string;
  body?: string;
  channel_id?: string;
  message_id?: string;
  notification_id?: string;
  url?: string;
  tag?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Public-key endpoint — frontend fetches it on boot to subscribe.
  if (req.method === "GET" && url.pathname.endsWith("/public-key")) {
    return new Response(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({ error: "VAPID keys not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let payload: PushPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!payload.user_id) {
    return new Response(JSON.stringify({ error: "user_id required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: subs, error: subsErr } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", payload.user_id);

  if (subsErr) {
    console.error("[send-push] failed to load subs:", subsErr);
    return new Response(JSON.stringify({ error: subsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!subs || subs.length === 0) {
    return new Response(JSON.stringify({ sent: 0, reason: "no subscriptions" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const targetUrl = payload.url
    ?? (payload.channel_id ? `/chat?channel=${payload.channel_id}` : "/");

  // Count unread notifications for the recipient so the SW can update the app badge.
  let unreadCount = 0;
  try {
    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", payload.user_id)
      .eq("read", false);
    unreadCount = count ?? 0;
  } catch (e) {
    console.warn("[send-push] unread count failed:", e);
  }

  const pushBody = JSON.stringify({
    title: payload.title ?? "dn.os",
    body: payload.body ?? "",
    url: targetUrl,
    tag: payload.tag ?? payload.channel_id ?? payload.notification_id,
    icon: "/icons/icon-192.png",
    unread_count: unreadCount,
    notification_id: payload.notification_id,
    channel_id: payload.channel_id,
  });

  let sent = 0;
  let removed = 0;

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          pushBody,
          // urgency:"high" forces immediate delivery (default "normal" can be batched
          // for hours by FCM/APNs on idle desktops). TTL:60s avoids stale buildup.
          // topic groups pending pushes per channel so only the latest is kept
          // when the device wakes up — coherent with renotify:true on the client.
          {
            urgency: "high",
            TTL: 60,
            topic: (payload.channel_id ?? payload.notification_id ?? "dnos").toString().slice(0, 32),
          }
        );
        sent++;
        // best-effort: update last_used_at
        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", s.id);
      } catch (err: any) {
        const status = err?.statusCode;
        // Subscription is gone — clean up.
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          removed++;
        } else {
          console.warn("[send-push] send failed:", status, err?.body ?? err?.message);
        }
      }
    })
  );

  return new Response(
    JSON.stringify({ sent, removed, total: subs.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
