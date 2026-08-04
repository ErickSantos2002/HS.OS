// Edge function: obtém signed URL para conversa ElevenLabs ConvAI.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "ELEVENLABS_API_KEY não configurada." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = new URL(req.url);
    let agentId = url.searchParams.get("agentId");
    if (!agentId && (req.method === "POST")) {
      try {
        const body = await req.json();
        agentId = body?.agentId ?? null;
      } catch {}
    }

    if (!agentId) {
      return new Response(
        JSON.stringify({ error: "agentId obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey } },
    );

    const text = await res.text();
    if (!res.ok) {
      console.error("[arena-convai-signed-url] error", res.status, text.slice(0, 400));
      return new Response(
        JSON.stringify({ error: `ElevenLabs ${res.status}`, details: text.slice(0, 400) }),
        { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let data: any;
    try { data = JSON.parse(text); } catch { data = {}; }
    const signedUrl = data.signed_url || data.signedUrl;
    if (!signedUrl) {
      return new Response(
        JSON.stringify({ error: "Resposta sem signed_url." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ signedUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message || "Erro interno." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
