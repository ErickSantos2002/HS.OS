import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
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

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Optional initial image (URL or data URL) to start editing from */
  initialImage?: string | null;
  title?: string;
  /** Called with the cropped PNG data URL */
  onConfirm: (dataUrl: string) => void | Promise<void>;
}

/** Recorta a área escolhida num PNG redondo de 512x512.
 *
 *  `crossOrigin` porque a imagem inicial costuma ser a foto atual, servida
 *  pelo R2: sem ele o canvas fica "contaminado" e o `toDataURL` lança. */
async function recortar(src: string, area: Area): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Não consegui abrir a imagem."));
    i.src = src;
  });
  const out = document.createElement("canvas");
  out.width = OUTPUT_SIZE;
  out.height = OUTPUT_SIZE;
  const ctx = out.getContext("2d")!;
  ctx.save();
  ctx.beginPath();
  ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  ctx.restore();
  return out.toDataURL("image/png");
}

/** Ajuste de foto — perfil, pessoas e agentes, o único do sistema.
 *
 *  Desde 20/10/2026 o miolo é o `react-easy-crop`, o mesmo do TaskHS: arrastar
 *  para posicionar e zoom pelo controle, pela rodinha ou por pinça. O canvas
 *  feito à mão que estava aqui não tinha rodinha nem pinça, e a tela de perfil
 *  chegou a ganhar um segundo recortador por ninguém ter achado este. */
export function AvatarCropDialog({
  open,
  onOpenChange,
  initialImage,
  title = "Ajustar foto",
  onConfirm,
}: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setImgSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setSaving(false);
    setErro(null);
    if (!initialImage) return;
    // ⚠️ **A foto já salva quase nunca reabre aqui.** Ela vem de
    // `/storage/agent-files/...`, que redireciona para o R2; num redirect entre
    // origens o navegador manda `Origin: null`, e o CORS do bucket só libera o
    // site e o localhost. Sem `crossOrigin` a imagem até aparece, mas o canvas
    // fica contaminado e o "Salvar" lança — era o que acontecia antes, calado.
    // Testar antes e pedir o arquivo é melhor que deixar ajustar e falhar no fim.
    let cancelado = false;
    const teste = new Image();
    teste.crossOrigin = "anonymous";
    teste.onload = () => { if (!cancelado) setImgSrc(initialImage); };
    teste.onerror = () => {
      if (!cancelado) setErro("Não deu para reabrir a foto atual. Escolha o arquivo da imagem para ajustar.");
    };
    teste.src = initialImage;
    return () => { cancelado = true; };
  }, [open, initialImage]);

  const handleFile = (file: File) => {
    const r = new FileReader();
    r.onload = () => {
      setImgSrc(r.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setErro(null);
    };
    r.readAsDataURL(file);
  };

  const handleConfirm = async () => {
    if (!imgSrc || !area) return;
    setSaving(true);
    setErro(null);
    try {
      await onConfirm(await recortar(imgSrc, area));
      onOpenChange(false);
    } catch (e) {
      setErro((e as Error).message || "Não consegui processar a imagem.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs">
            Arraste a foto para posicionar. Use o controle, a rodinha do mouse ou a pinça para aproximar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="relative h-72 w-full overflow-hidden rounded-xl bg-black">
            {imgSrc ? (
              <Cropper
                image={imgSrc}
                crop={crop}
                zoom={zoom}
                minZoom={1}
                maxZoom={4}
                aspect={1}
                cropShape="round"
                showGrid={false}
                mediaProps={{ crossOrigin: "anonymous" }}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
              />
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center text-xs text-muted-foreground gap-2"
              >
                <Upload className="h-6 w-6" />
                Escolha uma imagem
              </button>
            )}
          </div>

          {imgSrc && (
            <div className="w-full px-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">Zoom</span>
                <Slider
                  min={1}
                  max={4}
                  step={0.01}
                  value={[zoom]}
                  onValueChange={(v) => setZoom(v[0])}
                  className="flex-1"
                  aria-label="Zoom da foto"
                />
                <button
                  onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(1); }}
                  className="text-muted-foreground hover:text-foreground"
                  title="Resetar"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {erro && <p className="w-full px-2 text-xs text-destructive">{erro}</p>}

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
              disabled={saving}
              className="flex-1 px-3 py-2 text-xs rounded-full border border-border/40 bg-secondary/30 hover:bg-secondary/60 flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Upload className="h-3.5 w-3.5" />
              {imgSrc ? "Trocar imagem" : "Escolher imagem"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!imgSrc || !area || saving}
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
