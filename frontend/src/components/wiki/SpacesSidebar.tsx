import { useMemo, useState } from "react";
import { Plus, ChevronDown, ChevronRight, FileText, Pin, MoreHorizontal, Trash2, Pencil, FolderPlus, GripVertical, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWikiSpaces, useDeleteWikiSpace, useUpdateWikiSpace, type WikiSpace } from "@/hooks/use-wiki-spaces";
import { useWikiDocuments, useCreateWikiDocument, useDeleteWikiDocument, useUpdateWikiDocument, type WikiDocument } from "@/hooks/use-wiki-documents";
import { SpaceIcon } from "./SpaceIcon";
import { toast } from "sonner";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function shareLink(url: string) {
  copyToClipboard(url).then((ok) => {
    if (ok) {
      toast.success("Link copiado", { description: "Compartilhe com membros logados na plataforma." });
    } else {
      toast.error("Não foi possível copiar", {
        description: url,
        duration: 10000,
      });
    }
  });
}

interface Props {
  selectedSpaceId: string | null;
  selectedDocId: string | null;
  onSelectSpace: (id: string) => void;
  onSelectDoc: (spaceId: string, docId: string) => void;
  onNewSpace: (parentId?: string | null) => void;
  onEditSpace: (space: WikiSpace) => void;
  onDocDeleted?: (docId: string) => void;
  onSpaceDeleted?: (id: string) => void;
}

interface TreeNode {
  space: WikiSpace;
  children: TreeNode[];
}

