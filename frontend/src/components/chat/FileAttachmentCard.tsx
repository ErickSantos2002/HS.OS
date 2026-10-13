import { downloadAttachment, FileAttachmentMeta, formatFileSize, getFileTypeIcon } from "@/lib/file-upload";
import { FileText, File as FileIcon, FileSpreadsheet, FileImage, FileAudio, FileVideo, Archive, FileCode, Download } from "lucide-react";
import { toast } from "sonner";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  doc: FileText,
  text: FileCode,
  xls: FileSpreadsheet,
  ppt: FileText,
  image: FileImage,
  audio: FileAudio,
  video: FileVideo,
  zip: Archive,
  file: FileIcon,
};

interface FileAttachmentCardProps extends FileAttachmentMeta {
  onPreview?: (attachment: FileAttachmentMeta) => void;
  /** Anexo privado: URL fresca no clique (a do render vence em 5 min). */
  urlAgora?: () => Promise<string>;
}

export default function FileAttachmentCard({ name, url, size, mimeType, onPreview, urlAgora }: FileAttachmentCardProps) {
  const iconType = getFileTypeIcon(name, mimeType);
  const Icon = ICON_MAP[iconType] ?? FileIcon;
  const attachment = { name, url, size, mimeType };

  return (
    <div className="mt-1.5 flex max-w-[320px] items-center gap-2 rounded-lg border border-border/30 bg-secondary/50 px-2 py-2 transition-colors group hover:bg-secondary/70">
      <button
        type="button"
        onClick={async () => {
          let atual = url;
          try {
            if (urlAgora) atual = await urlAgora();
          } catch {
            toast.error("Não foi possível abrir este arquivo.");
            return;
          }
          if (onPreview) {
            onPreview({ ...attachment, url: atual });
            return;
          }

          window.open(atual, "_blank", "noopener,noreferrer");
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{name}</p>
          {size != null && <p className="text-[10px] text-muted-foreground">{formatFileSize(size)}</p>}
        </div>
      </button>

      <button
        type="button"
        onClick={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            await downloadAttachment(urlAgora ? { ...attachment, url: await urlAgora() } : attachment);
          } catch (err: any) {
            toast.error(err?.message || "Não foi possível baixar este arquivo.");
          }
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
        aria-label={`Baixar ${name}`}
        title="Baixar arquivo"
      >
        <Download className="h-3.5 w-3.5 opacity-70 transition-opacity group-hover:opacity-100" />
      </button>
    </div>
  );
}
