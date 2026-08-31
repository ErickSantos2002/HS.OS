import { api } from "@/lib/api";
import { invalidarListaDeAvatares } from "@/hooks/use-agent-avatar";
import { enviarArquivo, urlPublica } from "@/lib/storage";

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/** Upload a cropped avatar for a HUMAN user → updates profiles.avatar_url */
export async function uploadUserAvatar(userId: string, dataUrl: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `avatars/users/${userId}.png`;
  await enviarArquivo("agent-files", path, blob, "avatar.png");
  // O `?t=` continua: o caminho é sempre o mesmo, então sem isto o navegador
  // mostraria a foto antiga do cache até o cabeçalho expirar.
  const url = `${urlPublica("agent-files", path)}?t=${Date.now()}`;
  await api("/profiles/me", { method: "PATCH", body: { avatar_url: url } });
  return url;
}

/** Sobe o avatar recortado de um AGENTE: arquivo no storage e `avatar_url` no
 *  perfil, por `PATCH /agents/{id}`.
 *
 *  ⚠️ O comentário aqui dizia "upserts agent_avatars" e essa tabela saiu do
 *  caminho — tem zero linhas e ninguém a lê. Quem procurasse o avatar por ela
 *  não acharia nada e concluiria que o upload está quebrado. */
export async function uploadAgentAvatar(agentId: string, dataUrl: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  const path = `avatars/${agentId}.png`;
  await enviarArquivo("agent-files", path, blob, "avatar.png");
  // A lista de arquivos em `avatars/` é lida uma vez e guardada. Sem esta
  // linha, a foto recém-enviada só apareceria depois de recarregar a página.
  invalidarListaDeAvatares();
  const url = `${urlPublica("agent-files", path)}?t=${Date.now()}`;
  await api(`/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: { avatar_url: url },
  });
  return url;
}
