import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Code, Eye, Copy, Check, Maximize2, Minimize2, X, Download, ChevronDown, Link2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ArtifactType, buildArtifactHtml } from "@/lib/artifact-extractor";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { exportArtifactAsPdf, exportArtifactAsDocx } from "@/lib/artifact-export";
import { toast } from "sonner";
import PublishArtifactDialog from "./PublishArtifactDialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";

type Tab = "preview" | "code";

const LIVE_INTERVALS: Array<{ label: string; value: number }> = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1min", value: 60 },
  { label: "5min", value: 300 },
  { label: "Manual", value: 0 },
];


interface ArtifactPanelProps {
  type: ArtifactType;
  code: string;
  onClose: () => void;
  className?: string;
}

export default function ArtifactPanel({ type, code, onClose, className }: ArtifactPanelProps) {
  const [tab, setTab] = useState<Tab>("preview");
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullscreenIframeRef = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => buildArtifactHtml(type, code), [type, code]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  const langLabel = type === "react" ? "React" : type.toUpperCase();

  const handleExportPdf = useCallback(async () => {
    setExporting("pdf");
    try {
      await exportArtifactAsPdf(srcDoc, `artifact-${Date.now()}`);
      toast.success("PDF exportado!");
    } catch (e: any) {
      toast.error("Erro ao exportar PDF: " + (e?.message || "desconhecido"));
    } finally {
      setExporting(null);
    }
  }, [srcDoc]);

  const handleExportDocx = useCallback(async () => {
    setExporting("docx");
    try {
      await exportArtifactAsDocx(code, `artifact-${Date.now()}`);
      toast.success("DOCX exportado!");
    } catch (e: any) {
      toast.error("Erro ao exportar DOCX: " + (e?.message || "desconhecido"));
    } finally {
      setExporting(null);
    }
  }, [code]);

  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveInterval, setLiveInterval] = useState(30);
  const [liveTitle, setLiveTitle] = useState("");
  const [liveSaving, setLiveSaving] = useState(false);
  const { user } = useAuthContext();

  const handleMakeLive = useCallback(async () => {
    if (!user) {
      toast.error("Você precisa estar autenticado.");
      return;
    }
    setLiveSaving(true);
    const title = (liveTitle.trim() || "Artefato vivo").slice(0, 120);
    const { data, error } = await supabase
      .from("live_artifacts" as any)
      .insert({
        user_id: user.id,
        title,
        html_content: srcDoc,
        refresh_interval: liveInterval,
      } as any)
      .select("id")
      .single();
    setLiveSaving(false);
    if (error || !data) {
      toast.error("Não foi possível ativar o modo vivo.");
      return;
    }
    setLiveOpen(false);
    toast.success("Artefato vivo criado.");
    window.open(`/artefatos/${(data as any).id}`, "_blank", "noopener");
  }, [user, liveTitle, liveInterval, srcDoc]);


  // Close dropdown on outside click
  useEffect(() => {
    if (!downloadOpen) return;
    const handler = (e: MouseEvent) => {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [downloadOpen]);

  const downloadButton = (
    <div className="relative" ref={downloadRef}>
      <button
        onClick={() => setDownloadOpen((v) => !v)}
        disabled={exporting !== null}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {exporting ? "…" : "Baixar"}
        <ChevronDown className="h-3 w-3" />
      </button>
      {downloadOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl shadow-lg py-1">
          <button
            onClick={() => { setDownloadOpen(false); handleExportPdf(); }}
            disabled={exporting !== null}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            PDF
          </button>
          <button
            onClick={() => { setDownloadOpen(false); handleExportDocx(); }}
            disabled={exporting !== null}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
            DOCX
          </button>
        </div>
      )}
    </div>
  );

  const previewContent = (isFullscreen = false) => (
    <iframe
      ref={isFullscreen ? fullscreenIframeRef : iframeRef}
      srcDoc={srcDoc}
      title="Artifact preview"
      className="w-full h-full border-0 bg-[#0a0a0a]"
      sandbox="allow-scripts allow-downloads"
    />
  );

  const codeContent = (
    <pre className="overflow-auto p-4 text-sm leading-relaxed bg-[hsl(var(--card))]/60 text-foreground h-full">
      <code className="break-words [overflow-wrap:anywhere]">{code}</code>
    </pre>
  );

  return (
    <>
      <div className={cn("flex flex-col h-full border-l border-border/30 bg-card/70 backdrop-blur-xl", className)}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/30 bg-gradient-to-r from-primary/8 via-card/80 to-accent/8 backdrop-blur-xl px-4 py-2 shrink-0 overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setTab("preview")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                tab === "preview" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Eye className="h-3.5 w-3.5" /> Preview
            </button>
            <button
              onClick={() => setTab("code")}
              className={cn(
                "flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                tab === "code" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Code className="h-3.5 w-3.5" /> Código
            </button>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 mr-1">
              {langLabel}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copiado" : "Copiar"}
            </button>
            {downloadButton}
            <button
              onClick={() => { setLiveTitle(""); setLiveInterval(30); setLiveOpen(true); }}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-primary transition-colors hover:bg-muted"
              title="Ativar atualização automática com dados reais"
            >
              <Zap className="h-3.5 w-3.5" />
              Tornar vivo
            </button>
            <button
              onClick={() => setPublishOpen(true)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors hover:bg-muted"
            >
              <Link2 className="h-3.5 w-3.5" />
              Publicar
            </button>

            <button
              onClick={() => setFullscreen(true)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors hover:bg-muted"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground transition-colors hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          {tab === "preview" ? previewContent(false) : codeContent}
        </div>
      </div>

      {/* Fullscreen dialog */}
      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-[92vw] w-[92vw] h-[88vh] !grid-rows-[1fr] p-0 gap-0 bg-card border-border [&>button]:hidden [&>.relative]:h-full [&>.relative]:flex [&>.relative]:flex-col">
          <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-4 py-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTab("preview")}
                className={cn(
                  "flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                  tab === "preview" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
              <button
                onClick={() => setTab("code")}
                className={cn(
                  "flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                  tab === "code" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Code className="h-3.5 w-3.5" /> Código
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 mr-1">{langLabel}</span>
              <button onClick={handleCopy} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors hover:bg-muted">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar"}
              </button>
              {downloadButton}
              <button onClick={() => setFullscreen(false)} className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors hover:bg-muted">
                <Minimize2 className="h-3.5 w-3.5" /> Fechar
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {tab === "preview" ? previewContent(true) : codeContent}
          </div>
        </DialogContent>
      </Dialog>

      <PublishArtifactDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        htmlContent={srcDoc}
      />

      <Dialog open={liveOpen} onOpenChange={setLiveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Tornar vivo
            </DialogTitle>
            <DialogDescription>
              Ativa atualização automática para este artefato. Ele passa a rodar
              em uma página dedicada e pode consultar dados internos e integrações.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Título</label>
              <input
                value={liveTitle}
                onChange={(e) => setLiveTitle(e.target.value)}
                placeholder="Artefato vivo"
                className="mt-1 w-full rounded-md border border-border/50 bg-card/60 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Intervalo de atualização</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {LIVE_INTERVALS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setLiveInterval(opt.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium border transition-colors",
                      liveInterval === opt.value
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setLiveOpen(false)}
                className="rounded-md border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleMakeLive}
                disabled={liveSaving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Zap className="h-3.5 w-3.5" />
                {liveSaving ? "Ativando…" : "Ativar"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
