import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Eye, Download, Trash2, Pencil, Paperclip, Check, X, GripVertical } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { downloadUrl } from "./mediaActions";
import { PreviewModal } from "./PreviewModal";

function AttachmentView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const href: string = node.attrs.href;
  const name: string = node.attrs.name || "arquivo";
  const size: string = node.attrs.size || "";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [previewing, setPreviewing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const stop = (e: React.MouseEvent) => e.preventDefault();

  const commit = () => {
    const next = draft.trim();
    if (next && next !== name) updateAttributes({ name: next });
    setEditing(false);
  };
  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  const openPreview = () => setPreviewing(true);

  return (
    <NodeViewWrapper as="div" className="wiki-attachment-node">
      <div
        className="wiki-attachment-card cursor-pointer"
        contentEditable={false}
        onClick={(e) => {
          if (editing) return;
          const t = e.target as HTMLElement;
          if (t.closest("button") || t.closest("[data-drag-handle]")) return;
          openPreview();
        }}
      >
        <div
          data-drag-handle
          draggable="true"
          contentEditable={false}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 flex items-center"
          title="Arraste para reordenar"
        >
          <GripVertical className="h-4 w-4" />
        </div>
        <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                else if (e.key === "Escape") { e.preventDefault(); cancel(); }
              }}
              className="w-full bg-transparent border-b border-border outline-none text-sm font-semibold text-foreground"
            />
          ) : (
            <div className="truncate text-sm font-semibold text-foreground">{name}</div>
          )}
          {size && !editing && <div className="text-xs text-muted-foreground">{size}</div>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {editing ? (
            <>
              <button type="button" onMouseDown={stop} onClick={commit} title="Salvar">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button type="button" onMouseDown={stop} onClick={cancel} title="Cancelar">
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button type="button" onMouseDown={stop} onClick={openPreview} title="Abrir / Pré-visualizar">
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button type="button" onMouseDown={stop} onClick={() => downloadUrl(href, name)} title="Baixar">
                <Download className="h-3.5 w-3.5" />
              </button>
              <button type="button" onMouseDown={stop} onClick={() => { setDraft(name); setEditing(true); }} title="Renomear">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" onMouseDown={stop} onClick={() => deleteNode()} title="Deletar">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      {previewing && <PreviewModal url={href} name={name} onClose={() => setPreviewing(false)} />}
    </NodeViewWrapper>
  );
}

export const AttachmentNode = Node.create({
  name: "wikiAttachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: "arquivo" },
      size: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-wiki-attachment]",
        priority: 100,
        getAttrs: (el) => {
          const node = el as HTMLElement;
          return {
            href: node.getAttribute("data-href"),
            name: node.getAttribute("data-name") || "arquivo",
            size: node.getAttribute("data-size") || "",
          };
        },
      },
      // Backwards-compat with previously saved anchor format.
      // High priority so the Link mark doesn't claim these <a> elements first.
      {
        tag: "a.wiki-file-attachment",
        priority: 1000,
        getAttrs: (el) => {
          const a = el as HTMLAnchorElement;
          return {
            href: a.getAttribute("href"),
            name:
              a.getAttribute("data-name") ||
              a.getAttribute("download") ||
              a.querySelector("strong")?.textContent ||
              "arquivo",
            size:
              a.getAttribute("data-size") ||
              a.querySelector("small")?.textContent ||
              "",
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const { href, name, size } = node.attrs as { href: string; name: string; size: string };
    return [
      "div",
      mergeAttributes(
        {
          "data-wiki-attachment": "true",
          "data-href": href,
          "data-name": name,
          "data-size": size,
          class: "wiki-file-attachment-block",
        },
        HTMLAttributes,
      ),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});
