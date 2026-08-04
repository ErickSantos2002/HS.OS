import { useState, useCallback, useRef, useEffect } from "react";
import type { MediaAttachment } from "@/lib/mock-data";
import {
  isImageFile,
  isAcceptedFile,
  uploadFileToStorage,
  formatFileSize,
  MAX_UPLOAD_SIZE,
} from "@/lib/file-upload";
import { toast } from "sonner";

/* ── SpeechRecognition type shim ── */
type SpeechRecognitionType = typeof window extends { SpeechRecognition: infer T } ? T : any;

function getSpeechRecognition(): SpeechRecognitionType | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function useChatMedia() {
  /* ── Staged attachments (pending send) ── */
  const [staged, setStaged] = useState<MediaAttachment[]>([]);
  const MAX_IMAGE_DIMENSION = 1800;
  const SCREENSHOT_NAME_RE = /(screenshot|screen[_ -]?shot|captura[_ -]?de[_ -]?tela)/i;
  const MAX_ATTACHMENTS = 10;

  const addStaged = useCallback((att: MediaAttachment) => {
    setStaged((prev) => {
      if (prev.length >= MAX_ATTACHMENTS) {
        toast.error(`Limite de ${MAX_ATTACHMENTS} anexos atingido.`);
        return prev;
      }
      return [...prev, att];
    });
  }, []);

  const removeStaged = useCallback((index: number) => {
    setStaged((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearStaged = useCallback(() => setStaged([]), []);

  /* ── Preserve image detail for screenshots and UI references ── */
  const compressImage = useCallback(
    (file: File, maxDimension = MAX_IMAGE_DIMENSION): Promise<{ dataUrl: string; mimeType: string }> => {
      return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
          try {
            const canvas = document.createElement("canvas");
            let { width, height } = img;

            if (width > maxDimension || height > maxDimension) {
              const ratio = Math.min(maxDimension / width, maxDimension / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas indisponível");

            ctx.drawImage(img, 0, 0, width, height);

            const preserveLossless =
              file.type === "image/png" ||
              file.type === "image/webp" ||
              SCREENSHOT_NAME_RE.test(file.name);

            const mimeType = preserveLossless
              ? file.type === "image/webp"
                ? "image/webp"
                : "image/png"
              : "image/jpeg";

            const dataUrl =
              mimeType === "image/jpeg"
                ? canvas.toDataURL(mimeType, 0.92)
                : canvas.toDataURL(mimeType);

            resolve({ dataUrl, mimeType });
          } catch (error) {
            reject(error);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        };

        img.onerror = (error) => {
          URL.revokeObjectURL(objectUrl);
          reject(error);
        };

        img.src = objectUrl;
      });
    },
    [MAX_IMAGE_DIMENSION]
  );

  /* ── Process a single file (image or any other) ── */
  const processFile = useCallback(async (file: File) => {
    if (!isAcceptedFile(file)) {
      toast.error(`Arquivo "${file.name}" excede o limite de 50MB.`);
      return;
    }

    if (isImageFile(file)) {
      try {
        const { dataUrl, mimeType } = await compressImage(file);
        addStaged({ type: "image", mimeType, base64: dataUrl, name: file.name, size: file.size });
      } catch (err) {
        console.error("Erro ao anexar imagem:", err);
      }
    } else {
      // Any non-image file
      try {
        addStaged({
          type: "file",
          mimeType: file.type || "application/octet-stream",
          base64: "",
          name: file.name,
          size: file.size,
          _rawFile: file,
        } as any);
      } catch (err) {
        console.error("Erro ao processar arquivo:", err);
        toast.error(`Erro ao processar "${file.name}".`);
      }
    }
  }, [compressImage, addStaged]);

  /* ── Stage a large pasted text block as a .txt attachment (Claude-style) ── */
  const PASTED_TEXT_THRESHOLD = 10000;
  const stagePastedText = useCallback((text: string): boolean => {
    if (!text || text.length < PASTED_TEXT_THRESHOLD) return false;
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    const name = `Texto colado ${stamp}.txt`;
    try {
      const file = new File([text], name, { type: "text/plain" });
      void processFile(file);
      return true;
    } catch (err) {
      console.warn("[use-chat-media] stagePastedText failed:", err);
      return false;
    }
  }, [processFile]);

  /* ── Extract text locally from a raw File ── */
  const extractTextLocally = useCallback(async (file: File): Promise<string> => {
    const name = file.name.toLowerCase();

    // Plain text files: read directly
    if (/\.(txt|md|csv|json|yaml|yml|toml|xml|html|css|js|ts|py|sql|log|tsx|jsx)$/i.test(name)) {
      return await file.text();
    }

    // DOCX: use mammoth.js
    if (/\.docx$/i.test(name)) {
      try {
        const mammoth = await import("mammoth");
        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        return result.value || "";
      } catch (err) {
        console.warn("[use-chat-media] mammoth extraction failed:", err);
        return "";
      }
    }

    // PDF: try local extraction from extractDocumentText
    if (/\.pdf$/i.test(name)) {
      try {
        const { extractDocumentText } = await import("@/lib/file-upload");
        const { text } = await extractDocumentText(file);
        return text || "";
      } catch (err) {
        console.warn("[use-chat-media] PDF extraction failed:", err);
        return "";
      }
    }

    return "";
  }, []);

  /* ── Upload staged files to storage and return finalized attachments ── */
  const finalizeStaged = useCallback(async (bucketPath: string): Promise<MediaAttachment[]> => {
    const finalized: MediaAttachment[] = [];
    for (const att of staged) {
      if (att.type === "file") {
        const raw = (att as any)._rawFile as File | undefined;
        if (raw) {
          try {
            const url = await uploadFileToStorage(bucketPath, raw);
            const mimeType = att.mimeType || raw.type || "application/octet-stream";

            finalized.push({
              type: "file",
              mimeType,
              base64: url,
              name: att.name,
              size: att.size,
              url,
              _rawFile: raw,
            } as any);
          } catch (err: any) {
            toast.error(`Falha no upload de "${att.name}": ${err.message}`);
          }
        } else {
          finalized.push(att);
        }
      } else if (att.type === "image") {
        try {
          const blob = await fetch(att.base64).then((r) => r.blob());
          const outputType = att.mimeType || blob.type || "image/jpeg";
          const fallbackExtension = outputType === "image/png" ? "png" : outputType === "image/webp" ? "webp" : "jpg";
          const file = new File([blob], att.name || `image.${fallbackExtension}`, { type: outputType });
          const url = await uploadFileToStorage(bucketPath, file);
          finalized.push({ ...att, url });
        } catch {
          finalized.push(att); // fallback to base64
        }
      } else {
        finalized.push(att);
      }
    }
    return finalized;
  }, [staged]);

  /* ── File picker (all types) ── */
  const openFilePicker = useCallback((accept: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    // iOS Safari requires the input to be in the DOM
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    input.style.left = "-9999px";
    document.body.appendChild(input);

    const cleanup = () => {
      try { document.body.removeChild(input); } catch { /* noop */ }
    };

    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files) {
        for (const file of Array.from(files)) {
          await processFile(file);
        }
      }
      cleanup();
    };
    // Fallback cleanup if user cancels (focus returns to window)
    window.addEventListener("focus", () => setTimeout(cleanup, 1500), { once: true });

    input.click();
  }, [processFile]);

  const pickFile = useCallback(() => openFilePicker("*/*"), [openFilePicker]);

  /* ── Image picker ── */
  const pickImage = useCallback(() => openFilePicker("image/*"), [openFilePicker]);

  /* ── Handle paste / drop → image + documents ── */
  const handlePasteOrDrop = useCallback(
    async (dataTransfer: DataTransfer) => {
      // Snapshot files synchronously — DataTransfer becomes detached after the first await
      const files: File[] = [];
      if (dataTransfer.items && dataTransfer.items.length > 0) {
        for (const item of Array.from(dataTransfer.items)) {
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      } else if (dataTransfer.files && dataTransfer.files.length > 0) {
        for (const f of Array.from(dataTransfer.files)) files.push(f);
      }

      for (const file of files) {
        await processFile(file);
      }
    },
    [processFile]
  );

  /* ── Speech-to-text recording ── */
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);
  const finalTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");

  const startRecording = useCallback(async () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      toast.error("Seu navegador não suporta reconhecimento de voz. Use Chrome, Edge ou Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = true;
    recognition.interimResults = true;

    finalTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");

    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      finalTranscriptRef.current = final;
      interimTranscriptRef.current = interim;
      setTranscript(final);
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        toast.error("Permissão de microfone negada.");
      }
    };

    recognition.onend = () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch {}
      }
    };

    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
    setRecordingTime(0);
    timerRef.current = window.setInterval(() => setRecordingTime((t) => t + 1), 1000);
  }, []);

  const stopRecording = useCallback((): Promise<string> => {
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    const ref = recognitionRef.current;

    return new Promise((resolve) => {
      const collect = () => {
        recognitionRef.current = null;
        if (ref) {
          try { ref.stop(); } catch {}
        }
        const result = (finalTranscriptRef.current + " " + interimTranscriptRef.current).trim();
        finalTranscriptRef.current = "";
        interimTranscriptRef.current = "";
        setTranscript("");
        setInterimTranscript("");
        resolve(result);
      };

      if (!ref) {
        collect();
        return;
      }

      setTimeout(collect, 1200);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        const ref = recognitionRef.current;
        recognitionRef.current = null;
        try { ref.stop(); } catch {}
      }
    };
  }, []);

  /* ── Build OpenAI vision-format content array ── */
  const buildContent = useCallback(
    (text: string, media: MediaAttachment[]) => {
      if (media.length === 0) return text;

      const images = media.filter((m) => m.type === "image");
      const docs = media.filter((m) => m.type === "file" && m.extractedText);

      if (images.length === 0 && docs.length === 0) return text;

      const parts: any[] = [];

      // Add document text as context
      if (docs.length > 0) {
        const docContext = docs
          .map((d) => `[Conteúdo de ${d.name}]:\n${d.extractedText}`)
          .join("\n\n");
        parts.push({ type: "text", text: docContext });
      }

      if (text.trim()) {
        parts.push({ type: "text", text });
      } else if (images.length === 0) {
        parts.push({ type: "text", text: "[documento anexado]" });
      } else {
        parts.push({ type: "text", text: "[image]" });
      }

      for (const img of images) {
        const imgUrl = img.url || img.base64;
        parts.push({ type: "image_url", image_url: { url: imgUrl } });
      }

      return parts;
    },
    []
  );

  return {
    staged,
    addStaged,
    removeStaged,
    clearStaged,
    pickImage,
    pickFile,
    handlePasteOrDrop,
    stagePastedText,
    finalizeStaged,
    recording,
    recordingTime,
    transcript,
    interimTranscript,
    startRecording,
    stopRecording,
    buildContent,
  };
}
