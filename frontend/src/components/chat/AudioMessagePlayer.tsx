import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface AudioMessagePlayerProps {
  src: string;
  className?: string;
  /** Chamado quando o arquivo não carrega — ex.: URL assinada que venceu. */
  onErro?: () => void;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function readDuration(audio: HTMLAudioElement): number | null {
  const d = audio.duration;
  if (Number.isFinite(d) && d > 0) return d;
  try {
    if (audio.seekable && audio.seekable.length > 0) {
      const end = audio.seekable.end(audio.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    // ignore
  }
  return null;
}

export default function AudioMessagePlayer({ src, className, onErro }: AudioMessagePlayerProps) {
  const onErroRef = useRef(onErro);
  onErroRef.current = onErro;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLButtonElement | null>(null);
  const suppressTransitionRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setHasError(false);

    const tryResolveDuration = () => {
      const d = readDuration(audio);
      if (d != null) setDuration(d);
    };

    // ⚠️ Não pular para o fim para descobrir a duração. Era o que este player
    // fazia (`currentTime = MAX_SAFE_INTEGER`), e no webm sem índice o pulo às
    // vezes quebra o `<audio>` com "demuxer seek failed": 0:00 na tela e áudio
    // mudo para quem recebe (13/10/2026). Áudio gravado daqui em diante já nasce
    // com a duração (`lib/duracao-gravacao.ts`); o antigo mostra a duração
    // quando termina de tocar.
    const handleLoadedMetadata = () => {
      setHasError(false);
      tryResolveDuration();
    };

    const handleDurationChange = tryResolveDuration;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    const handleEnded = () => {
      const d = readDuration(audio);
      if (d != null) {
        setDuration(d);
        setCurrentTime(d);
      }
      setIsPlaying(false);
    };

    const handleError = () => {
      setHasError(true);
      setIsPlaying(false);
      onErroRef.current?.();
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    // In case metadata is already loaded (cached)
    if (audio.readyState >= 1) handleLoadedMetadata();

    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [src]);

  const hasResolvedDuration = duration > 0;

  const progressPercent = useMemo(() => {
    if (!hasResolvedDuration) return 0;
    return Math.min(100, Math.max(0, (currentTime / duration) * 100));
  }, [currentTime, duration, hasResolvedDuration]);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    if (duration > 0 && currentTime >= duration) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }

    try {
      // Elemento em erro não toca de novo sozinho: recarrega antes de tentar.
      if (audio.error) audio.load();
      await audio.play();
      setHasError(false);
    } catch {
      setHasError(true);
      setIsPlaying(false);
    }
  }, [currentTime, duration, isPlaying]);

  const seek = useCallback(
    (clientX: number) => {
      const audio = audioRef.current;
      const progress = progressRef.current;

      if (!audio || !progress || !hasResolvedDuration) return;

      const rect = progress.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const nextTime = duration * ratio;

      suppressTransitionRef.current = true;
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
      // re-enable transition next tick
      requestAnimationFrame(() => {
        suppressTransitionRef.current = false;
      });
    },
    [duration, hasResolvedDuration],
  );

  const transitionStyle = suppressTransitionRef.current
    ? { transition: "none" as const }
    : { transition: "width 120ms linear, left 120ms linear" };

  return (
    <div
      className={cn(
        "group relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-full border border-border/70 bg-card/80 px-3 py-2 shadow-[0_10px_30px_-20px_hsl(var(--foreground)/0.45)] backdrop-blur-md",
        "before:absolute before:inset-y-2 before:left-2 before:w-16 before:rounded-full before:bg-primary/10 before:blur-2xl before:content-['']",
        className,
      )}
    >
      <audio ref={audioRef} preload="metadata" src={src} />

      <button
        type="button"
        onClick={togglePlayback}
        className="relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/60 bg-background/80 text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        aria-label={isPlaying ? "Pausar áudio" : "Reproduzir áudio"}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>

      <button
        ref={progressRef}
        type="button"
        onClick={(event) => seek(event.clientX)}
        className="relative z-10 flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left"
        aria-label="Avançar no áudio"
      >
        <div className="relative h-5 w-full">
          <span className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted/80" />
          <span
            className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
            style={{ width: `${progressPercent}%`, ...transitionStyle }}
          />
          <span
            className={cn(
              "absolute top-1/2 h-3.5 w-3.5 rounded-full border border-primary/30 bg-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.15)] will-change-transform",
            )}
            style={{
              left: `${progressPercent}%`,
              transform: `translate(-50%, -50%) ${isPlaying ? "scale(1.1)" : "scale(1)"}`,
              ...transitionStyle,
            }}
          />
        </div>

        <div className="flex w-full items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-medium text-foreground/90">{isPlaying ? "Reproduzindo" : "Mensagem de voz"}</span>
          <span className="shrink-0 tabular-nums">
            {formatTime(currentTime)} / {hasResolvedDuration ? formatTime(duration) : "--:--"}
          </span>
        </div>
      </button>

      <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/70 text-muted-foreground">
        <Volume2 className="h-4 w-4" />
      </div>

      {hasError && <span className="absolute inset-x-3 -bottom-5 text-[10px] text-destructive">Não foi possível reproduzir este áudio.</span>}
    </div>
  );
}
