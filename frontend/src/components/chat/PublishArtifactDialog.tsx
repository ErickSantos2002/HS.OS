import { api } from "@/lib/api";
import { useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Lock, Link2, Loader2, CheckCircle2, Copy, Check } from "lucide-react";
import { useAuthContext } from "@/contexts/auth-context";
import { toast } from "sonner";
import { copyToClipboard } from "@/lib/clipboard";

interface PublishArtifactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  htmlContent: string;
}

export default function PublishArtifactDialog({ open, onOpenChange, htmlContent }: PublishArtifactDialogProps) {
  const { user } = useAuthContext();
  const [title, setTitle] = useState("Artefato sem título");
  const [isPublic, setIsPublic] = useState(true);
  const [expiration, setExpiration] = useState<"never" | "7" | "30">("never");
  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  // Check if this artifact was already published when dialog opens
  useEffect(() => {
    if (!open || !user || !htmlContent) return;
    let cancelled = false;

    const checkExisting = async () => {
      setChecking(true);
      try {
        const data = await api<{ id: string; title?: string } | null>(
          "/artefatos/publicados/procurar",
          { method: "POST", body: { html_content: htmlContent } },
        ).catch(() => null);

        if (!cancelled && data) {
          const rec = data as any;
          const url = `${window.location.origin}/artifact/${rec.id}`;
          setPublishedUrl(url);
          if (rec.title) setTitle(rec.title);
        }
      } catch {
        // ignore — just show the form
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    checkExisting();
    return () => { cancelled = true; };
  }, [open, user, htmlContent]);

  const handleOpenChange = useCallback((v: boolean) => {
    if (!v) {
      setPublishedUrl(null);
      setUrlCopied(false);
    }
    onOpenChange(v);
  }, [onOpenChange]);

  const handleCopyUrl = useCallback(() => {
    if (!publishedUrl) return;
    void copyToClipboard(publishedUrl).then((ok) => {
      if (ok) {
        setUrlCopied(true);
        toast.success("Link copiado!");
        setTimeout(() => setUrlCopied(false), 2000);
      }
    });
  }, [publishedUrl]);

  const handlePublish = async () => {
    if (!user) return;
    setPublishing(true);
    try {
      const expiresAt = expiration === "never"
        ? null
        : new Date(Date.now() + parseInt(expiration) * 24 * 60 * 60 * 1000).toISOString();

      // O dono sai do token. Republicar o mesmo HTML devolve o link que já
      // existia em vez de criar outro — o backend cuida disso.
      const data = await api<{ id: string }>("/artefatos/publicados", {
        method: "POST",
        body: { title, html_content: htmlContent, is_public: isPublic, expires_at: expiresAt },
      });

      const artifactId = data.id;
      const url = `${window.location.origin}/artifact/${artifactId}`;
      await copyToClipboard(url);
      setPublishedUrl(url);
      toast.success("Artefato publicado! Link copiado.");
    } catch (e: any) {
      toast.error("Erro ao publicar: " + (e?.message || "desconhecido"));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {publishedUrl ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            ) : (
              <Link2 className="h-5 w-5 text-primary" />
            )}
            {publishedUrl ? "Artefato publicado!" : "Publicar Artefato"}
          </DialogTitle>
        </DialogHeader>

        {checking ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : publishedUrl ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Seu artefato está disponível no link abaixo. Clique para copiar.
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={publishedUrl}
                className="text-xs font-mono"
                onClick={handleCopyUrl}
              />
              <Button size="icon" variant="outline" onClick={handleCopyUrl} className="shrink-0">
                {urlCopied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="artifact-title">Título</Label>
              <Input
                id="artifact-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nome do artefato"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/40 p-3">
              <div className="flex items-center gap-2">
                {isPublic ? <Globe className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
                <div>
                  <p className="text-sm font-medium">{isPublic ? "Público" : "Privado"}</p>
                  <p className="text-xs text-muted-foreground">
                    {isPublic ? "Qualquer pessoa com o link" : "Somente usuários logados"}
                  </p>
                </div>
              </div>
              <Switch checked={isPublic} onCheckedChange={setIsPublic} />
            </div>

            <div className="space-y-2">
              <Label>Expiração</Label>
              <Select value={expiration} onValueChange={(v) => setExpiration(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Nunca expira</SelectItem>
                  <SelectItem value="7">7 dias</SelectItem>
                  <SelectItem value="30">30 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {publishedUrl ? (
            <Button variant="outline" onClick={() => handleOpenChange(false)}>Fechar</Button>
          ) : !checking ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
              <Button onClick={handlePublish} disabled={publishing}>
                {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
                Publicar e copiar link
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
