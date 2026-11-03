/**
 * Mandar, editar e apagar mensagem de canal (DM, grupo e thread).
 *
 * Saiu de dentro do `ChannelChat` em 03/11/2026 para o app do celular usar o
 * MESMO caminho — gravar, avisar os destinatários (`notifyChannelRecipients`)
 * e acordar o agente mencionado (`startChannelAgentReplies`). Um envio que
 * esquecesse um desses três passos seria mensagem que ninguém fica sabendo,
 * ou agente que não responde, só no celular.
 */
import { toast } from "sonner";

import { api } from "@/lib/api";
import { enviarAudioDoCanal } from "@/lib/audio-de-mensagem";
import { startChannelAgentReplies } from "@/lib/channel-agents";
import { notifyChannelRecipients } from "@/lib/channel-notifications";
import { transcreverAudio } from "@/lib/transcrever-audio";
import type { Channel, ChannelAttachment, ChannelMessage } from "@/hooks/use-channels";
import type { MediaAttachment } from "@/lib/mock-data";

type SendMessage = (
  channelId: string, authorId: string, authorName: string, content: string,
  authorType?: "human" | "agent", authorAvatar?: string | null, audioUrl?: string | null,
  attachments?: ChannelAttachment[] | null, threadId?: string | null,
) => Promise<void>;

export interface ContextoDeEnvio {
  canal: Pick<Channel, "id" | "type">;
  user: { id: string; email?: string | null };
  profile: { full_name?: string | null; avatar_url?: string | null } | null;
  sendMessage: SendMessage;
  /** Agentes membros do canal — quem pode ser acordado pela mensagem. */
  agentMembers: string[];
}

export function nomeDeQuemEscreve(ctx: Pick<ContextoDeEnvio, "profile" | "user">): string {
  return (ctx.profile?.full_name && ctx.profile.full_name.trim()) || ctx.user.email?.split("@")[0] || "Usuário";
}

/** Anexo já enviado (`finalizeStaged`) no formato de `channel_messages.attachments`. */
export function anexosDoCanal(finalizados: MediaAttachment[]): ChannelAttachment[] {
  return finalizados.map((f) => ({
    id: f.id,
    name: f.name ?? "arquivo",
    url: f.id ? "" : (f.url || f.base64),
    size: f.size ?? 0,
    mimeType: f.mimeType,
  }));
}

/** O texto que a mensagem leva quando só tem anexo: "📎 nome". Imagem não entra. */
export function conteudoComAnexos(texto: string, anexos: ChannelAttachment[] | null): string {
  const naoImagens = anexos ? anexos.filter((a) => !a.mimeType?.startsWith("image/")) : [];
  return texto || (naoImagens.length > 0 ? `📎 ${naoImagens.map((a) => a.name).join(", ")}` : "");
}

function acordarAgentes(ctx: ContextoDeEnvio, texto: string) {
  startChannelAgentReplies({
    channelId: ctx.canal.id,
    channelType: ctx.canal.type,
    agentMembers: ctx.agentMembers,
    messageText: texto,
  });
}

/** Mensagem no nível de cima do canal (texto e/ou anexos já enviados). */
export async function publicarNoCanal(ctx: ContextoDeEnvio, texto: string, anexos: ChannelAttachment[] | null): Promise<void> {
  const displayContent = conteudoComAnexos(texto, anexos);
  const displayName = nomeDeQuemEscreve(ctx);
  const avatarUrl = ctx.profile?.avatar_url || null;
  await ctx.sendMessage(ctx.canal.id, ctx.user.id, displayName, displayContent, "human", avatarUrl, null, anexos);
  await notifyChannelRecipients({
    channelId: ctx.canal.id,
    senderUserId: ctx.user.id,
    authorName: displayName,
    contentPreview: displayContent.slice(0, 100),
    contentText: displayContent,
    forceNotifyAll: ctx.canal.type === "dm",
  });
  acordarAgentes(ctx, displayContent);
}

/** Resposta numa thread. Não acorda agente — era assim no `ChannelChat`. */
export async function publicarNaThread(ctx: ContextoDeEnvio, texto: string, raiz: string, anexos?: ChannelAttachment[] | null): Promise<void> {
  const nome = nomeDeQuemEscreve(ctx);
  await ctx.sendMessage(ctx.canal.id, ctx.user.id, nome, texto, "human", ctx.profile?.avatar_url || null, null, anexos ?? null, raiz);
  await notifyChannelRecipients({
    channelId: ctx.canal.id,
    senderUserId: ctx.user.id,
    authorName: `${nome} (em conversa)`,
    contentPreview: `💬 ${texto.slice(0, 100)}`,
    contentText: texto,
    forceNotifyAll: true,
    threadRootId: raiz,
  });
}

