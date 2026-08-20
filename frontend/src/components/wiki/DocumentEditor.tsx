import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Youtube from "@tiptap/extension-youtube";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { LineHeight } from "./LineHeight";
import { useEffect, useRef, useState } from "react";
import { useAgents } from "@/hooks/use-agents";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Pin, Trash2, Columns, Rows, Trash, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EditorToolbar } from "./EditorToolbar";
import type { WikiDocument } from "@/hooks/use-wiki-documents";
import { useUpdateWikiDocument, useDeleteWikiDocument } from "@/hooks/use-wiki-documents";
import type { WikiSpace } from "@/hooks/use-wiki-spaces";
import { enviarArquivo, urlPublica } from "@/lib/storage";
import { api, lerUsuarioDoToken } from "@/lib/api";
import { SpaceIcon } from "./SpaceIcon";
import { ResizableImage } from "./ResizableImage";
import { VideoNode } from "./VideoNode";
import { AttachmentNode } from "./AttachmentNode";

type SaveStatus = "idle" | "saving" | "saved";

interface Props {
  document: WikiDocument;
  space: WikiSpace | undefined;
  onDeleted?: () => void;
}

export function DocumentEditor({ document, space, onDeleted }: Props) {
  const update = useUpdateWikiDocument();
  const remove = useDeleteWikiDocument();
  const [title, setTitle] = useState(document.title);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [editorName, setEditorName] = useState<string>("");
  const debounceRef = useRef<number | null>(null);
  const docIdRef = useRef(document.id);

  // Reset when switching documents
  useEffect(() => {
    docIdRef.current = document.id;
    setTitle(document.title);
    setStatus("saved");
  }, [document.id, document.title]);

  // Nome do agente que redigiu. `useAgents` já está carregado noutras telas e
  // vem do cache do React Query; se não vier, o id serve — "flow" é legível.
  const { agents } = useAgents();
  const nomeDoAgente =
    agents?.find((a) => a.id === document.agent_id || a.openclaw_id === document.agent_id)?.name ??
    document.agent_id;

  // Resolve last editor display name
  //
  // ⚠️ **Só vale quando quem escreveu foi gente.** Documento de agente traz
  // `agent_id`, e aí o nome da pessoa é o dono do espaço, não o autor — foi o
  // que fez o briefing da manhã aparecer como "Editado por Erick Santos"
  // quando quem o escreveu foi o `flow`, por cron, sem ninguém pedindo.
  useEffect(() => {
    let cancelled = false;
    if (document.agent_id) return;
    const uid = document.updated_by || document.created_by;
    if (!uid) return;
    api<{ full_name?: string; email?: string }>(`/profiles/${uid}`)
      .then((data) => {
        if (!cancelled) setEditorName(data?.full_name || data?.email || "alguém");
      })
      .catch(() => { /* o nome do editor é enfeite */ });
    return () => { cancelled = true; };
  }, [document.updated_by, document.created_by]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-primary underline" } }),
      ResizableImage,
      VideoNode,
      AttachmentNode,
      TextAlign.configure({ types: ["paragraph", "heading"], alignments: ["left", "center", "right", "justify"] }),
      LineHeight,
      Youtube.configure({ controls: true, nocookie: true, HTMLAttributes: { class: "rounded-lg my-2" } }),
      Table.configure({ resizable: true, HTMLAttributes: { class: "wiki-table" } }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "Comece a escrever..." }),
    ],
    content: document.content || "",
    editorProps: {
      attributes: {
        class: "wiki-editor-content max-w-none focus:outline-none min-h-[60vh]",
        style: "font-family: Inter, sans-serif; font-size: 15px; line-height: 1.7;",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!link) return false;
        window.open(link.href, link.target || "_blank", "noopener,noreferrer");
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (!editor || editor.isDestroyed) return;
      let html: string;
      try {
        html = editor.getHTML();
      } catch (err) {
        console.warn("[DocumentEditor] getHTML failed:", err);
        return;
      }
      setStatus("saving");
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(async () => {
        const targetId = docIdRef.current;
        try {
          await update.mutateAsync({ id: targetId, content: html });
          if (docIdRef.current === targetId) setStatus("saved");
        } catch {
          setStatus("idle");
        }
      }, 1500);
    },
  }, [document.id]);

  // Sync external content when switching docs
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    try {
      if (editor.getHTML() !== (document.content || "")) {
        editor.commands.setContent(document.content || "", { emitUpdate: false });
      }
    } catch (err) {
      console.warn("[DocumentEditor] setContent failed:", err);
    }
  }, [document.id, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
  }, []);

  const saveTitle = async () => {
    const trimmed = title.trim() || "Sem título";
    if (trimmed !== document.title) {
      setStatus("saving");
      await update.mutateAsync({ id: document.id, title: trimmed });
      setStatus("saved");
    }
  };

  const togglePin = async () => {
    await update.mutateAsync({ id: document.id, is_pinned: !document.is_pinned });
  };

  const handleDelete = async () => {
    await remove.mutateAsync({ id: document.id, space_id: document.space_id });
    onDeleted?.();
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="border-b border-border px-8 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground mb-1 truncate flex items-center gap-1.5">
              <SpaceIcon name={space?.icon} className="h-3.5 w-3.5" style={{ color: space?.color || undefined }} />
              <span>{space?.name ?? "Espaço"}</span>
              <span className="mx-1">›</span>
              <span className="truncate">{document.title || "Sem título"}</span>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
              className="w-full bg-transparent text-foreground outline-none"
              style={{ fontFamily: "Rajdhani, sans-serif", fontWeight: 700, fontSize: 28, letterSpacing: "-0.01em" }}
              placeholder="Sem título"
            />
            <div className="mt-1 text-xs text-muted-foreground">
              Editado por {editorName || "alguém"} {document.updated_at && (
                <>há {formatDistanceToNow(new Date(document.updated_at), { locale: ptBR })}</>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground min-w-[60px] text-right">
              {status === "saving" ? "Salvando..." : status === "saved" ? "Salvo" : ""}
            </span>
            <Button
              size="icon"
              variant="ghost"
              title="Copiar link compartilhável"
              onClick={() => {
                const url = `${window.location.origin}/base-de-conhecimento?space=${document.space_id}&doc=${document.id}`;
                navigator.clipboard.writeText(url).then(
                  () => toast.success("Link copiado", { description: "Compartilhe com membros logados na plataforma." }),
                  () => toast.error("Não foi possível copiar o link"),
                );
              }}
            >
              <Link2 className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={togglePin} title={document.is_pinned ? "Desfixar" : "Fixar"}>
              <Pin className={`h-4 w-4 ${document.is_pinned ? "fill-primary text-primary" : ""}`} />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" title="Deletar">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Deletar documento?</AlertDialogTitle>
                  <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Deletar</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <EditorToolbar editor={editor} documentId={document.id} />

      {/* Editor */}
      <EditorDropZone editor={editor} documentId={document.id} />
    </div>
  );
}

function EditorDropZone({ editor, documentId }: { editor: ReturnType<typeof useEditor>; documentId: string }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close context menu on outside click / escape / scroll
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!editor) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest("table.wiki-table")) return;
    e.preventDefault();
    // Move the editor selection to the clicked cell
    try {
      const coords = { left: e.clientX, top: e.clientY };
      const pos = editor.view.posAtCoords(coords);
      if (pos) editor.chain().focus().setTextSelection(pos.pos).run();
    } catch {
      // ignore
    }
    const rect = containerRef.current?.getBoundingClientRect();
    setMenu({
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0) + (containerRef.current?.scrollTop ?? 0),
    });
  };

  const runCmd = (fn: () => void) => {
    fn();
    setMenu(null);
  };

  const uploadAndInsert = async (files: FileList | File[]) => {
    if (!editor) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const userId = lerUsuarioDoToken();
      if (!userId) throw new Error("Usuário não autenticado para enviar arquivos");

      for (const file of list) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `${userId}/${documentId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        await enviarArquivo("wiki-uploads", path, file, file.name);
        const url = urlPublica("wiki-uploads", path);
        const endPos = editor.state.doc.content.size;
        const chain = editor.chain().focus().setTextSelection(endPos);
        if (file.type.startsWith("image/")) {
          chain.insertContent({ type: "image", attrs: { src: url, alt: file.name, width: "520px" } }).run();
        } else if (file.type.startsWith("video/")) {
          chain.insertContent({ type: "wikiVideo", attrs: { src: url } }).run();
        } else {
          const size = file.size ? `${(file.size / 1024).toFixed(file.size > 1024 * 1024 ? 0 : 1)} KB` : "arquivo";
          chain.insertContent({ type: "wikiAttachment", attrs: { href: url, name: file.name, size } }).run();
        }
      }
    } catch (e) {
      console.error("Upload failed:", e);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`flex-1 overflow-y-auto relative transition ${dragOver ? "bg-primary/5" : ""}`}
      onContextMenu={handleContextMenu}
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          setDragOver(false);
          uploadAndInsert(e.dataTransfer.files);
        }
      }}
    >
      <div className="px-8 py-8">
        <EditorContent editor={editor} />
      </div>
      {menu && editor && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="absolute z-50 min-w-[12rem] rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-md"
          style={{ left: menu.x, top: menu.y }}
        >
          <MenuItem icon={<Columns className="h-4 w-4" />} onClick={() => runCmd(() => editor.chain().focus().addColumnBefore().run())}>
            Coluna à esquerda
          </MenuItem>
          <MenuItem icon={<Columns className="h-4 w-4" />} onClick={() => runCmd(() => editor.chain().focus().addColumnAfter().run())}>
            Coluna à direita
          </MenuItem>
          <MenuItem icon={<Rows className="h-4 w-4" />} onClick={() => runCmd(() => editor.chain().focus().addRowBefore().run())}>
            Linha acima
          </MenuItem>
          <MenuItem icon={<Rows className="h-4 w-4" />} onClick={() => runCmd(() => editor.chain().focus().addRowAfter().run())}>
            Linha abaixo
          </MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<Trash className="h-4 w-4" />} onClick={() => runCmd(() => editor.chain().focus().deleteColumn().run())}>
            Excluir coluna
          </MenuItem>
          <MenuItem icon={<Trash className="h-4 w-4" />} onClick={() => runCmd(() => editor.chain().focus().deleteRow().run())}>
            Excluir linha
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="h-4 w-4" />}
            destructive
            onClick={() => runCmd(() => editor.chain().focus().deleteTable().run())}
          >
            Excluir tabela
          </MenuItem>
        </div>
      )}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed border-primary/60 bg-primary/5">
          <div className="rounded-md bg-card px-4 py-2 text-sm text-foreground shadow-card">
            Solte arquivos para inserir
          </div>
        </div>
      )}
      {uploading && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-md bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-card border border-border">
          Enviando arquivo...
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-secondary ${
        destructive ? "text-destructive" : ""
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
