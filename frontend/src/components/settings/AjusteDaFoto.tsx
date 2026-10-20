import { useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Recorta a área escolhida e reduz para 256x256 WebP — avatar não precisa de
 *  mais, e a foto do celular chega com vários MB. */
export async function recortarFoto(arquivo: File, area: Area): Promise<File> {
  const bitmap = await createImageBitmap(arquivo);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, 256, 256);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.9));
  if (!blob) throw new Error("Não consegui processar a imagem.");
  return new File([blob], "avatar.webp", { type: "image/webp" });
}

/** Ajuste da foto de perfil antes de salvar: arrastar para posicionar, zoom
 *  pelo controle, pela rodinha ou por pinça. A máscara redonda mostra
 *  exatamente o que vai aparecer no avatar. Mesmo desenho do TaskHS.
 *
 *  Existe porque a foto era usada inteira e o avatar redondo cortava o que
 *  caísse fora do centro — na do Erick, um pedaço da cabeça (20/10/2026). */
export function AjusteDaFoto({ src, enviando, onCancelar, onConfirmar }: {
  src: string | null;
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (area: Area) => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);

  return (
    <Dialog open={!!src} onOpenChange={(aberto) => { if (!aberto && !enviando) onCancelar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar foto</DialogTitle>
        </DialogHeader>

        {src && (
          <div className="relative h-72 w-full overflow-hidden rounded-xl bg-black">
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={4}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, pixels) => setArea(pixels)}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-primary"
            aria-label="Zoom da foto"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Arraste a foto para posicionar. Use o controle ou a rodinha do mouse para aproximar.
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancelar}
            disabled={enviando}
            className="text-xs px-3 py-1.5 rounded-md text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => area && onConfirmar(area)}
            disabled={!area || enviando}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {enviando ? "Enviando..." : "Usar foto"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
