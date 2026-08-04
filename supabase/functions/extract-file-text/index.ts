// Extract text from PDF/DOCX/TXT/MD stored in 'company-docs' and forward to parse-company-context.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { storagePath, fileName } = await req.json();
    if (!storagePath || !fileName) {
      return new Response(JSON.stringify({ error: "storagePath e fileName obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error } = await supabase.storage
      .from("company-docs")
      .download(storagePath);

    if (error || !fileData) {
      return new Response(JSON.stringify({ error: "Arquivo não encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ext = String(fileName).split(".").pop()?.toLowerCase();
    let text = "";

    if (ext === "txt" || ext === "md") {
      text = await fileData.text();
    } else if (ext === "pdf") {
      try {
        const mod: any = await import("https://esm.sh/pdf-parse@1.1.1");
        const pdfParse = mod.default ?? mod;
        const buf = new Uint8Array(await fileData.arrayBuffer());
        const parsed = await pdfParse(buf);
        text = parsed.text ?? "";
      } catch (e) {
        return new Response(JSON.stringify({ error: `Falha ao ler PDF: ${(e as Error).message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else if (ext === "docx") {
      try {
        const mod: any = await import("https://esm.sh/mammoth@1.7.2");
        const mammoth = mod.default ?? mod;
        const buf = new Uint8Array(await fileData.arrayBuffer());
        const result = await mammoth.extractRawText({ buffer: buf });
        text = result.value ?? "";
      } catch (e) {
        return new Response(JSON.stringify({ error: `Falha ao ler DOCX: ${(e as Error).message}` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

    } else {
      return new Response(JSON.stringify({ error: "Formato não suportado" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!text.trim()) {
      return new Response(JSON.stringify({ error: "Arquivo sem texto extraível" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parseRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/parse-company-context`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: text.slice(0, 50000) }),
      },
    );

    const parsed = await parseRes.json();
    return new Response(JSON.stringify(parsed), {
      status: parseRes.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
