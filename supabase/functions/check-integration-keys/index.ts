import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: integrations, error } = await supabase
      .from("integrations")
      .select("id, key_name");

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates = (integrations ?? []).map((integration) => {
      const value = Deno.env.get(integration.key_name);
      if (value && value.length > 0) {
        const preview =
          value.length > 8
            ? `${value.slice(0, 4)}●●●●●●●●${value.slice(-4)}`
            : `●●●●${value.slice(-4)}`;
        return supabase
          .from("integrations")
          .update({
            is_configured: true,
            key_preview: preview,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integration.id);
      }
      return supabase
        .from("integrations")
        .update({
          is_configured: false,
          key_preview: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);
    });

    await Promise.all(updates);

    return new Response(
      JSON.stringify({ success: true, checked: integrations?.length ?? 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
