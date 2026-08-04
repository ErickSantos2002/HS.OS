import { useEffect, useState } from "react";
import { BookOpen, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SpacesSidebar } from "@/components/wiki/SpacesSidebar";
import { WikiHome } from "@/components/wiki/WikiHome";
import { CreateSpaceDialog } from "@/components/wiki/CreateSpaceDialog";
import { DocumentEditor } from "@/components/wiki/DocumentEditor";
import { useWikiSpaces, type WikiSpace } from "@/hooks/use-wiki-spaces";
import { useWikiDocument } from "@/hooks/use-wiki-documents";
import { useIsMobile } from "@/hooks/use-mobile";
import { pushWikiRecent, removeWikiRecent } from "@/lib/wiki-recents";

const SELECTION_KEY = "wiki:selection";

function loadSelection(): { spaceId: string | null; docId: string | null } {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlSpace = params.get("space");
    const urlDoc = params.get("doc");
    if (urlSpace || urlDoc) return { spaceId: urlSpace, docId: urlDoc };
    const raw = sessionStorage.getItem(SELECTION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { spaceId: parsed.spaceId ?? null, docId: parsed.docId ?? null };
    }
  } catch {
    // ignore
  }
  return { spaceId: null, docId: null };
}

export default function KnowledgeBasePage() {
  const { data: spaces = [] } = useWikiSpaces();
  const initial = (typeof window !== "undefined") ? loadSelection() : { spaceId: null, docId: null };
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(initial.spaceId);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(initial.docId);

  // Persist selection to survive tab refocus / reload
  useEffect(() => {
    try {
      sessionStorage.setItem(
        SELECTION_KEY,
        JSON.stringify({ spaceId: selectedSpaceId, docId: selectedDocId }),
      );
      const params = new URLSearchParams(window.location.search);
      if (selectedDocId) params.set("doc", selectedDocId); else params.delete("doc");
      if (selectedSpaceId) params.set("space", selectedSpaceId); else params.delete("space");
      const qs = params.toString();
      const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (next !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, "", next);
      }
    } catch {
      // ignore
    }
  }, [selectedSpaceId, selectedDocId]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [editingSpace, setEditingSpace] = useState<WikiSpace | null>(null);
  // mobile uses inline sidebar (no drawer)
  const isMobile = useIsMobile();

  const { data: doc, isLoading: docLoading, isFetching: docFetching } = useWikiDocument(selectedDocId);
  const currentSpace = spaces.find((s) => s.id === (doc?.space_id ?? selectedSpaceId));

  // Track recently opened documents
  useEffect(() => {
    if (doc?.id) {
      pushWikiRecent({ id: doc.id, title: doc.title || "Sem título", spaceId: doc.space_id });
    }
  }, [doc?.id, doc?.title, doc?.space_id]);

  // No auto-select: user must explicitly click a space to view its documents.

  const handleSelectDoc = (spaceId: string, docId: string) => {
    setSelectedSpaceId(spaceId);
    setSelectedDocId(docId);
  };

  const sidebar = (
    <SpacesSidebar
      selectedSpaceId={selectedSpaceId}
      selectedDocId={selectedDocId}
      onSelectSpace={setSelectedSpaceId}
      onSelectDoc={handleSelectDoc}
      onNewSpace={(parentId) => { setCreateParentId(parentId ?? null); setCreateOpen(true); }}
      onEditSpace={(sp) => setEditingSpace(sp)}
      onDocDeleted={(id) => { removeWikiRecent(id); if (selectedDocId === id) setSelectedDocId(null); }}
      onSpaceDeleted={(id) => {
        if (selectedSpaceId === id) setSelectedSpaceId(null);
        if (doc?.space_id === id) setSelectedDocId(null);
      }}
    />
  );

  // Mobile: skip WikiHome and show sidebar directly as the main view.
  if (isMobile) {
    return (
      <div className="flex h-[calc(100dvh-3.5rem)] w-full flex-col overflow-hidden bg-background">
        {doc ? (
          <>
            <div className="flex items-center gap-2 border-b border-border px-2 py-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setSelectedDocId(null)} className="gap-1">
                <Menu className="h-4 w-4" />
                <span className="text-xs">Documentos</span>
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <DocumentEditor
                document={doc}
                space={currentSpace}
                onDeleted={() => setSelectedDocId(null)}
              />
            </div>
          </>
        ) : selectedDocId && (docLoading || docFetching) ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Carregando documento...
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">{sidebar}</div>
        )}

        <CreateSpaceDialog
          open={createOpen}
          onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateParentId(null); }}
          parentId={createParentId}
          onCreated={(id) => setSelectedSpaceId(id)}
        />
        <CreateSpaceDialog
          open={!!editingSpace}
          onOpenChange={(o) => !o && setEditingSpace(null)}
          space={editingSpace}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      <div className="w-[260px] shrink-0">{sidebar}</div>

      {/* Main area */}
      <main className="flex-1 min-w-0 flex flex-col bg-background">
        {doc ? (
          <DocumentEditor
            document={doc}
            space={currentSpace}
            onDeleted={() => setSelectedDocId(null)}
          />
        ) : selectedDocId && (docLoading || docFetching) ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Carregando documento...
          </div>
        ) : (
          <WikiHome
            selectedSpaceId={selectedSpaceId}
            onSelectSpace={(id) => setSelectedSpaceId(id || null)}
            onNewSpace={() => {
              setCreateParentId(null);
              setCreateOpen(true);
            }}
            onDocumentCreated={(spaceId, docId) => {
              setSelectedSpaceId(spaceId);
              setSelectedDocId(docId);
            }}
            onSelectDoc={handleSelectDoc}
          />
        )}
      </main>

      <CreateSpaceDialog
        open={createOpen}
        onOpenChange={(o) => { setCreateOpen(o); if (!o) setCreateParentId(null); }}
        parentId={createParentId}
        onCreated={(id) => setSelectedSpaceId(id)}
      />

      <CreateSpaceDialog
        open={!!editingSpace}
        onOpenChange={(o) => !o && setEditingSpace(null)}
        space={editingSpace}
      />
    </div>
  );
}

function EmptyState({ title, subtitle, cta }: { title: string; subtitle?: string; cta?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-6">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
        <BookOpen className="h-7 w-7 text-primary" />
      </div>
      <h3 className="text-lg font-semibold text-foreground" style={{ fontFamily: "Rajdhani, sans-serif", letterSpacing: "-0.01em" }}>{title}</h3>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{subtitle}</p>}
      {cta && <div className="mt-5">{cta}</div>}
    </div>
  );
}
