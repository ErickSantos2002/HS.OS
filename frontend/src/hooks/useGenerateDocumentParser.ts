/**
 * Parser for <generate_document> tags emitted by agents.
 *
 * Format (JSON body inside the tag):
 *   <generate_document type="pdf" title="Relatório de Campanhas">
 *   { "content": [...pdfmake definition...], "styles": {...} }
 *   </generate_document>
 *
 * The parser strips the tag from visible text, calls the `generate-document`
 * edge function (dedup via sessionStorage so a re-render doesn't fire twice),
 * and returns the persisted document row for the card to render.
 */
import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

const GENERATE_DOC_REGEX =
  /<generate_document([^>]*)>([\s\S]*?)<\/generate_document>/g;
const ATTR_TYPE = /type="(pdf|docx)"/i;
const ATTR_TITLE = /title="([^"]*)"/;

export interface ParsedGenerateDocument {
  type: "pdf" | "docx";
  title: string;
  definition: unknown;
  /** Raw JSON body — used as part of the dedup signature. */
  raw: string;
}

export interface GeneratedDocument {
  id: string;
  title: string;
  doc_type: "pdf" | "docx";
  size_bytes: number;
  created_at: string;
}

function safeParseJson(body: string): unknown | null {
  try {
    return JSON.parse(body);
  } catch {
    // Try to recover the largest {...} block
    const first = body.indexOf("{");
    const last = body.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try { return JSON.parse(body.slice(first, last + 1)); } catch { /* ignore */ }
    }
    return null;
  }
}

export function stripGenerateDocuments(text: string): {
  cleanText: string;
  documents: ParsedGenerateDocument[];
} {
  const documents: ParsedGenerateDocument[] = [];
  const cleanText = text
    .replace(GENERATE_DOC_REGEX, (_match, attrsStr: string, body: string) => {
      const type = (attrsStr.match(ATTR_TYPE)?.[1] ?? "pdf").toLowerCase() as
        | "pdf"
        | "docx";
      const title = attrsStr.match(ATTR_TITLE)?.[1] ?? "Documento";
      const definition = safeParseJson(body.trim());
      if (definition) {
        documents.push({ type, title, definition, raw: body.trim() });
      }
      return "";
    })
    .trim();
  return { cleanText, documents };
}

export function useGenerateDocumentParser() {
  const generate = useCallback(
    async (
      parsed: ParsedGenerateDocument,
      agentId?: string | null,
    ): Promise<GeneratedDocument | null> => {
      const { data, error } = await supabase.functions.invoke(
        "generate-document",
        {
          body: {
            type: parsed.type,
            title: parsed.title,
            agent_id: agentId ?? null,
            definition: parsed.definition,
          },
        },
      );
      if (error) {
        console.warn("[generate-document] invoke failed:", error.message);
        return null;
      }
      const doc = (data as any)?.document as GeneratedDocument | undefined;
      return doc ?? null;
    },
    [],
  );
  return { generate };
}
