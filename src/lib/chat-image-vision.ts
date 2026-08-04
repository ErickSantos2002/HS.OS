import { supabase } from "@/integrations/supabase/client";
import type { MediaAttachment } from "@/lib/mock-data";

const IMAGE_VISION_FUNCTION = "chat-image-vision";
const imageVisionCache = new Map<string, string>();

function isNonBlockingVisionError(status: number, payload: unknown) {
  if (status === 402 || status === 429) return true;
  if (!payload || typeof payload !== "object") return false;

  const maybePayload = payload as { error?: unknown; details?: unknown };
  const errorText = typeof maybePayload.error === "string" ? maybePayload.error.toLowerCase() : "";
  const detailsText = typeof maybePayload.details === "string" ? maybePayload.details.toLowerCase() : "";

  return (
    errorText.includes("créditos insuficientes") ||
    errorText.includes("rate limits") ||
    detailsText.includes("payment_required") ||
    detailsText.includes("not enough credits")
  );
}

function buildAttachmentCacheKey(attachment: MediaAttachment) {
  return attachment.url || attachment.base64 || `${attachment.name ?? "image"}:${attachment.size ?? 0}:${attachment.mimeType}`;
}

function cleanDataUrl(dataUrl: string) {
  return dataUrl.trim().replace(/\s/g, "");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function attachmentToImageDataUrl(attachment: MediaAttachment): Promise<string | null> {
  const raw = attachment.base64?.trim();
  if (raw?.startsWith("data:image/")) {
    return cleanDataUrl(raw);
  }

  const sourceUrl = attachment.url || raw;
  if (!sourceUrl) return null;

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Falha ao ler imagem (${response.status})`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    return null;
  }

  return cleanDataUrl(await blobToDataUrl(blob));
}

async function requestVisionSummary(imageDataUrl: string, fileName?: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${IMAGE_VISION_FUNCTION}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ imageDataUrl, fileName }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    if (isNonBlockingVisionError(response.status, payload)) {
      console.warn("[chat-image-vision] Vision unavailable, skipping readable summary.", {
        status: response.status,
        fileName,
      });
      return "";
    }

    throw new Error(payload?.error || `Falha ao analisar imagem (${response.status})`);
  }

  return typeof payload?.summary === "string" ? payload.summary.trim() : "";
}

export async function getAgentReadableImageContext(attachment: MediaAttachment): Promise<string | null> {
  const cacheKey = buildAttachmentCacheKey(attachment);
  const cached = imageVisionCache.get(cacheKey);
  if (cached) return cached;

  const imageDataUrl = await attachmentToImageDataUrl(attachment);
  if (!imageDataUrl) return null;

  const summary = await requestVisionSummary(imageDataUrl, attachment.name);
  if (!summary) return null;

  imageVisionCache.set(cacheKey, summary);
  return summary;
}
