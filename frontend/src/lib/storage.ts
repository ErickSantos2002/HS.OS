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
 *
 * O envio é em dois passos (`iniciar` → PUT direto no R2 → `concluir`); ver
 * `backend/app/routers/storage.py`. O arquivo nunca passa pelo backend.
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

/**
 * Sobe direto para o R2 com o PUT assinado, reportando progresso.
 *
 * `XMLHttpRequest` e não `fetch` porque `fetch` não tem progresso de envio —
 * e com 100 MB a pessoa precisa ver que está andando.
 *
 * ⚠️ O `Content-Type` tem que ser EXATAMENTE o que foi assinado no `iniciar`.
 * Outro valor e o R2 responde 403 SignatureDoesNotMatch.
 */
function putDiretoImpl(
  url: string,
  arquivo: Blob,
  mime: string,
  aoProgredir?: (fracao: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", mime);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && aoProgredir) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`O armazenamento recusou o envio (HTTP ${xhr.status}).`));
    // Erro de rede aqui é quase sempre CORS do bucket — o navegador não deixa
    // ver o motivo. Dizer isso poupa a tarde de procurar no backend.
    xhr.onerror = () =>
      reject(new Error("Falha ao enviar o arquivo ao armazenamento (rede ou CORS do bucket)."));
    xhr.send(arquivo);
  });
}

/**
 * Indireção de propósito: o teste espiona `interno.putDireto`. Espionar a
 * exportação `putDireto` não interceptaria a chamada feita de dentro deste
 * módulo, porque o ESM não reavalia o nome local.
 */
export const interno = { putDireto: putDiretoImpl };

/** Exportada para a Task 7 reutilizar o mesmo PUT assinado. */
export function putDireto(
  url: string,
  arquivo: Blob,
  mime: string,
  aoProgredir?: (fracao: number) => void,
): Promise<void> {
  return interno.putDireto(url, arquivo, mime, aoProgredir);
}

/**
 * Envia o arquivo e devolve a URL de exibição. Sobrescreve se já existir.
 *
 * `nomeSugerido` não é mais usado: o nome gravado é o último segmento do
 * `caminho`, e é ele que o servidor autoriza. Mantido na assinatura para não
 * mexer nos chamadores.
 */
export async function enviarArquivo(
  bucket: Bucket,
  caminho: string,
  arquivo: Blob,
  _nomeSugerido?: string,
  aoProgredir?: (fracao: number) => void,
): Promise<ArquivoEnviado> {
  const mime = arquivo.type || "application/octet-stream";
  const inicio = await api<{ url_put: string; ticket: string; mime?: string }>("/storage/upload/iniciar", {
    method: "POST",
    body: { bucket, caminho, mime, tamanho: arquivo.size },
  });
  // O PUT é assinado com o mime NORMALIZADO pelo backend; mandar outro Content-Type
  // (ex.: `audio/webm;codecs=opus`) dá 403 SignatureDoesNotMatch.
  await interno.putDireto(inicio.url_put, arquivo, inicio.mime ?? mime, aoProgredir);
  return api<ArquivoEnviado>("/storage/upload/concluir", {
    method: "POST",
    body: { ticket: inicio.ticket },
  });
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