function buildTree(spaces: WikiSpace[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  spaces.forEach((s) => map.set(s.id, { space: s, children: [] }));
  const roots: TreeNode[] = [];
  spaces.forEach((s) => {
    const node = map.get(s.id)!;
    if (s.parent_id && map.has(s.parent_id)) {
      map.get(s.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.space.order_index ?? 0) - (b.space.order_index ?? 0));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export function SpacesSidebar({
  selectedSpaceId, selectedDocId, onSelectSpace, onSelectDoc, onNewSpace, onEditSpace, onDocDeleted, onSpaceDeleted,
}: Props) {
  const { data: spaces = [], isLoading } = useWikiSpaces();
  const updateSpace = useUpdateWikiSpace();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragOverRoot, setDragOverRoot] = useState(false);

  const tree = useMemo(() => buildTree(spaces), [spaces]);

  const toggle = (id: string) => {
    setExpanded((p) => ({ ...p, [id]: !p[id] }));
    onSelectSpace(id);
  };

  const isDescendant = (ancestorId: string, candidateId: string): boolean => {
    // returns true if candidateId is a descendant of ancestorId
    const children = spaces.filter((s) => s.parent_id === ancestorId);
    for (const c of children) {
      if (c.id === candidateId) return true;
      if (isDescendant(c.id, candidateId)) return true;
    }
    return false;
  };

  const handleDropOn = async (draggedId: string, targetParentId: string | null) => {
    if (!draggedId) return;
    if (draggedId === targetParentId) return;
    if (targetParentId && isDescendant(draggedId, targetParentId)) return; // prevent cycles
    const current = spaces.find((s) => s.id === draggedId);
    if (!current) return;
    if ((current.parent_id ?? null) === targetParentId) return;
    await updateSpace.mutateAsync({ id: draggedId, parent_id: targetParentId });
    if (targetParentId) setExpanded((p) => ({ ...p, [targetParentId]: true }));
  };

  // Reorder: place draggedId before or after targetId at the same level (sibling)
  const handleReorder = async (draggedId: string, targetId: string, position: "before" | "after") => {
    if (!draggedId || draggedId === targetId) return;
    const dragged = spaces.find((s) => s.id === draggedId);
    const target = spaces.find((s) => s.id === targetId);
    if (!dragged || !target) return;
    const newParent = target.parent_id ?? null;
    if (newParent && isDescendant(draggedId, newParent)) return;

    // Build the new sibling order at target's level
    const siblings = spaces
      .filter((s) => (s.parent_id ?? null) === newParent && s.id !== draggedId)
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
    const idx = siblings.findIndex((s) => s.id === targetId);
    const insertAt = position === "before" ? idx : idx + 1;
    siblings.splice(insertAt, 0, dragged);

    // Update parent_id first if changed
    if ((dragged.parent_id ?? null) !== newParent) {
      await updateSpace.mutateAsync({ id: draggedId, parent_id: newParent });
    }
    // Persist order_index sequentially
    await Promise.all(
      siblings.map((s, i) =>
        (s.order_index ?? 0) === i
          ? Promise.resolve()
          : updateSpace.mutateAsync({ id: s.id, order_index: i })
      )
    );
  };


  return (
    <aside className="flex h-full w-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="p-4 border-b border-sidebar-border flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "Rajdhani, sans-serif", letterSpacing: "-0.01em" }}>
          Base de Conhecimento
        </h2>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onNewSpace(null)}
          title="Novo espaço"
          aria-label="Novo espaço"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary hover:bg-primary/10"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div
        className={`flex-1 overflow-y-auto p-2 transition ${dragOverRoot ? "bg-primary/5" : ""}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-wiki-space")) {
            e.preventDefault();
            setDragOverRoot(true);
          }
        }}
        onDragLeave={() => setDragOverRoot(false)}
        onDrop={(e) => {
          setDragOverRoot(false);
          const id = e.dataTransfer.getData("application/x-wiki-space");
          if (id) {
            e.preventDefault();
            handleDropOn(id, null);
          }
        }}
      >
        {isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Carregando...</div>}
        {!isLoading && spaces.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhum espaço ainda
          </div>
        )}
        {tree.map((node) => (
          <SpaceItem
            key={node.space.id}
            node={node}
            depth={0}
            expanded={expanded}
            setExpanded={setExpanded}
            selectedSpaceId={selectedSpaceId}
            selectedDocId={selectedDocId}
            onToggle={toggle}
            onSelectDoc={onSelectDoc}
            onDocDeleted={onDocDeleted}
            onEditSpace={onEditSpace}
            onSpaceDeleted={onSpaceDeleted}
            onNewSubSpace={(parentId) => onNewSpace(parentId)}
            onDropSpace={handleDropOn}
            onReorderSpace={handleReorder}
          />
        ))}
        {tree.length > 0 && (
          <div className="mt-2 px-3 py-1.5 text-[10px] text-muted-foreground/60 italic leading-snug">
            Use a alça <GripVertical className="inline h-2.5 w-2.5" /> para arrastar. Solte no topo/base para reordenar, ou no meio para criar sub-espaço.
          </div>
        )}
      </div>
    </aside>
  );
}

function SpaceItem({
  node, depth, expanded, setExpanded, selectedSpaceId, selectedDocId,
  onToggle, onSelectDoc, onDocDeleted, onEditSpace, onSpaceDeleted, onNewSubSpace, onDropSpace, onReorderSpace,
}: {
  node: TreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  selectedSpaceId: string | null;
  selectedDocId: string | null;
  onToggle: (id: string) => void;
  onSelectDoc: (spaceId: string, docId: string) => void;
  onDocDeleted?: (docId: string) => void;
  onEditSpace: (sp: WikiSpace) => void;
  onSpaceDeleted?: (id: string) => void;
  onNewSubSpace: (parentId: string) => void;
  onDropSpace: (draggedId: string, targetParentId: string | null) => void;
  onReorderSpace: (draggedId: string, targetId: string, position: "before" | "after") => void;
}) {
  const space = node.space;
  const isExpanded = !!expanded[space.id];
  const selected = selectedSpaceId === space.id;
  const { data: docs = [] } = useWikiDocuments(isExpanded ? space.id : null);
  const createDoc = useCreateWikiDocument();
  const deleteDoc = useDeleteWikiDocument();
  const deleteSpace = useDeleteWikiSpace();
  const updateDoc = useUpdateWikiDocument();
  const [confirmDoc, setConfirmDoc] = useState<WikiDocument | null>(null);
  const [confirmSpace, setConfirmSpace] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOver, setDragOver] = useState<null | "before" | "inside" | "after">(null);

  const handleConfirmDeleteSpace = async () => {
    await deleteSpace.mutateAsync(space.id);
    setConfirmSpace(false);
    onSpaceDeleted?.(space.id);
  };

  const handleNewDoc = async () => {
    const doc = await createDoc.mutateAsync(space.id);
    onSelectDoc(space.id, doc.id);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDoc) return;
    const id = confirmDoc.id;
    await deleteDoc.mutateAsync({ id, space_id: confirmDoc.space_id });
    setConfirmDoc(null);
    onDocDeleted?.(id);
  };

  const startRename = (d: WikiDocument) => {
    setRenamingId(d.id);
    setRenameValue(d.title || "");
  };

  const commitRename = async (d: WikiDocument) => {
    const trimmed = renameValue.trim() || "Sem título";
    setRenamingId(null);
    if (trimmed !== d.title) {
      await updateDoc.mutateAsync({ id: d.id, title: trimmed });
    }
  };

  return (
    <div className="mb-1">
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("application/x-wiki-space")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const h = rect.height;
          if (y < h * 0.25) setDragOver("before");
          else if (y > h * 0.75) setDragOver("after");
          else setDragOver("inside");
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("application/x-wiki-space");
          const pos = dragOver;
          setDragOver(null);
          if (!id || id === space.id || !pos) return;
          e.preventDefault();
          e.stopPropagation();
          if (pos === "inside") {
            onDropSpace(id, space.id);
          } else {
            onReorderSpace(id, space.id, pos);
          }
        }}
        className={`group/space relative flex w-full items-center gap-1 rounded-md pr-1 transition ${
          selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60"
        } ${dragOver === "inside" ? "ring-1 ring-primary/60 bg-primary/10" : ""}`}
        style={{
          paddingLeft: `${depth * 12}px`,
          ...(selected ? { borderLeft: "2px solid hsl(var(--primary))" } : {}),
        }}
      >
        {dragOver === "before" && (
          <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-primary" />
        )}
        {dragOver === "after" && (
          <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-primary" />
        )}
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-wiki-space", space.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          title="Arrastar para reordenar ou aninhar"
          className="flex h-7 w-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground/50 opacity-0 transition hover:text-foreground group-hover/space:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
        <button
          onClick={() => onToggle(space.id)}
          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left text-sm"
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <SpaceIcon name={space.icon} className="h-4 w-4 shrink-0" style={{ color: space.color || undefined }} />
          <span className="flex-1 truncate" style={{ color: space.color || undefined }}>
            {space.name}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 opacity-0 transition group-hover/space:opacity-100 data-[state=open]:opacity-100"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onEditSpace(space)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const url = `${window.location.origin}/base-de-conhecimento?space=${space.id}`;
                shareLink(url);
              }}
            >
              <LinkIcon className="mr-2 h-3.5 w-3.5" /> Copiar link compartilhável
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewSubSpace(space.id)}>
              <FolderPlus className="mr-2 h-3.5 w-3.5" /> Novo sub-espaço
            </DropdownMenuItem>
            {space.parent_id && (
              <DropdownMenuItem onSelect={() => onDropSpace(space.id, null)}>
                <ChevronRight className="mr-2 h-3.5 w-3.5 rotate-180" /> Mover para raiz
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setConfirmSpace(true)}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Deletar espaço
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isExpanded && (
        <div className="group/docs ml-4 mt-1 space-y-0.5 border-l border-border pl-2">

          {/* nested sub-spaces */}
          {node.children.map((child) => (
            <SpaceItem
              key={child.space.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              selectedSpaceId={selectedSpaceId}
              selectedDocId={selectedDocId}
              onToggle={onToggle}
              onSelectDoc={onSelectDoc}
              onDocDeleted={onDocDeleted}
              onEditSpace={onEditSpace}
              onSpaceDeleted={onSpaceDeleted}
              onNewSubSpace={onNewSubSpace}
              onDropSpace={onDropSpace}
              onReorderSpace={onReorderSpace}
            />
          ))}



          {docs.length === 0 && node.children.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum documento ainda.</div>
          )}
          {docs.map((d) => (
            <div
              key={d.id}
              className={`group/doc flex w-full items-center gap-1 rounded-md pr-1 text-xs transition ${
                selectedDocId === d.id ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              }`}
            >
              {renamingId === d.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
                  {d.is_pinned ? <Pin className="h-3 w-3 shrink-0 fill-primary text-primary" /> : <FileText className="h-3 w-3 shrink-0" />}
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(d)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitRename(d); }
                      if (e.key === "Escape") { e.preventDefault(); setRenamingId(null); }
                    }}
                    className="min-w-0 flex-1 rounded bg-background px-1 py-0.5 text-xs text-foreground outline-none ring-1 ring-primary/40 focus:ring-primary"
                  />
                </div>
              ) : (
                <button
                  onClick={() => onSelectDoc(space.id, d.id)}
                  onDoubleClick={() => startRename(d)}
                  {/* Documento recorrente tem o que o distingue no FIM do nome,
                      e é ali que o `truncate` corta. O hover salva enquanto
                      houver título longo. */}
                  title={d.title || "Sem título"}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
                >
                  {d.is_pinned ? <Pin className="h-3 w-3 shrink-0 fill-primary text-primary" /> : <FileText className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{d.title || "Sem título"}</span>
                </button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0 opacity-0 transition group-hover/doc:opacity-100 data-[state=open]:opacity-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => startRename(d)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Renomear
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const url = `${window.location.origin}/base-de-conhecimento?space=${space.id}&doc=${d.id}`;
                      shareLink(url);
                    }}
                  >
                    <LinkIcon className="mr-2 h-3.5 w-3.5" /> Copiar link compartilhável
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmDoc(d)}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Deletar
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          <button
            onClick={(e) => {
              const armed = e.currentTarget.dataset.armed === "1";
              if (!armed) {
                e.currentTarget.dataset.armed = "1";
                const btn = e.currentTarget;
                const label = btn.querySelector("[data-label]");
                if (label) label.textContent = "Clique novamente para confirmar";
                btn.classList.add("text-primary", "bg-primary/10");
                setTimeout(() => {
                  if (btn.isConnected) {
                    btn.dataset.armed = "0";
                    const l = btn.querySelector("[data-label]");
                    if (l) l.textContent = "Novo Documento";
                    btn.classList.remove("text-primary", "bg-primary/10");
                  }
                }, 2500);
                return;
              }
              handleNewDoc();
            }}
            disabled={createDoc.isPending}
            title="Clique 2x para criar um novo documento"
            className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] text-muted-foreground/40 opacity-0 transition group-hover/docs:opacity-100 hover:text-foreground hover:bg-sidebar-accent/60"
          >
            <Plus className="h-2.5 w-2.5" /> <span data-label>Novo Documento</span>
          </button>


        </div>
      )}

      <AlertDialog open={!!confirmDoc} onOpenChange={(o) => !o && setConfirmDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar documento?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDoc?.title || "Sem título"}" será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSpace} onOpenChange={setConfirmSpace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deletar espaço?</AlertDialogTitle>
            <AlertDialogDescription>
              "{space.name}" e todos os seus sub-espaços e documentos serão removidos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDeleteSpace} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
