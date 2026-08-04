import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, Download, ExternalLink, Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerUrl from "react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url";
import { downloadUrl, openPreview } from "./mediaActions";

// Worker fallback: try local bundled worker first; if it fails (e.g. blocked / 504),
// react-pdf will surface the error and we swap to a version-matched CDN.
const CDN_WORKER_URL = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
let workerFallbackUsed = false;
function swapToCdnWorker() {
  if (workerFallbackUsed) return false;
  workerFallbackUsed = true;
  pdfjs.GlobalWorkerOptions.workerSrc = CDN_WORKER_URL;
  return true;
}

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html", htm: "text/html", svg: "image/svg+xml",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
  json: "application/json", xml: "application/xml",
  yaml: "text/yaml", yml: "text/yaml", csv: "text/csv",
  js: "text/javascript", css: "text/css",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", webm: "video/webm",
  mp3: "audio/mpeg", wav: "audio/wav",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const OFFICE_EXTS = new Set(["doc", "xls", "xlsx", "ppt", "pptx"]);

function extOf(s: string) {
  return (s.split("?")[0].split("#")[0].split(".").pop() || "").toLowerCase();
}

interface Props {
  url: string;
  name: string;
  onClose: () => void;
}

function LoadingLabel({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function PreviewModal({ url, name, onClose }: Props) {
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pdfReloadKey, setPdfReloadKey] = useState(0);
  const ext = extOf(name) || extOf(url);
  const mime = MIME_BY_EXT[ext] || "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isPdf = ext === "pdf";
  const isDocx = ext === "docx";
  const isOffice = OFFICE_EXTS.has(ext);

  const pdfWidth = useMemo(() => {
    if (!previewWidth) return undefined;
    return Math.max(300, Math.min(980, previewWidth - 48));
  }, [previewWidth]);

  // Stream PDFs directly via react-pdf (worker handles ranged fetch — fast like a browser).
  // Only buffer-fetch for DOCX (mammoth) and generic blobs (image/video/audio/iframe fallback).
  useEffect(() => {
    if (isOffice || isPdf) return;
    let cancelled = false;
    let created: string | null = null;
    (async () => {
      try {
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (isDocx) {
          const mammoth = await import("mammoth");
          const DOMPurify = (await import("dompurify")).default;
          const result = await mammoth.convertToHtml({ arrayBuffer: buf });
          const safe = DOMPurify.sanitize(result.value || "<p>Documento sem conteúdo renderizável.</p>", {
            FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
            FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
          });
          if (!cancelled) setDocxHtml(safe);
          return;
        }
        const blob = new Blob([buf], { type: mime || "application/octet-stream" });
        created = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(created);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      if (created) setTimeout(() => URL.revokeObjectURL(created!), 1000);
    };
  }, [url, mime, isOffice, isPdf, isDocx]);

  useEffect(() => {
    const element = previewRef.current;
    if (!element) return;
    const update = () => setPreviewWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const src = blobUrl || url;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl h-[90vh] bg-background rounded-lg shadow-2xl flex flex-col overflow-hidden border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-card">
          <div className="truncate text-sm font-semibold text-foreground">{name}</div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => downloadUrl(url, name)}
              className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Baixar"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openPreview(url, name)}
              className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Abrir em nova aba"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Fechar (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div ref={previewRef} className="flex-1 bg-muted/30 overflow-auto flex items-center justify-center">
          {error ? (
            <div className="text-sm text-destructive p-6 text-center">
              Não foi possível carregar o arquivo: {error}
            </div>
          ) : isOffice ? (
            <iframe
              src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`}
              title={name}
              className="w-full h-full bg-white"
            />
          ) : isPdf ? (
            <div className="flex h-full w-full flex-col items-center gap-3 overflow-auto p-4">
              <div className="flex w-full max-w-5xl items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {totalPages ? `Página ${pageNumber} de ${totalPages}` : "Preparando PDF..."}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPageNumber((p) => Math.max(1, p - 1))} disabled={pageNumber <= 1 || !totalPages} className="p-2 rounded hover:bg-muted disabled:opacity-40" title="Página anterior">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setPageNumber((p) => Math.min(totalPages ?? p, p + 1))} disabled={!totalPages || pageNumber >= totalPages} className="p-2 rounded hover:bg-muted disabled:opacity-40" title="Próxima página">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <Document
                key={pdfReloadKey}
                file={url}
                loading={<LoadingLabel label="Carregando PDF..." />}
                error={<div className="p-6 text-center text-sm text-destructive">Não foi possível renderizar este PDF.</div>}
                onLoadSuccess={({ numPages }) => { setTotalPages(numPages); setPageNumber((p) => Math.min(p, numPages)); }}
                onLoadError={(err) => {
                  const msg = err?.message || "PDF inválido";
                  if (/worker/i.test(msg) && swapToCdnWorker()) {
                    setPdfReloadKey((k) => k + 1);
                    return;
                  }
                  setError(msg);
                }}
              >
                <Page pageNumber={pageNumber} width={pdfWidth} renderAnnotationLayer={false} renderTextLayer={false} loading={<LoadingLabel label="Carregando página..." />} />
              </Document>
            </div>
          ) : isDocx ? (
            docxHtml ? (
              <div className="h-full w-full overflow-auto bg-background p-6">
                <article className="mx-auto max-w-4xl rounded border border-border bg-card p-8 text-foreground prose prose-invert prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: docxHtml }} />
              </div>
            ) : (
              <LoadingLabel label="Carregando documento..." />
            )
          ) : !blobUrl ? (
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-xs">Carregando…</span>
            </div>
          ) : isImage ? (
            <img src={src} alt={name} className="max-w-full max-h-full object-contain" />
          ) : isVideo ? (
            <video src={src} controls className="max-w-full max-h-full" />
          ) : isAudio ? (
            <audio src={src} controls />
          ) : (
            <iframe
              src={src}
              title={name}
              className="w-full h-full bg-white"
              sandbox="allow-scripts allow-popups allow-forms"
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
