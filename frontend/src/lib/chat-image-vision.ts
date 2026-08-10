import { api } from "@/lib/api";
import type { MediaAttachment } from "@/lib/mock-data";

const imageVisionCache = new Map<string, string>();


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
  try {
    const { description } = await api<{ description: string }>("/ia/descrever-imagem", {
      method: "POST",
      body: { image_data_url: imageDataUrl, file_name: fileName },
    });
    return description ?? "";
  } catch (e) {
    // ⚠️ Falha de visão **não bloqueia a mensagem**. A descrição é um extra
    // para o agente (que é de texto) entender a imagem; sem ela a pessoa ainda
    // manda o anexo e conversa. Era assim na edge e continua sendo.
    console.warn("[visão] indisponível, seguindo sem a descrição:", (e as Error).message);
    return "";
  }

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
