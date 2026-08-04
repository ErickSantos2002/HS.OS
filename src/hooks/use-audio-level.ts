import { useState, useRef, useCallback, useEffect } from "react";

const BAR_COUNT = 64;

/**
 * Uses Web Audio API AnalyserNode to report real-time mic frequency bars (0–1 each).
 * Returns `bars` array updated via rAF for waveform visualization.
 */
export function useAudioLevel() {
  const [bars, setBars] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const externalRef = useRef(false);
  const rafRef = useRef<number>(0);

  const startAnalyser = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.6;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -10;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const binCount = data.length;
      const result = new Array(BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) {
        const binIndex = Math.floor((i / BAR_COUNT) * binCount);
        const raw = data[binIndex] / 255;
        result[i] = Math.min(1, raw * 1.3);
      }
      setBars(result);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  /** Start with own getUserMedia (standalone usage) */
  const start = useCallback(async (externalStream?: MediaStream) => {
    try {
      let stream: MediaStream;
      if (externalStream) {
        stream = externalStream;
        externalRef.current = true;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        externalRef.current = false;
      }
      streamRef.current = stream;
      startAnalyser(stream);
    } catch {
      // mic permission denied
    }
  }, [startAnalyser]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    // Only stop tracks if we own the stream
    if (!externalRef.current) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    externalRef.current = false;
    ctxRef.current?.close();
    ctxRef.current = null;
    analyserRef.current = null;
    setBars(new Array(BAR_COUNT).fill(0));
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (!externalRef.current) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      }
      ctxRef.current?.close();
    };
  }, []);

  return { bars, start, stop };
}
