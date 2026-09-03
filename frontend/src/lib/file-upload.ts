/**
 * File upload to Supabase Storage + text extraction for documents.
 */

import { enviarArquivo, urlPublica, type Bucket } from "@/lib/storage";
import { caminhoDeAnexo } from "@/lib/caminho-de-anexo";

const MAX_TEXT_CHARS = 50_000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export interface FileAttachmentMeta {
  name: string;
  url: string;
  size?: number;
  mimeType?: string;
}

export type FilePreviewKind = "pdf" | "audio" | "video" | "text" | "office" | "unsupported";

const TEXT_EXTRACTABLE = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export function isImageFile(file: File) {
  return IMAGE_TYPES.includes(file.type) || file.type.startsWith("image/");
}

export function isDocumentFile(file: File) {
  return !isImageFile(file);
}

/** Any file is accepted now — up to 50MB */
export function isAcceptedFile(file: File) {
  return file.size <= MAX_FILE_SIZE_BYTES;
}

export function canExtractText(file: File) {
  return (
    TEXT_EXTRACTABLE.includes(file.type) ||
    /\.(txt|md|pdf|doc|docx)$/i.test(file.name)
  );
}

export const MAX_UPLOAD_SIZE = MAX_FILE_SIZE_BYTES;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Get a human-friendly file type icon name */
export function getFileTypeIcon(name: string, mimeType?: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["pdf"].includes(ext)) return "pdf";
  if (["doc", "docx"].includes(ext)) return "doc";
  if (["xls", "xlsx"].includes(ext)) return "xls";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "zip";
  if (["mp3", "wav", "ogg", "m4a", "flac"].includes(ext)) return "audio";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["txt", "md", "csv", "json", "xml", "yaml", "yml"].includes(ext)) return "text";
  if (mimeType?.startsWith("image/")) return "image";
  return "file";
}

export function getFileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function getFilePreviewKind(name: string, mimeType?: string): FilePreviewKind {
  const extension = getFileExtension(name);

  if (mimeType === "application/pdf" || extension === "pdf") return "pdf";
  if (mimeType?.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "aac", "webm"].includes(extension)) return "audio";
  if (mimeType?.startsWith("video/") || ["mp4", "mov", "avi", "mkv", "webm", "m4v"].includes(extension)) return "video";
  if (
    mimeType?.startsWith("text/") ||
    ["txt", "md", "csv", "json", "xml", "yaml", "yml", "log", "ts", "tsx", "js", "jsx", "css", "html", "sql"].includes(extension)
  ) {
    return "text";
  }
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(extension)) return "office";

  return "unsupported";
}

/**
 * Convert a (possibly expired) signed Supabase Storage URL into a fresh public URL
 * for the `agent-files` bucket. Returns the original URL if it's not a Storage URL.
 */
function refreshStorageUrl(url: string): string {
  try {
    const u = new URL(url);
    // Match both signed and public Storage URLs
    // /storage/v1/object/sign/<bucket>/<path>?token=...
    // /storage/v1/object/public/<bucket>/<path>
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)$/);
    if (!m) return url;
    const bucket = decodeURIComponent(m[1]);
    const path = decodeURIComponent(m[2]);
    return urlPublica(bucket as Bucket, path) || url;
  } catch {
    return url;
  }
}

