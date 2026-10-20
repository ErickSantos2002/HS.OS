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
  // ⚠️ **No perfil do ALVO, não no `/profiles/me`.** Quem chama é a tela de
  // Usuários, com o administrador trocando a foto de outra pessoa; até
  // 20/10/2026 isto gravava no perfil de quem trocava, e a foto do Gustavo
  // virava a do administrador. A rota exige `administrador`.
  await api(`/profiles/${encodeURIComponent(userId)}`, { method: "PATCH", body: { avatar_url: url } });
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
