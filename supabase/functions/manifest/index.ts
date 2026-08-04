// Serves the PWA manifest dynamically with branding-configured icon and name.
// Public: verify_jwt = false. CORS enabled so browsers can fetch it cross-origin
// from the app's domain (start_url stays same-origin as the document).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function hslToHex(hslStr: string): string {
  const m = hslStr.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!m) return "#3D61FF";
  const h = parseFloat(m[1]) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  const originParam = url.searchParams.get("origin");
  if (originParam) return originParam.replace(/\/$/, "");
  const ref = req.headers.get("referer") || req.headers.get("origin");
  if (ref) {
    try { return new URL(ref).origin; } catch { /* ignore */ }
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data } = await supabase.from("branding").select("*").limit(1).maybeSingle();

  const name = data?.company_name || "dn.os";
  const icon = data?.pwa_icon_url || data?.favicon_url || data?.logo || "";
  const themeColor = hslToHex(data?.primary_color || "231 100% 62%");
  const origin = originFromRequest(req);

  const icons = icon
    ? [
        { src: icon, sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: icon, sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ]
    : [
        { src: `${origin}/icons/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: `${origin}/icons/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ];

  const manifest = {
    name,
    short_name: name,
    description: `${name} — sistema operacional para gerenciar agentes de IA`,
    start_url: origin ? `${origin}/` : "/",
    scope: origin ? `${origin}/` : "/",
    id: origin ? `${origin}/` : "/",
    display: "standalone",
    background_color: "#0A0A0A",
    theme_color: themeColor,
    orientation: "portrait-primary",
    icons,
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      ...cors,
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300",
    },
  });
});
