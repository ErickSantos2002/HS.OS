import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function buildJsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authenticated caller
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return buildJsonResponse({ error: "Unauthorized" }, 401);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userErr || !userData?.user) {
      return buildJsonResponse({ error: "Unauthorized" }, 401);
    }
  } catch {
    return buildJsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const { imageDataUrl, fileName } = await req.json();

    if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return buildJsonResponse({ error: "imageDataUrl inválido" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return buildJsonResponse({ error: "LOVABLE_API_KEY não configurada" }, 500);
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Você é um analisador visual para um chat com IA. Leia screenshots e imagens com máxima precisão. Extraia todo texto legível e descreva os elementos visuais necessários para que outro modelo de texto entenda a imagem sem vê-la. Para interfaces, informe títulos, labels, campos, opções selecionadas, avisos, badges e qualquer item destacado. Responda em português, de forma objetiva e fiel ao conteúdo da imagem.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analise esta imagem${fileName ? ` (${fileName})` : ""}. Retorne um resumo estruturado em 2 partes: 1) Texto visível; 2) O que está acontecendo na interface/na imagem.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 402 || response.status === 429) {
        console.warn("chat-image-vision degraded", { status: response.status, fileName, details: errorText });
        return buildJsonResponse({
          summary: "",
          degraded: true,
          reason: response.status === 402 ? "insufficient_credits" : "rate_limited",
        });
      }

      return buildJsonResponse(
        {
          error: `Erro no serviço de visão (${response.status})`,
          details: errorText,
        },
        500,
      );
    }

    const data = await response.json();
    const summary = extractTextContent(data?.choices?.[0]?.message?.content) || "Não consegui extrair detalhes dessa imagem.";

    return buildJsonResponse({ summary });
  } catch (error) {
    return buildJsonResponse({ error: error instanceof Error ? error.message : "Erro desconhecido" }, 500);
  }
});
