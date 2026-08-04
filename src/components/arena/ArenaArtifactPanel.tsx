import { useState, useRef } from "react";
import { X, Download, ChevronDown, FileText, FileIcon } from "lucide-react";
import { buildArtifactHtml, type ArtifactType } from "@/lib/artifact-extractor";
import { exportArtifactAsPdf, exportArtifactAsDocx } from "@/lib/artifact-export";
import { toast } from "sonner";

interface Props {
  type: ArtifactType;
  code: string;
  title: string;
  onClose: () => void;
}

export default function ArenaArtifactPanel({ type, code, title, onClose }: Props) {
  const [showDownload, setShowDownload] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const html = buildArtifactHtml(type, code);

  const handlePdf = async () => {
    setShowDownload(false);
    toast.info("Gerando PDF...");
    await exportArtifactAsPdf(html, title);
    toast.success("PDF baixado!");
  };

  const handleDocx = async () => {
    setShowDownload(false);
    toast.info("Gerando DOCX...");
    await exportArtifactAsDocx(code, title);
    toast.success("DOCX baixado!");
  };

  return (
    <div className="flex flex-col h-full border-l border-border/40 bg-background">
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/40 overflow-x-auto">
        <h3 className="text-xs font-semibold text-foreground truncate max-w-[120px]" title={title}>
          {title}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          <div className="relative">
            <button
              onClick={() => setShowDownload(!showDownload)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
            >
              <Download className="h-3 w-3" />
              <span>Baixar</span>
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
            {showDownload && (
              <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg py-1 z-50 min-w-[120px]">
                <button onClick={handlePdf} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50">
                  <FileText className="h-3 w-3 text-destructive" /> PDF
                </button>
                <button onClick={handleDocx} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-secondary/50">
                  <FileIcon className="h-3 w-3 text-primary" /> DOCX
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          srcDoc={html}
          title={title}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-downloads"
        />
      </div>
    </div>
  );
}
