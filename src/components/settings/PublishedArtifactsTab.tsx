import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";
import { Link2, Copy, Eye, Trash2, Loader2, Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface PublishedArtifact {
  id: string;
  title: string | null;
  is_public: boolean;
  views: number;
  created_at: string;
  expires_at: string | null;
}

export default function PublishedArtifactsTab() {
  const { user } = useAuthContext();
  const [artifacts, setArtifacts] = useState<PublishedArtifact[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArtifacts = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("artifacts_published" as any)
      .select("id, title, is_public, views, created_at, expires_at")
      .eq("created_by", user.id)
      .order("created_at", { ascending: false });
    setArtifacts((data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchArtifacts(); }, [user]);

  const copyLink = (id: string) => {
    const url = `${window.location.origin}/artifact/${id}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado!");
  };

  const togglePublic = async (id: string, current: boolean) => {
    await supabase
      .from("artifacts_published" as any)
      .update({ is_public: !current } as any)
      .eq("id", id);
    setArtifacts((prev) => prev.map((a) => a.id === id ? { ...a, is_public: !current } : a));
    toast.success(!current ? "Artefato tornado público" : "Artefato tornado privado");
  };

  const deleteArtifact = async (id: string) => {
    await supabase.from("artifacts_published" as any).delete().eq("id", id);
    setArtifacts((prev) => prev.filter((a) => a.id !== id));
    toast.success("Artefato removido");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (artifacts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        <Link2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p>Nenhum artefato publicado ainda.</p>
        <p className="text-xs mt-1">Publique artefatos pelo painel de preview no chat.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {artifacts.map((a) => {
        const expired = a.expires_at && new Date(a.expires_at) < new Date();
        return (
          <div
            key={a.id}
            className={`flex items-center justify-between rounded-xl border border-border/30 bg-card/60 px-4 py-3 ${expired ? "opacity-50" : ""}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {a.is_public ? <Globe className="h-3.5 w-3.5 text-primary shrink-0" /> : <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <span className="text-sm font-medium truncate">{a.title || "Sem título"}</span>
                {expired && <span className="text-[10px] text-destructive font-medium">EXPIRADO</span>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span>{format(new Date(a.created_at), "dd/MM/yyyy")}</span>
                <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{a.views}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => copyLink(a.id)}
                className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Copiar link"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={() => togglePublic(a.id, a.is_public)}
                className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={a.is_public ? "Tornar privado" : "Tornar público"}
              >
                {a.is_public ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
              </button>
              <button
                onClick={() => deleteArtifact(a.id)}
                className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Remover"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
