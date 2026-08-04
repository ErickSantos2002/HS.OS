// Generate PDF or DOCX from a JSON definition, upload to private bucket, insert row.
// Auth required; validates JWT in code (verify_jwt=false is default on Lovable).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import PdfPrinter from "npm:pdfmake@0.2.10";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "npm:docx@8.5.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Built-in Helvetica fonts (no external font files required in the runtime)
const helveticaFamily = {
  normal: "Helvetica",
  bold: "Helvetica-Bold",
  italics: "Helvetica-Oblique",
  bolditalics: "Helvetica-BoldOblique",
};
const fonts = {
  Roboto: helveticaFamily,
  Helvetica: helveticaFamily,
  Arial: helveticaFamily,
} as const;

async function generatePdf(definition: any): Promise<Uint8Array> {
  const printer = new (PdfPrinter as any)(fonts);
  const doc = printer.createPdfKitDocument({
    defaultStyle: { font: "Roboto" },
    ...definition,
  });
  return await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    doc.on("data", (c: Uint8Array) => chunks.push(c));
    doc.on("end", () => {
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      resolve(out);
    });
    doc.on("error", reject);
    doc.end();
  });
}

/**
 * DOCX definition shape (simple, agent-friendly):
 * { title?: string, sections: [{ heading?: 'H1'|'H2'|'H3', text?: string, bold?: boolean }] }
 * Or raw docx.js JSON via `raw: true`.
 */
async function generateDocx(definition: any): Promise<Uint8Array> {
  const children: Paragraph[] = [];
  if (definition?.title) {
    children.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: String(definition.title), bold: true, size: 36 })],
    }));
  }
  const blocks: any[] = Array.isArray(definition?.sections) ? definition.sections
    : Array.isArray(definition?.content) ? definition.content : [];
  for (const b of blocks) {
    if (typeof b === "string") {
      children.push(new Paragraph({ children: [new TextRun({ text: b })] }));
      continue;
    }
    const level = b.heading;
    const headingLevel = level === "H1" ? HeadingLevel.HEADING_1
      : level === "H2" ? HeadingLevel.HEADING_2
      : level === "H3" ? HeadingLevel.HEADING_3
      : undefined;
    children.push(new Paragraph({
      heading: headingLevel,
      spacing: { after: 120 },
      children: [new TextRun({
        text: String(b.text ?? ""),
        bold: !!b.bold,
        italics: !!b.italic,
        size: b.size ?? undefined,
      })],
    }));
  }
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
  }
  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const type = body?.type;
    const title = String(body?.title ?? "Documento").slice(0, 200);
    const agentId = body?.agent_id ?? null;
    const definition = body?.definition;

    if (type !== "pdf" && type !== "docx") {
      return new Response(JSON.stringify({ error: "invalid_type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!definition || typeof definition !== "object") {
      return new Response(JSON.stringify({ error: "invalid_definition" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let bytes: Uint8Array;
    try {
      bytes = type === "pdf" ? await generatePdf(definition) : await generateDocx(definition);
    } catch (e: any) {
      console.error("[generate-document] generation failed:", e?.message ?? e);
      return new Response(JSON.stringify({ error: "generation_failed", detail: String(e?.message ?? e) }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const docId = crypto.randomUUID();
    const ext = type === "pdf" ? "pdf" : "docx";
    const mime = type === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const storagePath = `${userId}/${docId}.${ext}`;

    const { error: upErr } = await admin.storage
      .from("generated-documents")
      .upload(storagePath, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      console.error("[generate-document] upload failed:", upErr.message);
      return new Response(JSON.stringify({ error: "upload_failed", detail: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: insErr } = await admin
      .from("generated_documents")
      .insert({
        id: docId,
        user_id: userId,
        agent_id: agentId,
        title,
        doc_type: type,
        storage_path: storagePath,
        size_bytes: bytes.byteLength,
      })
      .select("id, title, doc_type, size_bytes, created_at")
      .single();

    if (insErr) {
      // Best-effort cleanup of the uploaded blob
      await admin.storage.from("generated-documents").remove([storagePath]);
      console.error("[generate-document] insert failed:", insErr.message);
      return new Response(JSON.stringify({ error: "db_insert_failed", detail: insErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ document: row }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[generate-document] unexpected:", e?.message ?? e);
    return new Response(JSON.stringify({ error: "unexpected", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
