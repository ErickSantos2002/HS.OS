// Edge function: gera estrutura JSON de uma Arena via gateway OpenClaw.
// Substitui a rota inexistente /api/arena/generate que causava "Failed to fetch".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ArenaGenerateRequest {
  description: string;
  voiceId?: string;
  agentCount?: number;
}

function buildPrompt(description: string, agentCount: number): string {
  return `Você é um arquiteto de arenas multi-agente da dn.ia.
Gere a estrutura JSON de uma arena para o cenário abaixo, com ${agentCount} agente(s) existente(s) do time.

CENÁRIO: ${description}

Super agentes disponíveis (use o id exato):
- lia (orquestradora, geral)
- rodrigo (estratégia, negócios)
- kira (marketing, conteúdo)
- cs (customer success)
- dev (engenharia)
- ops (operações)
- finance (financeiro)
- legal (jurídico)

Regra: a arena APENAS combina agentes existentes. Não crie personas nem system prompts alternativos — o comportamento do agente é o dele mesmo, complementado pelo prompt inicial da arena e por papel opcional por agente.

IMPORTANTE: responda APENAS com JSON puro, sem markdown, sem \`\`\`, sem comentários.

Formato exato:
{
  "name": "Nome curto da arena",
  "emoji": "🎯",
  "description": "Descrição em 1 linha",
  "openingMessage": "Mensagem de abertura para o usuário",
  "agents": ["id1"${agentCount > 1 ? ', "id2"' : ""}${agentCount > 2 ? ', "id3"' : ""}]
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ArenaGenerateRequest;
    const description = body.description?.trim();
    const agentCount = body.agentCount ?? 3;

    if (!description) {
      return new Response(
        JSON.stringify({ ok: false, error: "Descrição obrigatória." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { url: gatewayUrl, token: adminToken } = await getGatewayConfig(supabase);
    if (!gatewayUrl || !adminToken) {
      return new Response(
        JSON.stringify({ ok: false, error: "Gateway não configurado.", code: "GATEWAY_NOT_CONFIGURED" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    let raw: any;
    try {
      const res = await fetch(`${gatewayUrl}/v1/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openclaw:lia",
          input: buildPrompt(description, agentCount),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return new Response(
          JSON.stringify({ ok: false, error: `Gateway ${res.status}: ${errText.slice(0, 300)}` }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      raw = await res.json();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        return new Response(
          JSON.stringify({ ok: false, error: "Timeout ao gerar arena. Tente novamente." }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }

    // Parse defensivo — /v1/responses pode devolver várias estruturas.
    const textContent: string =
      raw?.output_text ??
      raw?.output?.[0]?.content?.[0]?.text ??
      raw?.choices?.[0]?.message?.content ??
      raw?.text ??
      (typeof raw === "string" ? raw : JSON.stringify(raw));

    let arena: any;
    try {
      const jsonMatch =
        textContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ??
        textContent.match(/(\{[\s\S]*\})/);
      arena = JSON.parse((jsonMatch?.[1] ?? textContent).trim());
    } catch {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Resposta do modelo não era JSON válido.",
          preview: String(textContent).slice(0, 500),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, arena }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[arena-generate] erro:", err);
    return new Response(
      JSON.stringify({ ok: false, error: (err as Error).message || "Erro interno." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
