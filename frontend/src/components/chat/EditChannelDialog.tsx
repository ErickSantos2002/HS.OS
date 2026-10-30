import { api } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { Channel, useChannelMembers } from "@/hooks/use-channels";
import { usePeople } from "@/hooks/use-people";
import QuemEscreve from "./QuemEscreve";
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
  const canManage = role === "administrador" || user?.id === channel.created_by;
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description ?? "");
  const [isPrivate, setIsPrivate] = useState(channel.type === "private");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Canal de avisos: só o administrador mexe. A lista nasce do `pode_escrever`
  // de cada membro e é mandada inteira ao salvar — quem não vier deixa de escrever.
  const souAdmin = role === "administrador";
  const membros = useChannelMembers(open && souAdmin ? channel.id : null);
  const { people } = usePeople();
  const [soAlguns, setSoAlguns] = useState(!!channel.so_alguns_escrevem);
  const [escritores, setEscritores] = useState<string[] | null>(null);
  useEffect(() => {
    if (escritores === null && membros.length > 0) {
      setEscritores(membros.filter((m) => m.pode_escrever).map((m) => m.user_id));
    }
  }, [membros, escritores]);
  const candidatos = useMemo(() => {
    const nomes = new Map(people.map((p) => [p.id, p]));
    return membros
      .filter((m) => m.member_type === "human" && nomes.has(m.user_id))
      .map((m) => {
        const p = nomes.get(m.user_id)!;
        return { id: m.user_id, nome: p.full_name || p.email, avatar_url: p.avatar_url };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [membros, people]);
  const alternarEscritor = (id: string) =>
    setEscritores((prev) => (prev ?? []).includes(id) ? (prev ?? []).filter((x) => x !== id) : [...(prev ?? []), id]);

  if (!canManage) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    let error: unknown = null;
    try {
      await api(`/channels/${channel.id}`, {
        method: "PATCH",
        body: {
          name: name.trim(),
          description: description.trim() || null,
          type: isPrivate ? "private" : "public",
          ...(souAdmin && channel.type !== "dm"
            ? { so_alguns_escrevem: soAlguns, ...(escritores !== null ? { escritores: soAlguns ? escritores : [] } : {}) }
            : {}),
        },
      });
    } catch (e) {
      error = e;
    }
    setSaving(false);
    if (error) {
      // A recusa do backend diz o porquê (quem não é membro, quem não é admin).
      toast.error(error instanceof Error ? error.message : "Erro ao salvar canal");
      console.error(error);
    } else {
      toast.success("Canal atualizado");
      onUpdated();
      onClose();
    }
  };

  const handleDelete = async () => {
    let error: unknown = null;
    try {
      await api(`/channels/${channel.id}`, { method: "DELETE" });
    } catch (e) {
      error = e;
    }
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

          {souAdmin && channel.type !== "dm" && (
            <QuemEscreve
              ativo={soAlguns}
              onAtivo={setSoAlguns}
              candidatos={candidatos}
              escolhidos={escritores ?? []}
              onAlternar={alternarEscritor}
            />
          )}

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
