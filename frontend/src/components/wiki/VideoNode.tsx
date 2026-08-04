import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Eye, Download, Trash2 } from "lucide-react";
import { openPreview, downloadUrl } from "./mediaActions";

function VideoView({ node, deleteNode }: NodeViewProps) {
  const src: string = node.attrs.src;
  const stop = (e: React.MouseEvent) => e.preventDefault();

  return (
    <NodeViewWrapper as="div" className="wiki-video-node">
      <video controls src={src} style={{ maxWidth: "100%", borderRadius: 8 }} />
      <div className="wiki-media-actions" contentEditable={false}>
        <button type="button" onMouseDown={stop} onClick={() => openPreview(src)} title="Abrir em nova aba">
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onMouseDown={stop} onClick={() => downloadUrl(src)} title="Baixar">
          <Download className="h-3.5 w-3.5" />
        </button>
        <button type="button" onMouseDown={stop} onClick={() => deleteNode()} title="Deletar">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const VideoNode = Node.create({
  name: "wikiVideo",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: null },
    };
  },
  parseHTML() {
    return [
      { tag: "div[data-video] video", getAttrs: (el) => ({ src: (el as HTMLVideoElement).getAttribute("src") }) },
      { tag: "video[src]", getAttrs: (el) => ({ src: (el as HTMLVideoElement).getAttribute("src") }) },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { "data-video": "" },
      ["video", mergeAttributes({ controls: "true", style: "max-width:100%;border-radius:8px;" }, HTMLAttributes)],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(VideoView);
  },
});
