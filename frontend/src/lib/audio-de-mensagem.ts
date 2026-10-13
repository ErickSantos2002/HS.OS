/**
 * Como a mensagem de canal aponta para o áudio dela.
 *
 * Desde 13/10/2026 o áudio é um anexo privado (bucket `anexos`, lido só por
 * membro do canal) e `channel_messages.audio_url` guarda `anexo:<id>`. Antes
 * era a URL pública de `audio-messages`, que qualquer um com o link ouvia.
 */
import { enviarAnexo } from "@/lib/anexos";
import { getAudioFileExtension } from "@/hooks/use-audio-recorder";

const PREFIXO = "anexo:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function referenciaDeAudio(anexoId: string): string {
  return `${PREFIXO}${anexoId}`;
}

export function idDoAnexoDeAudio(audioUrl: string | null | undefined): string | null {
  if (!audioUrl?.startsWith(PREFIXO)) return null;
  const id = audioUrl.slice(PREFIXO.length);
  return UUID.test(id) ? id : null;
}

/** Sobe a gravação como anexo privado do canal e devolve o que vai em `audio_url`. */
export async function enviarAudioDoCanal(
  channelId: string,
  blob: Blob,
  enviar: typeof enviarAnexo = enviarAnexo,
): Promise<string> {
  const nome = `audio.${getAudioFileExtension(blob.type)}`;
  const arquivo = new File([blob], nome, { type: blob.type });
  const anexo = await enviar({ contexto: "canal", channelId }, arquivo);
  return referenciaDeAudio(anexo.id);
}
