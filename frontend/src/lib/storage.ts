/**
 * Arquivos — substitui o `supabase.storage`.
 *
 * A superfície é a mesma que o código herdado usava, com nomes nossos:
 *
 * | antes                                  | agora                        |
 * |----------------------------------------|------------------------------|
 * | `.from(b).upload(p, f, {contentType})` | `enviarArquivo(b, p, f)`     |
 * | `.from(b).getPublicUrl(p)`             | `urlPublica(b, p)`           |
 * | `.from(b).remove([p, …])`              | `removerArquivos(b, [p, …])` |
 *
 * O `upsert` sumiu do contrato porque virou o padrão: o servidor sempre
 * sobrescreve. Era o que o código já pedia em todo upload de avatar, e o
 * caminho identifica o dono (`avatars/<id>.png`), então versionar criaria lixo.
 */

import { api, lerToken } from "@/lib/api";

const BASE = import.meta.env.VITE_API_URL || "/api";

export type Bucket =
  | "agent-files"
  | "audio-messages"
  | "wiki-uploads"
  | "company-docs"
  | "generated-documents";

export interface ArquivoEnviado {
  bucket: string;
  path: string;
  url: string;
  size: number;
}

/**
 * URL para exibir o arquivo. Serve direto em `<img src>` e `<audio src>`.
 *
 * Só vale para bucket público — o navegador não manda `Authorization` em tag
 * HTML, e é por isso que `agent-files`, `audio-messages` e `wiki-uploads` são
 * abertos para leitura, como já eram no Supabase.
 */
export function urlPublica(bucket: Bucket, caminho: string): string {
  const partes = caminho.split("/").map(encodeURIComponent).join("/");
  return `${BASE}/storage/${bucket}/${partes}`;
}

/** Envia o arquivo e devolve a URL de exibição. Sobrescreve se já existir. */
export async function enviarArquivo(
  bucket: Bucket,
  caminho: string,
  arquivo: Blob,
  nomeSugerido?: string,
): Promise<ArquivoEnviado> {
  const corpo = new FormData();
  // O nome importa: o servidor deduz o content-type pela extensão ao servir.
  corpo.append("arquivo", arquivo, nomeSugerido ?? caminho.split("/").pop() ?? "arquivo");

  const partes = caminho.split("/").map(encodeURIComponent).join("/");
  const token = lerToken();
  // `fetch` direto em vez do `api()`: o helper força `Content-Type: application/json`
  // quando há corpo, e com FormData quem precisa definir o cabeçalho (com o
  // boundary do multipart) é o próprio navegador.
  const resposta = await fetch(`${BASE}/storage/${bucket}/${partes}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: corpo,
  });

  if (!resposta.ok) {
    let detalhe = `Erro ${resposta.status}`;
    try {
      const corpoErro = await resposta.json();
      if (corpoErro?.detail) detalhe = String(corpoErro.detail);
    } catch {
      /* resposta sem JSON — fica o código */
    }
    throw new Error(detalhe);
  }
  return (await resposta.json()) as ArquivoEnviado;
}

/**
 * Apaga arquivos. Apagar o que não existe não é erro — a tela usa isso para
 * limpar variantes (`.png` e `.jpg`) sem saber qual delas está lá.
 */
export async function removerArquivos(bucket: Bucket, caminhos: string[]): Promise<void> {
  await Promise.all(
    caminhos.map((caminho) => {
      const partes = caminho.split("/").map(encodeURIComponent).join("/");
      return api(`/storage/${bucket}/${partes}`, { method: "DELETE" }).catch((e) => {
        console.warn(`[storage] Falha ao remover ${bucket}/${caminho}:`, e);
      });
    }),
  );
}

/**
 * URL de arquivo em bucket privado. Requer token, então **não** funciona em
 * `<img src>` — use para baixar via `fetch` e criar um object URL.
 */
export function urlPrivada(bucket: Bucket, caminho: string): string {
  const partes = caminho.split("/").map(encodeURIComponent).join("/");
  return `${BASE}/storage/privado/${bucket}/${partes}`;
}
