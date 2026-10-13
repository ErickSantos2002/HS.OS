/**
 * Anexo de conversa — privado, lido por quem participa da conversa.
 *
 * Desde 13/10/2026 anexo não vai mais para o bucket público `agent-files`:
 * vai para `anexos`, e a URL para exibir é pedida ao backend, que confere se
 * a pessoa participa. Como `<img src>` não manda token, a tela pede a URL
 * assinada antes e a guarda até perto de vencer.
 *
 * Anexo antigo (sem `id`) continua com a `url` pública de sempre — nenhuma
 * URL gravada foi reescrita.
 */
import { api } from "@/lib/api";
import { putDireto } from "@/lib/storage";

export type DestinoAnexo =
  | { contexto: "canal"; channelId: string }
  | { contexto: "conversa_agente"; agentId: string };

export interface AnexoEnviado {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
}

export async function enviarAnexo(
  destino: DestinoAnexo,
  arquivo: File,
  aoProgredir?: (fracao: number) => void,
): Promise<AnexoEnviado> {
  const mime = arquivo.type || "application/octet-stream";
  const inicio = await api<{ url_put: string; ticket: string; mime?: string }>("/storage/upload/iniciar", {
    method: "POST",
    body: {
      bucket: "anexos",
      nome: arquivo.name,
      mime,
      tamanho: arquivo.size,
      contexto: destino.contexto,
      ...(destino.contexto === "canal" ? { channel_id: destino.channelId } : { agent_id: destino.agentId }),
    },
  });
  // Content-Type exato que o backend assinou (mime normalizado).
  await putDireto(inicio.url_put, arquivo, inicio.mime ?? mime, aoProgredir);
  return api<AnexoEnviado>("/storage/upload/concluir", { method: "POST", body: { ticket: inicio.ticket } });
}

const MARGEM_MS = 30_000;
const cache = new Map<string, { url: string; venceEm: number }>();
const emVoo = new Map<string, Promise<string>>();

export async function urlDoAnexo(id: string, agora: () => number = Date.now): Promise<string> {
  const guardada = cache.get(id);
  if (guardada && guardada.venceEm - agora() > MARGEM_MS) return guardada.url;
  const pendente = emVoo.get(id);
  if (pendente) return pendente;
  const p = api<{ url: string; expira_em: number }>(`/anexos/${encodeURIComponent(id)}/url`)
    .then((r) => {
      cache.set(id, { url: r.url, venceEm: agora() + r.expira_em * 1000 });
      return r.url;
    })
    .finally(() => emVoo.delete(id));
  emVoo.set(id, p);
  return p;
}

export function esquecerUrl(id: string): void {
  cache.delete(id);
}
