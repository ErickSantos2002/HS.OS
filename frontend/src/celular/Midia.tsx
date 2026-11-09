/**
 * Anexos dentro da bolha — imagem, áudio e arquivo, com a URL resolvida na
 * hora (`AnexoResolvido`: anexo privado tem URL de 5 minutos).
 */
import AnexoResolvido from "@/components/chat/AnexoResolvido";
import CartaoAprovacaoEmail from "@/components/chat/CartaoAprovacaoEmail";
import CartaoAcao from "@/components/chat/CartaoAcao";
import RecadoLembrete from "@/components/chat/RecadoLembrete";
import type { ChannelAttachment } from "@/hooks/use-channels";
import type { MediaAttachment } from "@/lib/mock-data";
import { CartaoDeArquivo, ImagemDaBolha, PlayerDeAudio } from "./Bolha";

/** Anexo da conversa com agente (`ChatMessage.media`). */
export function MidiaDoAgente({ att, semente, aoAmpliar }: { att: MediaAttachment; semente: string; aoAmpliar: (src: string) => void }) {
  if (att.type === "email_aprovacao" && att.id) return <CartaoAprovacaoEmail id={att.id} />;
  if (att.type === "acao_aprovacao" && att.id) return <CartaoAcao id={att.id} />;
  if (att.type === "lembrete") return <RecadoLembrete titulo={att.name} />;
  const tipo = att.type ?? (att.mimeType?.startsWith("image/") ? "image" : att.mimeType?.startsWith("audio/") ? "audio" : "file");
  const dataUri = att.base64?.startsWith("data:");
  return (
    <AnexoResolvido id={dataUri ? undefined : att.id} url={dataUri ? att.base64 : (att.url || att.base64)}>
      {(url, renovar, urlAgora) => {
        if (tipo === "image") return <ImagemDaBolha src={url} nome={att.name ?? "imagem"} aoAmpliar={aoAmpliar} aoErro={renovar} />;
        if (tipo === "audio") return <PlayerDeAudio src={url} semente={semente} rotulo="resumo" aoErro={renovar} />;
        return <CartaoDeArquivo nome={att.name ?? "arquivo"} tamanho={att.size} url={url} urlAgora={urlAgora} />;
      }}
    </AnexoResolvido>
  );
}

/** Anexo de mensagem de canal (`ChannelMessage.attachments`). */
export function MidiaDoCanal({ att, aoAmpliar }: { att: ChannelAttachment; aoAmpliar: (src: string) => void }) {
  return (
    <AnexoResolvido id={att.id} url={att.url}>
      {(url, renovar, urlAgora) =>
        att.mimeType?.startsWith("image/")
          ? <ImagemDaBolha src={url} nome={att.name} aoAmpliar={aoAmpliar} aoErro={renovar} />
          : <CartaoDeArquivo nome={att.name} tamanho={att.size} url={url} urlAgora={urlAgora} />}
    </AnexoResolvido>
  );
}

/** Imagem ampliada, por cima de tudo; toque fecha. */
export function Ampliada({ src, aoFechar }: { src: string | null; aoFechar: () => void }) {
  if (!src) return null;
  return (
    <button
      type="button"
      onClick={aoFechar}
      aria-label="Fechar imagem"
      style={{ position: "absolute", inset: 0, zIndex: 70, background: "rgba(0,0,0,.92)", display: "grid", placeItems: "center", padding: 12 }}
    >
      <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
    </button>
  );
}
