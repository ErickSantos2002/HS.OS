/**
 * "🔎 A Nina pediu um resumo das suas pendências." (`media[{type: "varredura_pedida"}]`).
 * É registro na conversa, não recado: linha pequena e apagada, sem cartão nem
 * botão (e sem push — o backend cala). O texto da mensagem é omitido onde esta
 * linha entra, para não aparecer duas vezes.
 */
export const TEXTO_VARREDURA_PEDIDA = "🔎 A Nina pediu um resumo das suas pendências.";

export const ehVarreduraPedida = (media: unknown): boolean =>
  Array.isArray(media) && media.some((a) => a?.type === "varredura_pedida");

export default function LinhaVarredura() {
  return <p className="text-xs italic text-muted-foreground">{TEXTO_VARREDURA_PEDIDA}</p>;
}
