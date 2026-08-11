import { api } from "@/lib/api";
import { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, ExternalLink, Eye } from "lucide-react";
import { useBranding, useThemedLogo } from "@/hooks/use-branding";

export default function PublicArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const { branding } = useBranding();
  const themedLogo = useThemedLogo();

  const [artifact, setArtifact] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      // A validade e a contagem de acesso ficam no servidor: expirado precisa
      // dizer "link expirado", não "não encontrado", e o contador não pode
      // depender do navegador executar um segundo update.
      const data = await api<any>(
        `/artefatos/publicados/${encodeURIComponent(id)}`,
        { autenticar: false },
      ).catch(() => null);

      if (!data) {
        setError("Artefato não encontrado ou link expirado.");
        setLoading(false);
        return;
      }

      const a = data as any;

      // Check expiration
      if (a.expires_at && new Date(a.expires_at) < new Date()) {
        setError("Este artefato expirou.");
        setLoading(false);
        return;
      }

      setArtifact(a);
      setLoading(false);

      // Increment views
    })();
  }, [id]);

  const srcDoc = useMemo(() => artifact?.html_content || "", [artifact]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background gap-4">
        <p className="text-lg text-muted-foreground">{error}</p>
        <Link to="/login" className="text-primary hover:underline text-sm">
          Abrir {branding.companyName || "HS.OS"}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border/30 bg-card/80 backdrop-blur-xl px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-3">
          {themedLogo && (
            <img src={themedLogo} alt="" className="h-6 w-6 rounded" />

          )}
          <div>
            <h1 className="text-sm font-semibold text-foreground truncate max-w-[300px]">
              {artifact.title || "Artefato"}
            </h1>
            <p className="text-[10px] text-muted-foreground">
              Criado por {branding.companyName || "HS.OS"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            {artifact.views || 0}
          </span>
          <Link
            to="/login"
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Abrir {branding.companyName || "HS.OS"}
          </Link>
        </div>
      </header>

      {/* Artifact content */}
      <div className="flex-1 min-h-0">
        <iframe
          srcDoc={srcDoc}
          title={artifact.title || "Artifact"}
          className="w-full h-full border-0 bg-[#0a0a0a]"
          sandbox="allow-scripts allow-downloads"
        />
      </div>
    </div>
  );
}
