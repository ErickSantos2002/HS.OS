/**
 * O player do áudio de uma mensagem de canal, resolvendo de onde ele vem.
 *
 * `anexo:<id>` (desde 13/10/2026): anexo privado, URL assinada de 5 minutos
 * pedida na hora por `AnexoResolvido` — e renovada se vencer com a aba aberta.
 * Qualquer outra coisa é URL antiga e toca como veio.
 */
import AnexoResolvido from "@/components/chat/AnexoResolvido";
import AudioMessagePlayer from "@/components/chat/AudioMessagePlayer";
import { idDoAnexoDeAudio } from "@/lib/audio-de-mensagem";

export default function AudioDaMensagem({ audioUrl }: { audioUrl: string }) {
  const id = idDoAnexoDeAudio(audioUrl);
  if (!id) return <AudioMessagePlayer src={audioUrl} />;
  return (
    <AnexoResolvido id={id}>
      {(url, renovar) => <AudioMessagePlayer src={url} onErro={renovar} />}
    </AnexoResolvido>
  );
}
