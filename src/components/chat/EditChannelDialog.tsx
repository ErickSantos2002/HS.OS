import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";
import { Channel } from "@/hooks/use-channels";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface Props {
  channel: Channel;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
}

export default function EditChannelDialog({ channel, open, onClose, onUpdated, onDeleted }: Props) {
  const { user, role } = useAuthContext();
  const canManage = role === "super_admin" || user?.id === channel.created_by;
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? "");
  const [isPrivate, setIsPrivate] = useState(channel.type === "private");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!canManage) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const { error } = await supabase
      .from("channels")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        type: isPrivate ? "private" : "public",
      } as any)
      .eq("id", channel.id);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar canal");
      console.error(error);
    } else {
      toast.success("Canal atualizado");
      onUpdated();
      onClose();
    }
  };

  const handleDelete = async () => {
    const { error } = await supabase.from("channels").delete().eq("id", channel.id);
    if (error) {
      toast.error("Erro ao excluir canal");
      console.error(error);
    } else {
      toast.success("Canal excluído");
      onDeleted();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-h-[85vh] overflow-y-auto p-0 gap-0 rounded-2xl sm:max-w-md">
        <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
          <DialogTitle className="font-display text-lg font-bold text-foreground">Editar canal</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 p-6">
          {/* Nome */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome do canal</Label>
            <div className="glass-input px-3 py-0">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-10 text-sm"
              />
            </div>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descrição</Label>
            <div className="rounded-2xl border border-border/30 bg-secondary/20 backdrop-blur-md px-3 py-1">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm resize-none"
              />
            </div>
          </div>

          {/* Canal privado */}
          <div className="flex items-center justify-between rounded-xl border border-border/30 bg-secondary/20 backdrop-blur-md px-4 py-3">
            <Label className="text-sm text-foreground">Canal privado</Label>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>

          {/* Salvar */}
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar alterações"
            )}
          </button>

          {/* Excluir */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full py-3 rounded-full border border-destructive/30 bg-destructive/10 text-destructive font-display font-bold text-sm transition-all hover:bg-destructive/20 hover:border-destructive/50 backdrop-blur-md"
            >
              Excluir canal
            </button>
          ) : (
            <button
              onClick={handleDelete}
              className="w-full py-3 rounded-full bg-destructive text-destructive-foreground font-display font-bold text-sm transition-all hover:opacity-90 shadow-lg shadow-destructive/20"
            >
              Confirmar exclusão
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
