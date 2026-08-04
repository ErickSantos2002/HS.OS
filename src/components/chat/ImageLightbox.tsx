import { Dialog, DialogContent } from "@/components/ui/dialog";

interface ImageLightboxProps {
  open: boolean;
  src: string | null;
  alt?: string;
  onOpenChange: (open: boolean) => void;
}

export default function ImageLightbox({ open, src, alt, onOpenChange }: ImageLightboxProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl border-none bg-transparent p-2 shadow-none">
        {src ? (
          <img
            src={src}
            alt={alt ?? "Visualização ampliada"}
            className="max-h-[85vh] w-full rounded-xl object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}