import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";

import { Button } from "@/components/ui/button";
import type { FileAttachmentMeta } from "@/lib/file-upload";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface PdfAttachmentPreviewProps {
  attachment: FileAttachmentMeta;
  open: boolean;
}

export default function PdfAttachmentPreview({ attachment, open }: PdfAttachmentPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    if (!open) {
      setPdfData(null);
      setPdfError(null);
      setIsLoadingPdf(false);
      setTotalPages(null);
      setPageNumber(1);
      return;
    }

    const controller = new AbortController();

    const loadPdfPreview = async () => {
      try {
        setIsLoadingPdf(true);
        setPdfError(null);
        setTotalPages(null);
        setPageNumber(1);

        const response = await fetch(attachment.url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Não foi possível carregar o PDF.");
        }

        const buffer = await response.arrayBuffer();
        setPdfData(new Uint8Array(buffer));
      } catch (error) {
        if (controller.signal.aborted) return;
        setPdfData(null);
        setPdfError(error instanceof Error ? error.message : "Não foi possível carregar o PDF.");
      } finally {
        if (!controller.signal.aborted) setIsLoadingPdf(false);
      }
    };

    void loadPdfPreview();

    return () => controller.abort();
  }, [attachment.url, open]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateWidth = () => {
      setContainerWidth(element.clientWidth);
    };

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const pageWidth = useMemo(() => {
    if (!containerWidth) return undefined;
    return Math.max(280, Math.floor(containerWidth - 32));
  }, [containerWidth]);

  if (isLoadingPdf) {
    return (
      <div className="flex h-[68vh] items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando PDF...
      </div>
    );
  }

  if (pdfError) {
    return (
      <div className="flex h-[68vh] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
          <FileText className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">Não foi possível exibir o PDF aqui</p>
          <p className="max-w-md text-sm text-muted-foreground">{pdfError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-foreground">Pré-visualização do PDF</p>
          <p className="text-xs text-muted-foreground">
            {totalPages ? `Página ${pageNumber} de ${totalPages}` : "Preparando páginas..."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={pageNumber <= 1 || !totalPages}
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPageNumber((current) => Math.min(totalPages ?? current, current + 1))}
            disabled={!totalPages || pageNumber >= totalPages}
          >
            Próxima
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={containerRef} className="flex min-h-[68vh] justify-center overflow-auto rounded-xl border border-border bg-muted/20 p-4">
        {pdfData ? (
          <Document
            file={{ data: pdfData }}
            loading={
              <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Renderizando página...
              </div>
            }
            error={
              <div className="flex h-[60vh] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Não foi possível processar este PDF no modal.
              </div>
            }
            onLoadSuccess={({ numPages }) => {
              setTotalPages(numPages);
              setPageNumber((current) => Math.min(current, numPages));
            }}
            onLoadError={(error) => {
              setPdfError(error.message || "Não foi possível processar este PDF.");
            }}
          >
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              loading={
                <div className="flex h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando página...
                </div>
              }
            />
          </Document>
        ) : (
          <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">Preparando PDF...</div>
        )}
      </div>
    </div>
  );
}