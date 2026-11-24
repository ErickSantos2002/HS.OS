/* Endereço seguro — PK-01, 24/11/2026 (auditoria de 02/11 do DN.OS, itens C1/C2).
 *
 * Atributos de endereço que vêm do conteúdo (vídeo, anexo, imagem) podem ter
 * sido escritos por qualquer um que edite o documento — inclusive um agente,
 * pelo `documento_criar`/`documento_editar`, depois de ler e-mail de terceiros.
 * Um `javascript:` num iframe, num window.open ou num location.href roda na
 * origem do HS.OS e lê `hsos.token` do localStorage. Por isso a conferência é
 * feita ao LER o HTML, ao GRAVAR e na hora de ABRIR — não só num desses.
 */

const PROTOCOLOS = new Set(["http:", "https:", "blob:"]);
const IMAGEM_EM_DATA = /^data:image\/(png|jpe?g|gif|webp);/i;

/** O endereço se for http(s), blob: ou relativo à própria origem; senão null.
    `imagem: true` aceita também imagem rasterizada em data: (nunca svg). */
export function enderecoSeguro(valor: unknown, opcoes: { imagem?: boolean } = {}): string | null {
  if (typeof valor !== "string") return null;
  // o navegador ignora espaços e caracteres de controle no começo e no meio do esquema
  // eslint-disable-next-line no-control-regex
  const limpo = valor.replace(/[\u0000- \u007f-\u009f]+/g, "");
  if (!limpo) return null;
  if (opcoes.imagem && IMAGEM_EM_DATA.test(limpo)) return valor.trim();
  if (limpo.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(limpo, typeof window !== "undefined" ? window.location.origin : "https://hsos.local");
  } catch {
    return null;
  }
  return PROTOCOLOS.has(url.protocol) ? valor.trim() : null;
}
