import type { Editor } from "@tiptap/react";
import { useRef, useState } from "react";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  Heading1, Heading2, Heading3, List, ListOrdered,
  Link as LinkIcon, Unlink as UnlinkIcon, Image as ImageIcon, Video as VideoIcon, Paperclip, Minus,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, MoveVertical,
  Table as TableIcon, Plus, Trash2, Rows, Columns,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

interface Props {
  editor: Editor | null;
  documentId?: string;
}

export function EditorToolbar({ editor, documentId }: Props) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedSelection = useRef<{ from: number; to: number; empty: boolean } | null>(null);

  if (!editor) return null;

  const btnCls = (active: boolean) =>
    `h-8 w-8 inline-flex items-center justify-center rounded-md transition ${
      active
        ? "bg-primary/20 text-primary"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
    }`;

  // Standard TipTap pattern: prevent focus loss on mousedown, run command on click.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  const applyHeading = (level: 1 | 2 | 3) => {
    const { from, to } = editor.state.selection;
    editor.chain().focus().setTextSelection({ from, to }).toggleHeading({ level }).run();
  };

  const openLinkDialog = () => {
    const { from, to, empty } = editor.state.selection;
    savedSelection.current = { from, to, empty };
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "";
    setLinkUrl(prev || "https://");
    setLinkOpen(true);
  };

  const normalizeUrl = (raw: string) => {
    const v = raw.trim();
    if (!v) return "";
    if (/^(https?:|mailto:|tel:|\/|#)/i.test(v)) return v;
    return `https://${v}`;
  };

  const escapeHtml = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const applyLink = () => {
    const sel = savedSelection.current;
    if (!sel) return;
    const url = normalizeUrl(linkUrl);
    if (!url) {
      setLinkOpen(false);
      return;
    }
    const chain = editor.chain().focus().setTextSelection({ from: sel.from, to: sel.to });
    if (sel.empty) {
      chain.insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    } else {
      chain.setMark("link", { href: url }).run();
    }
    setLinkOpen(false);
  };

  const removeLinkFromDialog = () => {
    const sel = savedSelection.current;
    if (!sel) return;
    editor.chain().focus().setTextSelection({ from: sel.from, to: sel.to }).extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  };

  const promptImage = () => imageInputRef.current?.click();

  const promptVideo = () => videoInputRef.current?.click();

  const promptAttachment = () => attachmentInputRef.current?.click();

  const uploadFile = async (file: File, kind: "image" | "video" | "attachment") => {
    const ext = file.name.split(".").pop() || "bin";
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) {
      console.error("Upload failed: usuário não autenticado");
      return;
    }
    const folder = documentId || "misc";
    const path = `${userId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("wiki-uploads").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
    if (error) {
      console.error("Upload failed:", error);
      return;
    }
    const { data: pub } = supabase.storage.from("wiki-uploads").getPublicUrl(path);
    const url = pub.publicUrl;
    const resolvedKind: "image" | "video" | "attachment" =
      kind === "attachment"
        ? file.type.startsWith("image/")
          ? "image"
          : file.type.startsWith("video/")
            ? "video"
            : "attachment"
        : kind;
    const endPos = editor.state.doc.content.size;
    const chain = editor.chain().focus().setTextSelection(endPos);
    if (resolvedKind === "image") {
      chain.insertContent({ type: "image", attrs: { src: url, alt: file.name, width: "520px" } }).run();
    } else if (resolvedKind === "video") {
      chain.insertContent({ type: "wikiVideo", attrs: { src: url } }).run();
    } else {
      const size = file.size ? `${(file.size / 1024).toFixed(file.size > 1024 * 1024 ? 0 : 1)} KB` : "arquivo";
      chain.insertContent({ type: "wikiAttachment", attrs: { href: url, name: file.name, size } }).run();
    }
  };

  const uploadFiles = async (files: FileList | File[], kind: "image" | "video" | "attachment") => {
    for (const file of Array.from(files)) {
      await uploadFile(file, kind);
    }
  };


  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 sticky top-0 z-10 bg-card border-b border-border">
      <button type="button" className={btnCls(editor.isActive("bold"))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrito">
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("italic"))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().toggleItalic().run()} title="Itálico">
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("underline"))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado">
        <UnderlineIcon className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("strike"))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado">
        <Strikethrough className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" />
      <button type="button" className={btnCls(editor.isActive("heading", { level: 1 }))} onMouseDown={keepFocus} onClick={() => applyHeading(1)} title="H1">
        <Heading1 className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("heading", { level: 2 }))} onMouseDown={keepFocus} onClick={() => applyHeading(2)} title="H2">
        <Heading2 className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("heading", { level: 3 }))} onMouseDown={keepFocus} onClick={() => applyHeading(3)} title="H3">
        <Heading3 className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" />
      <button type="button" className={btnCls(editor.isActive("bulletList"))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">
        <List className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive("orderedList"))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">
        <ListOrdered className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" />
      <button type="button" className={btnCls(editor.isActive("link"))} onMouseDown={keepFocus} onClick={openLinkDialog} title="Link">
        <LinkIcon className="h-4 w-4" />
      </button>
      {editor.isActive("link") && (
        <button type="button" className={btnCls(false)} onMouseDown={keepFocus} onClick={removeLink} title="Remover link">
          <UnlinkIcon className="h-4 w-4" />
        </button>
      )}
      <button type="button" className={btnCls(false)} onMouseDown={keepFocus} onClick={promptImage} title="Imagem">
        <ImageIcon className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(false)} onMouseDown={keepFocus} onClick={promptVideo} title="Vídeo">
        <VideoIcon className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(false)} onMouseDown={keepFocus} onClick={promptAttachment} title="Anexo">
        <Paperclip className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(false)} onMouseDown={keepFocus} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Divider">
        <Minus className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" />
      <button type="button" className={btnCls(editor.isActive({ textAlign: "left" }))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().setTextAlign("left").run()} title="Alinhar à esquerda">
        <AlignLeft className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive({ textAlign: "center" }))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().setTextAlign("center").run()} title="Centralizar">
        <AlignCenter className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive({ textAlign: "right" }))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().setTextAlign("right").run()} title="Alinhar à direita">
        <AlignRight className="h-4 w-4" />
      </button>
      <button type="button" className={btnCls(editor.isActive({ textAlign: "justify" }))} onMouseDown={keepFocus} onClick={() => editor.chain().focus().setTextAlign("justify").run()} title="Justificar">
        <AlignJustify className="h-4 w-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={btnCls(false)} onMouseDown={keepFocus} title="Espaçamento entre linhas">
            <MoveVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[8rem]">
          {[
            { label: "Compacto (1.2)", value: "1.2" },
            { label: "Normal (1.5)", value: "1.5" },
            { label: "Confortável (1.75)", value: "1.75" },
            { label: "Espaçoso (2)", value: "2" },
            { label: "Duplo (2.5)", value: "2.5" },
          ].map((opt) => (
            <DropdownMenuItem key={opt.value} onClick={() => editor.chain().focus().setLineHeight(opt.value).run()}>
              {opt.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => editor.chain().focus().unsetLineHeight().run()}>
            Padrão
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1 h-5 w-px bg-border" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={btnCls(editor.isActive("table"))} onMouseDown={keepFocus} title="Tabela">
            <TableIcon className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[12rem]">
          {!editor.isActive("table") ? (
            <>
              <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
                <Plus className="h-4 w-4 mr-2" /> Inserir tabela 3×3
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>
                <Plus className="h-4 w-4 mr-2" /> Inserir tabela 2×2
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 5, cols: 4, withHeaderRow: true }).run()}>
                <Plus className="h-4 w-4 mr-2" /> Inserir tabela 5×4
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={() => editor.chain().focus().addColumnBefore().run()}>
                <Columns className="h-4 w-4 mr-2" /> Coluna à esquerda
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>
                <Columns className="h-4 w-4 mr-2" /> Coluna à direita
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>
                <Trash2 className="h-4 w-4 mr-2" /> Excluir coluna
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addRowBefore().run()}>
                <Rows className="h-4 w-4 mr-2" /> Linha acima
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>
                <Rows className="h-4 w-4 mr-2" /> Linha abaixo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}>
                <Trash2 className="h-4 w-4 mr-2" /> Excluir linha
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
                Alternar cabeçalho
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().mergeOrSplit().run()}>
                Mesclar / dividir células
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteTable().run()} className="text-destructive">
                <Trash2 className="h-4 w-4 mr-2" /> Excluir tabela
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Hidden file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files, "image");
          e.target.value = "";
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files, "video");
          e.target.value = "";
        }}
      />
      <input
        ref={attachmentInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) uploadFiles(e.target.files, "attachment");
          e.target.value = "";
        }}
      />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editor.isActive("link") ? "Editar link" : "Adicionar link"}</DialogTitle>
            <DialogDescription className="sr-only">Informe a URL para aplicar ao texto selecionado.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } }}
              placeholder="https://exemplo.com"
              className="w-full"
            />
            <DialogFooter className="gap-2 sm:justify-end sm:space-x-0">
              {editor.isActive("link") && (
                <Button variant="ghost" className="sm:mr-auto" onClick={removeLinkFromDialog}>
                  <UnlinkIcon className="h-4 w-4 mr-1" /> Remover
                </Button>
              )}
              <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
                <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => setLinkOpen(false)}>Cancelar</Button>
                <Button className="flex-1 sm:flex-none" onClick={applyLink}>Aplicar</Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