/** Voz numa thread: o áudio já foi enviado e transcrito por quem chama. */
export async function publicarAudioNaThread(ctx: ContextoDeEnvio, audioUrl: string, transcricao: string, raiz: string): Promise<void> {
  const nome = nomeDeQuemEscreve(ctx);
  await ctx.sendMessage(ctx.canal.id, ctx.user.id, nome, transcricao, "human", ctx.profile?.avatar_url || null, audioUrl, null, raiz);
  await notifyChannelRecipients({
    channelId: ctx.canal.id,
    senderUserId: ctx.user.id,
    authorName: `${nome} (em conversa)`,
    contentPreview: `🎤 ${transcricao.slice(0, 100)}`,
    contentText: transcricao,
    forceNotifyAll: true,
    threadRootId: raiz,
  });
}

/**
 * Mensagem de voz: anexo privado do canal + transcrição como texto. Sem
 * transcrição o áudio vai assim mesmo, com "Transcrição indisponível".
 * `raiz` manda para a thread. Devolve `false` se o envio do áudio falhou.
 */
export async function enviarAudioNoCanal(ctx: ContextoDeEnvio, blob: Blob, raiz?: string | null): Promise<boolean> {
  let audioUrl: string;
  try {
    audioUrl = await enviarAudioDoCanal(ctx.canal.id, blob);
  } catch (uploadErr) {
    console.error("Upload error:", uploadErr);
    toast.error("Falha ao enviar o áudio.");
    return false;
  }
  let transcription: string;
  try {
    transcription = (await transcreverAudio(blob)) || "Mensagem de áudio";
  } catch {
    transcription = "Transcrição indisponível";
  }
  if (raiz) {
    await publicarAudioNaThread(ctx, audioUrl, transcription, raiz);
    return true;
  }
  const nome = nomeDeQuemEscreve(ctx);
  await ctx.sendMessage(ctx.canal.id, ctx.user.id, nome, transcription, "human", ctx.profile?.avatar_url || null, audioUrl);
  await notifyChannelRecipients({
    channelId: ctx.canal.id,
    senderUserId: ctx.user.id,
    authorName: nome,
    contentPreview: `🎤 ${transcription.slice(0, 100)}`,
    contentText: transcription,
    forceNotifyAll: ctx.canal.type === "dm",
  });
  acordarAgentes(ctx, transcription);
  return true;
}

export async function editarNoCanal(canalId: string, msgId: string, texto: string): Promise<void> {
  // O `edited_at` é do servidor, e a rota confere que a mensagem é de quem
  // está editando — antes bastava saber o id.
  await api(`/channels/${canalId}/messages/${msgId}`, {
    method: "PATCH",
    body: { content: texto },
  }).catch(() => { /* a tela já saiu do modo de edição */ });
}

/** Apaga para todos. Devolve `false` (com aviso) se o servidor recusou. */
export async function apagarNoCanal(canalId: string, msgId: string): Promise<boolean> {
  try {
    await api(`/channels/${canalId}/messages/${msgId}`, { method: "DELETE" });
    return true;
  } catch (erro) {
    // Antes o erro era engolido: a pessoa clicava em apagar e nada acontecia.
    toast.error(erro instanceof Error ? erro.message : "Não consegui apagar a mensagem.");
    return false;
  }
}

/** "Apagar para mim" (30/10/2026): some daqui na hora, o servidor grava, e o
 *  aviso oferece desfazer. O autor e os outros membros não percebem nada. */
export async function apagarParaMimNoCanal(
  canalId: string,
  msg: ChannelMessage,
  { esconder, reexibir, aoApagar }: { esconder: (id: string) => void; reexibir: (m: ChannelMessage) => void; aoApagar?: (id: string) => void },
): Promise<void> {
  const rota = `/channels/${canalId}/messages/${msg.id}/apagar-para-mim`;
  esconder(msg.id);
  aoApagar?.(msg.id);
  try {
    await api(rota, { method: "POST" });
  } catch (erro) {
    reexibir(msg);
    toast.error(erro instanceof Error ? erro.message : "Não consegui apagar a mensagem para você.");
    return;
  }
  toast("Mensagem apagada para você", {
    duration: 6000,
    action: {
      label: "Desfazer",
      onClick: () => {
        void api(rota, { method: "DELETE" }).then(
          () => reexibir(msg),
          () => toast.error("Não consegui desfazer."),
        );
      },
    },
  });
}
