import { useState } from "react";
import { FileText, FileIcon, Download, Loader2, AlertCircle } from "lucide-react";
import { api, baixarComToken } from "@/lib/api";
import { toast } from "sonner";
import { formatFileSize } from "@/lib/file-upload";

interface Props {
  documentId: string | null;
  title: string;
  docType: "pdf" | "docx";
  sizeBytes?: number;
  status: "pending" | "ready" | "error";
  errorMessage?: string;
}

export default function GeneratedDocumentCard({
  documentId,
  title,
  docType,
  sizeBytes,
  status,
  errorMessage,
}: Props) {
  const [downloading, setDownloading] = useState(false);
  const Icon = docType === "pdf" ? FileText : FileIcon;
  const iconColor = docType === "pdf" ? "text-destructive" : "text-primary";

  const handleDownload = async () => {
    if (!documentId) return;
    setDownloading(true);
    try {
      // Não há mais URL assinada: o bucket é privado e servido com token.
      // Por isso o download passa pelo `baixarComToken` em vez de um href.
      const { url } = await api<{ url: string }>(
        `/storage/documento/${encodeURIComponent(documentId)}`,
      );
      await baixarComToken(url, `${title}.${docType}`);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível baixar o documento.");
    } finally {
      setDownloading(false);
    }
  };

  const clickable = status === "ready" && !downloading && !!documentId;

  return (
    <button
      type="button"
      onClick={clickable ? handleDownload : undefined}
      disabled={!clickable}
      aria-label={`Baixar ${title}`}
      title={clickable ? "Baixar" : undefined}
      className="mt-1.5 flex w-full max-w-[360px] items-center gap-2 rounded-lg border border-border/30 bg-secondary/50 px-2 py-2 text-left transition-colors enabled:hover:bg-secondary/80 enabled:cursor-pointer disabled:cursor-default"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        {status === "pending" ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : status === "error" ? (
          <AlertCircle className="h-4 w-4 text-destructive" />
        ) : (
          <Icon className={`h-4.5 w-4.5 ${iconColor}`} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">
          {title}
          <span className="ml-1.5 text-[10px] uppercase text-muted-foreground">
            {docType}
          </span>
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {status === "pending" && "Gerando…"}
          {status === "error" && (errorMessage || "Falha ao gerar")}
          {status === "ready" && sizeBytes != null && formatFileSize(sizeBytes)}
        </p>
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground">
        {downloading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
      </div>
    </button>
  );
}