async function tryFetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}${txt ? `: ${txt.slice(0, 120)}` : ""}`);
  }
  return await response.blob();
}

export async function downloadAttachment({ url, name }: Pick<FileAttachmentMeta, "url" | "name">) {
  let blob: Blob | null = null;
  let lastErr: unknown = null;

  // Attempt 1: original URL
  try {
    blob = await tryFetchBlob(url);
  } catch (err) {
    lastErr = err;
    console.warn("[download] original URL failed, trying refreshed public URL", err);
  }

  // Attempt 2: refreshed public Storage URL (handles expired JWT/signed URLs)
  if (!blob) {
    const fresh = refreshStorageUrl(url);
    if (fresh && fresh !== url) {
      try {
        blob = await tryFetchBlob(fresh);
      } catch (err) {
        lastErr = err;
        console.warn("[download] refreshed URL also failed", err);
      }
    }
  }

  if (blob) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }

  // Detect "not found" / 404 — file no longer exists in storage
  const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "");
  const isNotFound = /404|not[_\s-]?found|Object not found/i.test(errMsg);
  if (isNotFound) {
    throw new Error(
      `Arquivo "${name}" não está mais disponível no servidor (foi removido ou o upload original falhou). Peça a quem enviou para reenviá-lo.`,
    );
  }

  // Fallback: open the refreshed public URL in a new tab
  const fallbackUrl = refreshStorageUrl(url);
  const opened = window.open(fallbackUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    throw new Error(
      `Não foi possível baixar "${name}"${errMsg ? `: ${errMsg}` : ""}.`,
    );
  }
}

/**
 * Envia um arquivo para o bucket `agent-files` e devolve a URL pública dele.
 *
 * ⚠️ **Não é URL assinada.** Esta docstring dizia "Returns a signed URL valid
 * for 30 days" até 03/09/2026, contradizendo o comentário quinze linhas abaixo,
 * que explica justamente por que não há assinatura. Herança do texto da versão
 * Supabase.
 *
 * ⚠️ **O nome do arquivo é aleatório, e isso é a defesa.** O caminho era
 * `<epoch em ms>_<nome original>`, e o `epoch` fica a poucas dezenas de
 * milissegundos do `created_at` da mensagem — que a API devolve com precisão de
 * microssegundo. Como o bucket é de leitura pública, quem conhecesse o canal e
 * o nome do arquivo reconstruía a URL. Ver `caminho-de-anexo.ts`.
 */
export async function uploadFileToStorage(
  bucketPath: string,
  file: File
): Promise<string> {
  const path = caminhoDeAnexo(bucketPath, file.name);

  // A conferência de que o objeto existe saiu junto com o `list()`: aqui o
  // upload só responde 201 depois de o arquivo estar gravado em disco, e
  // qualquer falha vira exceção. Não há o "sucesso silencioso" contra o qual
  // aquela checagem defendia.
  const enviado = await enviarArquivo("agent-files", path, file, file.name);

  // Não há URL assinada: `agent-files` é bucket de leitura pública, como já era
  // no Supabase (o `createSignedUrl` tinha `getPublicUrl` como fallback e caía
  // nele sempre que a assinatura falhava). O agente precisa buscar o arquivo
  // sozinho, do lado do gateway, e não teria como carregar nosso token.
  return `${window.location.origin}${enviado.url}`;
}

export async function extractTextFromFileUrl(
  fileUrl: string,
  mimeType: string,
): Promise<{ text: string; extracted: boolean }> {
  // Uses the configured gateway (public.vps_config). If no gateway is set up
  // for this install, extraction is skipped silently — the file itself is
  // still delivered via signed URL and the agent can fetch it directly.
  const { getGatewayConfig } = await import("@/lib/gateway");
  const { url } = getGatewayConfig();
  if (!url) {
    return { text: "", extracted: false };
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/extract-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileUrl,
        mimeType: mimeType || "application/octet-stream",
      }),
    });

    if (!res.ok) {
      const details = await res.text().catch(() => "");
      throw new Error(details || `HTTP ${res.status}`);
    }

    const data = await res.json().catch(() => ({}));
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    return { text, extracted: text.length > 0 };
  } catch (error) {
    console.warn("[file-upload] extract-text failed:", error);
    return { text: "", extracted: false };
  }
}

/**
 * Extract text content from a document file.
 * Supports: .txt, .md (direct read), .pdf (basic extraction), .doc/.docx (basic).
 * Returns { text, truncated }.
 */
export async function extractDocumentText(
  file: File
): Promise<{ text: string; truncated: boolean }> {
  let raw = "";

  if (file.type === "text/plain" || file.type === "text/markdown" || /\.(txt|md)$/i.test(file.name)) {
    raw = await file.text();
  } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    raw = await extractPdfText(file);
  } else if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(file.name)
  ) {
    raw = await extractDocxText(file);
  } else if (file.type === "application/msword" || /\.doc$/i.test(file.name)) {
    raw = await extractBinaryDocText(file);
  } else {
    raw = "[Formato não suportado para extração de texto]";
  }

  const truncated = raw.length > MAX_TEXT_CHARS;
  const text = truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw;
  return { text, truncated };
}

/** Extract text from PDF using pdf.js-like approach (basic ArrayBuffer scan) */
async function extractPdfText(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const text = extractTextFromPdfBytes(bytes);
    return text || "[Não foi possível extrair texto deste PDF]";
  } catch {
    return "[Erro ao processar PDF]";
  }
}

/** Basic PDF text extraction by finding text streams */
function extractTextFromPdfBytes(bytes: Uint8Array): string {
  const str = new TextDecoder("latin1").decode(bytes);
  const texts: string[] = [];
  
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(str)) !== null) {
    const block = match[1];
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      texts.push(tjMatch[1]);
    }
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrMatch[1];
      const parts = inner.match(/\(([^)]*)\)/g);
      if (parts) {
        texts.push(parts.map((p) => p.slice(1, -1)).join(""));
      }
    }
  }
  
  return texts.join(" ").replace(/\\n/g, "\n").replace(/\\r/g, "").trim();
}

/** Extract text from DOCX (ZIP containing XML) */
async function extractDocxText(file: File): Promise<string> {
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const docXml = await zip.file("word/document.xml")?.async("text");
    if (!docXml) return "[Documento DOCX vazio]";
    
    return docXml
      .replace(/<w:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .trim();
  } catch {
    return "[Erro ao processar DOCX]";
  }
}

/** Basic attempt to extract readable text from binary .doc */
async function extractBinaryDocText(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    let current = "";
    for (const byte of bytes) {
      if (byte >= 32 && byte <= 126) {
        current += String.fromCharCode(byte);
      } else {
        if (current.length > 5) chunks.push(current);
        current = "";
      }
    }
    if (current.length > 5) chunks.push(current);
    return chunks.join(" ").trim() || "[Não foi possível extrair texto deste .doc]";
  } catch {
    return "[Erro ao processar .doc]";
  }
}
