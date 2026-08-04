// Edge function: atualiza um agente ElevenLabs ConvAI já criado
// (systemPrompt, firstMessage, voiceId). Usada quando o usuário edita a arena.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  agentId: string;
  name?: string;
  systemPrompt?: string;
  openingMessage?: string;
  voiceId?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "ELEVENLABS_API_KEY não configurada." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as Body;
    if (!body?.agentId?.trim()) {
      return new Response(
        JSON.stringify({ ok: false, error: "agentId obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ttsConfig: Record<string, unknown> = { model_id: "eleven_turbo_v2_5" };
    if (body.voiceId?.trim()) ttsConfig.voice_id = body.voiceId.trim();

    const payload: Record<string, unknown> = {
      conversation_config: {
        agent: {
          prompt: { prompt: body.systemPrompt ?? "Você é um agente útil." },
          first_message: body.openingMessage ?? "Olá! Como posso ajudar?",
          language: "pt",
        },
        tts: ttsConfig,
      },
    };
    if (body.name?.trim()) payload.name = body.name.trim();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(body.agentId)}`,
        {
          method: "PATCH",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );

      const text = await res.text();
      if (!res.ok) {
        console.error("[arena-convai-update] ElevenLabs error", res.status, text.slice(0, 400));
        return new Response(
          JSON.stringify({ ok: false, error: `ElevenLabs ${res.status}`, details: text.slice(0, 400) }),
          { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      const isAbort = (e as Error).name === "AbortError";
      return new Response(
        JSON.stringify({ ok: false, error: isAbort ? "Timeout ao atualizar agente de voz." : (e as Error).message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message || "Erro interno." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
