import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Download, FileText, Loader2 } from "lucide-react";

import PdfAttachmentPreview from "@/components/chat/PdfAttachmentPreview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { downloadAttachment, FileAttachmentMeta, formatFileSize, getFilePreviewKind } from "@/lib/file-upload";

interface FileAttachmentPreviewDialogProps {
  attachment: FileAttachmentMeta | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function FileAttachmentPreviewDialog({ attachment, open, onOpenChange }: FileAttachmentPreviewDialogProps) {
  const [textContent, setTextContent] = useState<string>("");
  const [isLoadingText, setIsLoadingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  const previewKind = useMemo(
    () => (attachment ? getFilePreviewKind(attachment.name, attachment.mimeType) : "unsupported"),
    [attachment],
  );

  useEffect(() => {
    if (!open || !attachment || previewKind !== "text") {
      setTextContent("");
      setIsLoadingText(false);
      setTextError(null);
      return;
    }

    const controller = new AbortController();

    const loadTextPreview = async () => {
      try {
        setIsLoadingText(true);
        setTextError(null);
        const response = await fetch(attachment.url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Não foi possível carregar a pré-visualização.");
        }

        const content = await response.text();
        setTextContent(content);
      } catch (error) {
        if (controller.signal.aborted) return;
        setTextError(error instanceof Error ? error.message : "Não foi possível carregar a pré-visualização.");
      } finally {
        if (!controller.signal.aborted) setIsLoadingText(false);
      }
    };

    void loadTextPreview();

    return () => controller.abort();
  }, [attachment, open, previewKind]);

  if (!attachment) return null;

  const handleDownload = async () => {
    await downloadAttachment(attachment);
  };

  const renderPreview = () => {
    switch (previewKind) {
      case "pdf":
        return <PdfAttachmentPreview attachment={attachment} open={open} />;
      case "audio":
        return (
          <div className="flex h-[40vh] items-center justify-center rounded-xl border border-border bg-muted/30 p-6">
            <audio controls preload="metadata" className="w-full max-w-2xl">
              <source src={attachment.url} type={attachment.mimeType} />
            </audio>
          </div>
        );
      case "video":
        return (
          <div className="overflow-hidden rounded-xl border border-border bg-black/90">
            <video controls preload="metadata" className="max-h-[68vh] w-full" src={attachment.url} />
          </div>
        );
      case "text":
        if (isLoadingText) {
          return (
            <div className="flex h-[50vh] items-center justify-center gap-2 rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando pré-visualização...
            </div>
          );
        }

        if (textError) {
          return (
            <div className="flex h-[50vh] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center text-sm text-muted-foreground">
              {textError}
            </div>
          );
        }

        return (
          <ScrollArea className="h-[68vh] rounded-xl border border-border bg-muted/20">
            <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-6 text-foreground">{textContent}</pre>
          </ScrollArea>
        );
      case "office":
        return (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileText className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground">Pré-visualização limitada</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Este formato não possui visualização confiável dentro do chat. Você ainda pode abrir em nova aba ou baixar o arquivo.
              </p>
            </div>
          </div>
        );
      default:
        return (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
              <FileText className="h-7 w-7" />
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-foreground">Arquivo pronto para download</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Este tipo de arquivo não pode ser exibido aqui, mas você pode baixá-lo ou tentar abrir em uma nova aba.
              </p>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] max-w-5xl gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-border px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{attachment.name}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {attachment.size != null ? <span>{formatFileSize(attachment.size)}</span> : null}
                {attachment.mimeType ? <span>{attachment.mimeType}</span> : null}
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Abrir
                </a>
              </Button>
              <Button variant="default" size="sm" onClick={() => void handleDownload()}>
                <Download className="h-4 w-4" />
                Baixar
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="bg-background px-6 py-5">{renderPreview()}</div>
      </DialogContent>
    </Dialog>
  );
}