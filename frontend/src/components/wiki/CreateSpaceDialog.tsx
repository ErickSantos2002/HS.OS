import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useCreateWikiSpace, useUpdateWikiSpace, type WikiSpace } from "@/hooks/use-wiki-spaces";
import { toast } from "@/hooks/use-toast";
import { SPACE_ICON_NAMES, SPACE_ICONS, DEFAULT_SPACE_ICON } from "./SpaceIcon";

const COLORS = [
  "#3D61FF", "#1E40AF", "#0EA5E9", "#06B6D4", "#14B8A6", "#10B981", "#22C55E", "#84CC16",
  "#EAB308", "#F59E0B", "#F97316", "#EF4444", "#E41A11", "#DC2626", "#EC4899", "#DB2777",
  "#A78BFA", "#8B5CF6", "#7C3AED", "#6366F1", "#64748B", "#475569", "#78716C", "#FFFFFF",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
  /** If provided, dialog enters edit mode for this space */
  space?: WikiSpace | null;
  /** If provided (and not editing), create as a sub-space of this parent */
  parentId?: string | null;
}

export function CreateSpaceDialog({ open, onOpenChange, onCreated, space, parentId }: Props) {
  const isEdit = !!space;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [iconQuery, setIconQuery] = useState("");
  const [icon, setIcon] = useState(DEFAULT_SPACE_ICON);
  const [color, setColor] = useState(COLORS[0]);
  const create = useCreateWikiSpace();
  const update = useUpdateWikiSpace();

  const reset = () => {
    setName("");
    setDescription("");
    setIcon(DEFAULT_SPACE_ICON);
    setColor(COLORS[0]);
  };

  // When opening for edit, hydrate fields
  useEffect(() => {
    if (open && space) {
      setName(space.name || "");
      setDescription(space.description || "");
      setIcon(space.icon || DEFAULT_SPACE_ICON);
      setColor(space.color || COLORS[0]);
    } else if (open && !space) {
      reset();
    }
  }, [open, space]);

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      if (isEdit && space) {
        await update.mutateAsync({ id: space.id, name: name.trim(), description, icon, color });
        toast({ title: "Espaço atualizado" });
      } else {
        const created = await create.mutateAsync({ name: name.trim(), description, icon, color, parent_id: parentId ?? null });
        toast({ title: "Espaço criado" });
        onCreated?.(created.id);
      }
      onOpenChange(false);
      if (!isEdit) reset();
    } catch (e) {
      toast({
        title: isEdit ? "Erro ao atualizar espaço" : "Erro ao criar espaço",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o && !isEdit) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Espaço" : "Novo Espaço"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Atualize as informações do espaço." : "Crie um espaço para organizar seus documentos."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Processos internos" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Ícone</Label>
              <Input
                value={iconQuery}
                onChange={(e) => setIconQuery(e.target.value)}
                placeholder="Buscar ícone..."
                className="h-7 max-w-[180px] text-xs"
              />
            </div>
            <div className="grid grid-cols-10 gap-1.5 max-h-56 overflow-y-auto rounded-md border border-border bg-background/40 p-2">
              {(() => {
                const q = iconQuery.trim().toLowerCase();
                const filtered = q ? SPACE_ICON_NAMES.filter((n) => n.toLowerCase().includes(q)) : SPACE_ICON_NAMES;
                if (filtered.length === 0) {
                  return <div className="col-span-10 py-4 text-center text-xs text-muted-foreground">Nenhum ícone encontrado</div>;
                }
                return filtered.map((n) => {
                  const Icon = SPACE_ICONS[n];
                  const active = icon === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setIcon(n)}
                      title={n}
                      className={`grid h-8 w-8 place-items-center rounded-md border transition ${active ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                });
              })()}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  title={c}
                  className={`h-7 w-7 rounded-full ring-offset-background transition ${color === c ? "ring-2 ring-offset-2 ring-foreground" : "hover:scale-110"}`}
                />
              ))}
              <label
                title="Cor personalizada"
                className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground"
                style={{ background: `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)` }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <span className="ml-1 text-xs text-muted-foreground font-mono">{color}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!name.trim() || pending} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {pending ? "Salvando..." : isEdit ? "Salvar" : "Criar Espaço"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
