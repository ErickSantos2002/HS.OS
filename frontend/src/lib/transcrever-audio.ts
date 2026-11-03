/**
 * Manda o áudio gravado para `/ia/transcrever` e devolve o texto.
 * Lança se a transcrição falhar — cada tela decide o que fazer: o canal manda
 * o áudio assim mesmo, a conversa com agente não manda (o agente não ouve).
 */
import { api } from "@/lib/api";
import { getAudioFileExtension } from "@/hooks/use-audio-recorder";

export async function transcreverAudio(blob: Blob): Promise<string> {
  const formData = new FormData();
  // ⚠️ O campo chama `arquivo` (a rota é nossa agora, não a edge).
  formData.append("arquivo", blob, `audio.${getAudioFileExtension(blob.type)}`);
  const r = await api<{ text: string }>("/ia/transcrever", { method: "POST", body: formData });
  return r?.text ?? "";
}
