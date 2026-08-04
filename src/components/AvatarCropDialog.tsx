import { useEffect, useRef, useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Loader2, Upload, RotateCcw } from "lucide-react";

const OUTPUT_SIZE = 512;
const VIEW_SIZE = 320;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Optional initial image (URL or data URL) to start editing from */
  initialImage?: string | null;
  title?: string;
  /** Called with the cropped PNG data URL */
  onConfirm: (dataUrl: string) => void | Promise<void>;
}

export function AvatarCropDialog({
  open,
  onOpenChange,
  initialImage,
  title = "Ajustar foto",
  onConfirm,
}: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setImgSrc(initialImage ?? null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setSaving(false);
  }, [open, initialImage]);

  // Load image
  useEffect(() => {
    if (!imgSrc) {
      setImg(null);
      return;
    }
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => {
      setImg(i);
      // Fit cover: zoom = max(VIEW/iw, VIEW/ih)
      const base = Math.max(VIEW_SIZE / i.width, VIEW_SIZE / i.height);
      setZoom(base);
      setOffset({ x: 0, y: 0 });
    };
    i.src = imgSrc;
  }, [imgSrc]);

  // Redraw preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, VIEW_SIZE, VIEW_SIZE);
    if (img) {
      const w = img.width * zoom;
      const h = img.height * zoom;
      const x = (VIEW_SIZE - w) / 2 + offset.x;
      const y = (VIEW_SIZE - h) / 2 + offset.y;
      ctx.drawImage(img, x, y, w, h);
    }
  }, [img, zoom, offset]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    setOffset({
      x: dragStart.current.ox + (e.clientX - dragStart.current.x),
      y: dragStart.current.oy + (e.clientY - dragStart.current.y),
    });
  };
  const onPointerUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  const handleFile = (file: File) => {
    const r = new FileReader();
    r.onload = () => setImgSrc(r.result as string);
    r.readAsDataURL(file);
  };

  const handleConfirm = useCallback(async () => {
    if (!img) return;
    setSaving(true);
    try {
      const out = document.createElement("canvas");
      out.width = OUTPUT_SIZE;
      out.height = OUTPUT_SIZE;
      const ctx = out.getContext("2d")!;
      const scale = OUTPUT_SIZE / VIEW_SIZE;
      const w = img.width * zoom * scale;
      const h = img.height * zoom * scale;
      const x = (OUTPUT_SIZE - w) / 2 + offset.x * scale;
      const y = (OUTPUT_SIZE - h) / 2 + offset.y * scale;
      // Circular clip
      ctx.save();
      ctx.beginPath();
      ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      const dataUrl = out.toDataURL("image/png");
      await onConfirm(dataUrl);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }, [img, zoom, offset, onConfirm, onOpenChange]);

  const minZoom = img ? Math.max(VIEW_SIZE / img.width, VIEW_SIZE / img.height) * 0.5 : 0.1;
  const maxZoom = img ? Math.max(VIEW_SIZE / img.width, VIEW_SIZE / img.height) * 5 : 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs">
            Arraste para reposicionar e use o controle abaixo para ajustar o zoom.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div
            className="relative rounded-full overflow-hidden border border-border/40 cursor-grab active:cursor-grabbing"
            style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
          >
            <canvas
              ref={canvasRef}
              width={VIEW_SIZE}
              height={VIEW_SIZE}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className="touch-none select-none"
            />
            {!img && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-xs text-muted-foreground gap-2 pointer-events-none">
                <Upload className="h-6 w-6" />
                Escolha uma imagem
              </div>
            )}
          </div>

          {img && (
            <div className="w-full px-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">Zoom</span>
                <Slider
                  min={minZoom}
                  max={maxZoom}
                  step={0.01}
                  value={[zoom]}
                  onValueChange={(v) => setZoom(v[0])}
                  className="flex-1"
                />
                <button
                  onClick={() => {
                    setOffset({ x: 0, y: 0 });
                    if (img)
                      setZoom(Math.max(VIEW_SIZE / img.width, VIEW_SIZE / img.height));
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Resetar"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />

          <div className="flex items-center gap-2 w-full">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 px-3 py-2 text-xs rounded-full border border-border/40 bg-secondary/30 hover:bg-secondary/60 flex items-center justify-center gap-2"
            >
              <Upload className="h-3.5 w-3.5" />
              {img ? "Trocar imagem" : "Escolher imagem"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!img || saving}
              className="flex-1 px-3 py-2 text-xs rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
