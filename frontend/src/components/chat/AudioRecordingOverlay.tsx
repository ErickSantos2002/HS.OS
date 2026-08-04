import { Loader2, X, Check } from "lucide-react";
import { AiLoader } from "@/components/ui/ai-loader";

interface AudioRecordingOverlayProps {
  bars: number[];
  duration: number;
  isProcessing: boolean;
  onCancel: () => void;
  onTranscribe: () => void;
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AudioRecordingOverlay({
  bars,
  duration,
  isProcessing,
  onCancel,
  onTranscribe,
}: AudioRecordingOverlayProps) {
  const raw = Array.isArray(bars) ? bars : [];
  const half = raw.slice(0, Math.ceil(raw.length / 2));
  const mirrored = [...half].reverse().concat(half);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-xl">
      {/* Animated orb */}
      <div className="mb-8">
        <AiLoader size={140} text={isProcessing ? "Processando..." : "Ouvindo..."} />
      </div>

      {/* Waveform */}
      {!isProcessing && (
        <div className="flex items-center gap-[1px] h-10 w-64 justify-center mb-4">
          {mirrored.map((v, i) => {
            const center = mirrored.length / 2;
            const norm = (i - center) / center;
            const gauss = Math.exp(-2.2 * norm * norm);
            const boosted = Math.min(1, v * 2.5);
            const h = Math.max(2, boosted * 40 * gauss + 3 * gauss);
            return (
              <div
                key={i}
                className="w-[2px] rounded-full bg-primary/70"
                style={{ height: `${h}px`, transition: "height 90ms ease-out" }}
              />
            );
          })}
        </div>
      )}

      {/* Timer */}
      <p className="text-lg font-mono text-muted-foreground mb-10">
        {formatDuration(duration)}
      </p>

      {/* Action buttons */}
      <div className="flex items-center gap-6">
        {/* Cancel */}
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-border/40 bg-secondary/30 text-muted-foreground hover:bg-destructive/20 hover:text-destructive hover:border-destructive/40 transition-colors disabled:opacity-40"
          title="Cancelar"
        >
          <X className="h-6 w-6" />
        </button>

        {/* Transcribe */}
        <button
          onClick={onTranscribe}
          disabled={isProcessing}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:bg-primary/90 transition-colors disabled:opacity-60"
          title="Transcrever para texto"
        >
          {isProcessing ? (
            <Loader2 className="h-7 w-7 animate-spin" />
          ) : (
            <Check className="h-7 w-7" />
          )}
        </button>

      </div>
    </div>
  );
}
