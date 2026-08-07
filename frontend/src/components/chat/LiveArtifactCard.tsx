import { api } from "@/lib/api";
import { Zap, ExternalLink, Pause, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface LiveArtifactCardProps {
  artifactId: string;
  title: string;
  refreshInterval: number;
  onOpen?: (id: string) => void;
}

function formatInterval(seconds: number): string {
  if (!seconds || seconds <= 0) return "manual";
  if (seconds < 60) return `${seconds}s`;
  if (seconds % 60 === 0) return `${seconds / 60}min`;
  return `${seconds}s`;
}

export default function LiveArtifactCard({
  artifactId,
  title,
  refreshInterval,
  onOpen,
}: LiveArtifactCardProps) {
  const [interval, setInterval] = useState(refreshInterval);
  const [freezing, setFreezing] = useState(false);
  const isLive = interval > 0;

  const handleOpen = () => {
    if (onOpen) {
      onOpen(artifactId);
      return;
    }
    // Fallback: same-tab navigation to the gallery viewer.
    window.location.assign(`/artefatos/${artifactId}`);
  };

  const makeStatic = async () => {
    setFreezing(true);
    let error: unknown = null;
    try {
      await api(`/artefatos/${artifactId}`, {
        method: "PATCH",
        body: { refresh_interval: 0 },
      });
    } catch (e) {
      error = e;
    }
    setFreezing(false);
    if (error) {
      toast.error("Não foi possível pausar o artefato.");
      return;
    }
    setInterval(0);
    toast.success("Artefato pausado (agora é estático).");
  };

  const copyPublicLink = () => {
    const url = `${window.location.origin}/artefatos/${artifactId}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  };

  return (
    <div className="mt-2 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card/60 to-accent/5 backdrop-blur-xl px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{title}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              {isLive ? (
                <>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="uppercase tracking-wide text-emerald-500 font-semibold">
                    Ao vivo
                  </span>
                  <span className="opacity-60">·</span>
                  <span>Atualiza a cada {formatInterval(interval)}</span>
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3" />
                  <span>Estático</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={handleOpen}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir
        </button>
        {isLive && (
          <button
            onClick={makeStatic}
            disabled={freezing}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Pause className="h-3.5 w-3.5" />
            Tornar estático
          </button>
        )}
        <button
          onClick={copyPublicLink}
          className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Link2 className="h-3.5 w-3.5" />
          Copiar link
        </button>
      </div>
    </div>
  );
}
