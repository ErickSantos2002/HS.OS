// Edge function: cria agente ElevenLabs ConvAI diretamente (sem passar pelo gateway,
// que não expõe /api/convai/create — a chamada anterior retornava 404).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  name: string;
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
        JSON.stringify({ ok: false, error: "ELEVENLABS_API_KEY não configurada.", fallback: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as Body;
    if (!body?.name?.trim()) {
      return new Response(
        JSON.stringify({ ok: false, error: "Nome obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const ttsConfig: Record<string, unknown> = {
        // ElevenLabs rejects non-English ConvAI agents unless the TTS model is
        // turbo/flash v2_5. Keep this explicit so Portuguese arenas do not
        // silently fall back to text mode.
        model_id: "eleven_turbo_v2_5",
      };

      if (body.voiceId?.trim()) {
        ttsConfig.voice_id = body.voiceId.trim();
      }

      const payload: Record<string, unknown> = {
        name: body.name,
        conversation_config: {
          agent: {
            prompt: { prompt: body.systemPrompt ?? "Você é um agente útil." },
            first_message: body.openingMessage ?? "Olá! Como posso ajudar?",
            language: "pt",
          },
          tts: ttsConfig,
        },
      };

      const res = await fetch("https://api.elevenlabs.io/v1/convai/agents/create", {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        console.error("[arena-convai-create] ElevenLabs error", res.status, text.slice(0, 400));
        return new Response(
          JSON.stringify({ ok: false, error: `ElevenLabs ${res.status}`, details: text.slice(0, 400), fallback: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      let data: any;
      try { data = JSON.parse(text); } catch { data = {}; }
      const agentId = data?.agent_id ?? data?.agentId ?? data?.id ?? null;
      if (!agentId) {
        return new Response(
          JSON.stringify({ ok: false, error: "Resposta sem agent_id.", details: text.slice(0, 400), fallback: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ ok: true, agentId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      const isAbort = (e as Error).name === "AbortError";
      return new Response(
        JSON.stringify({ ok: false, error: isAbort ? "Timeout ao criar agente de voz." : (e as Error).message, fallback: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error("[arena-convai-create] erro:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message || "Erro interno.", fallback: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
