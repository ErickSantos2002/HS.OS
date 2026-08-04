import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const AUDIO_RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function getSupportedAudioRecordingMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  return AUDIO_RECORDING_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

export function getAudioFileExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3";
  if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "m4a";

  return "webm";
}

function stopMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preferredMimeTypeRef = useRef("");

  const resetState = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    mediaRecorderRef.current = null;
    preferredMimeTypeRef.current = "";
    setIsRecording(false);
    setDuration(0);
  }, []);

  const cleanupStream = useCallback(() => {
    stopMediaStream(mediaStreamRef.current);
    mediaStreamRef.current = null;
  }, []);

  const start = useCallback(async (): Promise<MediaStream | null> => {
    if (isRecording || isProcessing) return null;

    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Seu celular não suporta gravação de áudio neste navegador.");
      return null;
    }

    if (typeof MediaRecorder === "undefined") {
      toast.error("A gravação de áudio não está disponível neste dispositivo.");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      cleanupStream();
      mediaStreamRef.current = stream;

      const preferredMimeType = getSupportedAudioRecordingMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);

      preferredMimeTypeRef.current = preferredMimeType || recorder.mimeType || "";
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("Audio recorder error:", event);
      };

      mediaRecorderRef.current = recorder;
      // iOS Safari requires an explicit timeslice or `dataavailable` never fires
      // and the recorded blob ends up empty on stop. Emit a chunk every second.
      recorder.start(1000);

      setIsRecording(true);
      setDuration(0);

      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setDuration((value) => value + 1), 1000);

      return stream;
    } catch (error: any) {
      console.error("Mic access denied:", error);
      cleanupStream();
      resetState();

      if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
        toast.error("O microfone requer uma conexão segura (HTTPS).");
      } else if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
        toast.error("Permissão do microfone negada. Permita o acesso nas configurações do navegador.");
      } else if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
        toast.error("Nenhum microfone encontrado neste dispositivo.");
      } else {
        toast.error("Não foi possível iniciar a gravação de áudio.");
      }
      return null;
    }
  }, [cleanupStream, isProcessing, isRecording, resetState]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        console.log("[audio-recorder] stop called but recorder inactive");
        cleanupStream();
        resetState();
        resolve(null);
        return;
      }

      let settled = false;
      let stopFired = false;
      let dataAfterStop = false;

      const finalize = () => {
        if (settled) return;
        settled = true;

        console.log("[audio-recorder] finalize — chunks:", chunksRef.current.length, "sizes:", chunksRef.current.map(c => c.size));

        const mimeType =
          chunksRef.current.find((chunk) => chunk.size > 0)?.type ||
          recorder.mimeType ||
          preferredMimeTypeRef.current ||
          "audio/webm";

        const blob = chunksRef.current.length > 0
          ? new Blob(chunksRef.current, { type: mimeType })
          : null;

        cleanupStream();
        resetState();

        console.log("[audio-recorder] final blob:", blob ? `${blob.size} bytes, type=${blob.type}` : "null");
        resolve(blob && blob.size > 0 ? blob : null);
      };

      const tryFinalize = () => {
        // On iOS Safari, dataavailable may fire after stop.
        // Wait for stop event, then give a short window for any final dataavailable.
        if (stopFired) {
          dataAfterStop = true;
          window.setTimeout(finalize, 150);
        }
      };

      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;

      // CRITICAL: Remove the original ondataavailable handler to prevent duplicate chunks
      recorder.ondataavailable = null;

      // Capture any final data chunks after stop
      const handleDataAfterStop = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          console.log("[audio-recorder] dataavailable after stop:", event.data.size);
          chunksRef.current.push(event.data);
        }
        tryFinalize();
      };

      recorder.addEventListener("dataavailable", handleDataAfterStop);

      recorder.addEventListener("stop", () => {
        console.log("[audio-recorder] stop event fired, chunks so far:", chunksRef.current.length);
        stopFired = true;
        // Give iOS Safari time to fire final dataavailable
        window.setTimeout(() => {
          recorder.removeEventListener("dataavailable", handleDataAfterStop);
          finalize();
        }, 300);
      }, { once: true });

      recorder.addEventListener("error", () => {
        console.error("[audio-recorder] error event during stop");
        recorder.removeEventListener("dataavailable", handleDataAfterStop);
        finalize();
      }, { once: true });

      try {
        if (typeof recorder.requestData === "function" && recorder.state === "recording") {
          recorder.requestData();
        }
      } catch (error) {
        console.warn("[audio-recorder] requestData failed:", error);
      }

      try {
        recorder.stop();
      } catch (error) {
        console.error("[audio-recorder] stop() failed:", error);
        recorder.removeEventListener("dataavailable", handleDataAfterStop);
        finalize();
        return;
      }

      // Safety timeout
      window.setTimeout(() => {
        recorder.removeEventListener("dataavailable", handleDataAfterStop);
        finalize();
      }, 2000);
    });
  }, [cleanupStream, resetState]);

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;

    chunksRef.current = [];

    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        cleanupStream();
        resetState();
      };

      try {
        recorder.stop();
        return;
      } catch (error) {
        console.error("Audio recorder cancel failed:", error);
      }
    }

    cleanupStream();
    resetState();
  }, [cleanupStream, resetState]);

  useEffect(() => {
    return () => {
      chunksRef.current = [];
      cleanupStream();
      resetState();
    };
  }, [cleanupStream, resetState]);

  return { isRecording, duration, isProcessing, setIsProcessing, start, stop, cancel };
}