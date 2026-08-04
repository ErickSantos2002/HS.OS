import TiptapImage from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRef } from "react";
import { Eye, Download, Trash2, Pencil } from "lucide-react";
import { openPreview, downloadUrl } from "./mediaActions";

function ResizableImageView({ node, selected, updateAttributes, deleteNode }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const width = node.attrs.width || "auto";
  const src: string = node.attrs.src;
  const alt: string = node.attrs.alt || "";

  const resizeBy = (delta: number) => {
    const currentWidth = imgRef.current?.offsetWidth || 420;
    updateAttributes({ width: `${Math.max(120, currentWidth + delta)}px` });
  };

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    startXRef.current = event.clientX;
    startWidthRef.current = imgRef.current?.offsetWidth || 420;

    const onMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.max(120, startWidthRef.current + moveEvent.clientX - startXRef.current);
      updateAttributes({ width: `${nextWidth}px` });
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const editAlt = () => {
    const next = window.prompt("Descrição da imagem (alt)", alt);
    if (next !== null) updateAttributes({ alt: next });
  };

  const stop = (e: React.MouseEvent) => e.preventDefault();

  return (
    <NodeViewWrapper as="div" className={`wiki-image-node ${selected ? "is-selected" : ""}`}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        title={node.attrs.title || undefined}
        style={{ width, maxWidth: "100%" }}
        draggable={false}
      />
      <div className="wiki-media-actions" contentEditable={false}>
        <button type="button" onMouseDown={stop} onClick={() => openPreview(src)} title="Abrir / Pré-visualizar">
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onMouseDown={stop} onClick={() => downloadUrl(src, alt || undefined)} title="Baixar">
          <Download className="h-3.5 w-3.5" />
        </button>
        <button type="button" onMouseDown={stop} onClick={editAlt} title="Editar descrição">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button type="button" onMouseDown={stop} onClick={() => deleteNode()} title="Deletar">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {selected && (
        <div className="wiki-image-controls" contentEditable={false}>
          <button type="button" onMouseDown={stop} onClick={() => resizeBy(-80)} title="Reduzir imagem">−</button>
          <button type="button" onMouseDown={stop} onClick={() => resizeBy(80)} title="Aumentar imagem">+</button>
          <span className="wiki-image-resize-handle" onMouseDown={startResize} title="Arrastar para redimensionar" />
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ResizableImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width") || element.style.width || null,
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
