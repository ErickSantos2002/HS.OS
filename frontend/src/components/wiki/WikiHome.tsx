import { useEffect, useState } from "react";
import { Plus, X, FileText, ArrowRight, ArrowLeft, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SPACE_ICONS, DEFAULT_SPACE_ICON } from "./SpaceIcon";
import { useWikiSpaces, type WikiSpace } from "@/hooks/use-wiki-spaces";
import {
  useCreateWikiDocument,
  useUpdateWikiDocument,
  useWikiDocuments,
} from "@/hooks/use-wiki-documents";
import { toast } from "@/hooks/use-toast";
import { getWikiRecents, type WikiRecent } from "@/lib/wiki-recents";

function formatOpenedAt(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  onNewSpace: () => void;
  onDocumentCreated: (spaceId: string, docId: string) => void;
  onSelectDoc?: (spaceId: string, docId: string) => void;
  onSelectSpace?: (spaceId: string) => void;
  selectedSpaceId?: string | null;
  onClose?: () => void;
}

export function WikiHome({
  onNewSpace,
  onDocumentCreated,
  onSelectDoc,
  onSelectSpace,
  selectedSpaceId,
  onClose,
}: Props) {
  const { data: spaces = [] } = useWikiSpaces();
  const [title, setTitle] = useState("");
  const createDoc = useCreateWikiDocument();
  const updateDoc = useUpdateWikiDocument();
  const [recents, setRecents] = useState<WikiRecent[]>(() => getWikiRecents());

  const activeSpace = spaces.find((s) => s.id === selectedSpaceId) ?? null;
  const { data: spaceDocs = [], isLoading: docsLoading } = useWikiDocuments(
    activeSpace?.id ?? null
  );

  useEffect(() => {
    const refresh = () => setRecents(getWikiRecents());
    window.addEventListener("wiki:recents-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("wiki:recents-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Only show recents whose space still exists
  const visibleRecents = recents.filter((r) => spaces.some((s) => s.id === r.spaceId)).slice(0, 5);

  const handlePickSpace = (space: WikiSpace) => {
    if (onSelectSpace) {
      onSelectSpace(space.id);
    }
  };

  const handleCreateInSpace = async (space: WikiSpace) => {
    try {
      const doc = await createDoc.mutateAsync(space.id);
      const finalTitle = title.trim();
      if (finalTitle) {
        await updateDoc.mutateAsync({ id: doc.id, title: finalTitle });
      }
      onDocumentCreated(space.id, doc.id);
      setTitle("");
    } catch (e) {
      toast({
        title: "Erro ao criar documento",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  // ─── View: Documents inside a selected space ─────────────────
  if (activeSpace) {
    const Icon = SPACE_ICONS[activeSpace.icon ?? DEFAULT_SPACE_ICON] ?? FileText;
    const color = activeSpace.color ?? "#3D61FF";
    return (
      <div className="flex h-full w-full items-center justify-center overflow-y-auto p-6">
        <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-xl">
          {onClose && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <div className="flex items-center gap-3 border-b border-border px-6 py-5">
            <button
              onClick={() => onSelectSpace?.("")}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Voltar"
              title="Voltar aos espaços"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div
              className="grid h-10 w-10 place-items-center rounded-lg"
              style={{ background: `${color}1A`, color }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                className="truncate text-lg font-semibold text-foreground"
                style={{ fontFamily: "Rajdhani, sans-serif", letterSpacing: "-0.01em" }}
              >
                {activeSpace.name}
              </h2>
              {activeSpace.description && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {activeSpace.description}
                </p>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => handleCreateInSpace(activeSpace)}
              disabled={createDoc.isPending}
              className="gap-1"
            >
              <Plus className="h-4 w-4" /> Novo documento
            </Button>
          </div>

          <div className="space-y-2 px-6 py-6">
            {docsLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Carregando documentos...
              </div>
            ) : spaceDocs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-10 text-center">
                <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Nenhum documento neste espaço ainda.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleCreateInSpace(activeSpace)}
                  disabled={createDoc.isPending}
                  className="mt-4 gap-1"
                >
                  <Plus className="h-4 w-4" /> Criar primeiro documento
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {spaceDocs.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onSelectDoc?.(activeSpace.id, d.id)}
                    className="group flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5 text-left transition hover:border-primary/60 hover:bg-secondary/40"
                  >
                    <div
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
                      style={{ background: `${color}1A`, color }}
                    >
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {d.title || "Sem título"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        Atualizado em{" "}
                        {new Date(d.updated_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── View: Spaces grid ──────────────────────────────────────
  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto p-6">
      <div className="relative w-full max-w-3xl rounded-2xl border border-border bg-card/60 backdrop-blur-sm shadow-xl">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="border-b border-border px-6 py-5">
          <h2
            className="text-lg font-semibold text-foreground"
            style={{ fontFamily: "Rajdhani, sans-serif", letterSpacing: "-0.01em" }}
          >
            Base de conhecimento
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha um espaço para ver seus documentos ou crie um novo
          </p>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">Espaços</label>
              {spaces.length > 0 && (
                <span className="text-xs text-muted-foreground/70">
                  {spaces.length} {spaces.length === 1 ? "espaço" : "espaços"}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {spaces.map((space) => {
                const Icon = SPACE_ICONS[space.icon ?? DEFAULT_SPACE_ICON] ?? FileText;
                const color = space.color ?? "#3D61FF";
                return (
                  <button
                    key={space.id}
                    onClick={() => handlePickSpace(space)}
                    className="group relative flex flex-col items-start gap-3 rounded-xl border border-border bg-background/40 p-4 text-left transition hover:border-primary/60 hover:bg-secondary/40"
                  >
                    <div
                      className="grid h-10 w-10 place-items-center rounded-lg"
                      style={{ background: `${color}1A`, color }}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {space.name}
                      </div>
                      {space.description && (
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {space.description}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="absolute right-3 top-3 h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </button>
                );
              })}

              <button
                onClick={onNewSpace}
                className="group flex flex-col items-start gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-left transition hover:border-primary hover:bg-primary/10"
              >
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">Novo Espaço</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Crie um espaço para organizar
                  </div>
                </div>
              </button>
            </div>
          </div>

          {visibleRecents.length > 0 && (
            <div className="space-y-3 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm text-muted-foreground">Documentos recentes</label>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleRecents.map((r) => {
                  const space = spaces.find((s) => s.id === r.spaceId);
                  const Icon = space ? (SPACE_ICONS[space.icon ?? DEFAULT_SPACE_ICON] ?? FileText) : FileText;
                  const color = space?.color ?? "#3D61FF";
                  return (
                    <button
                      key={r.id}
                      onClick={() => onSelectDoc?.(r.spaceId, r.id)}
                      disabled={!onSelectDoc}
                      className="group flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-left transition hover:border-primary/60 hover:bg-secondary/40 disabled:opacity-60"
                    >
                      <div
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md"
                        style={{ background: `${color}1A`, color }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {r.title || "Sem título"}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {space ? `${space.name} · ` : ""}
                          {formatOpenedAt(r.openedAt)}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
