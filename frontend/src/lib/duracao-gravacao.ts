/**
 * Grava a duração no webm que o MediaRecorder produz sem ela.
 *
 * ⚠️ **Sem isto o player quebra.** O webm do Chrome não declara a duração; o
 * player a descobria pulando para o fim, e sem índice o pulo às vezes falha com
 * "demuxer seek failed" — 0:00 na tela e áudio mudo para quem recebe. Calcular
 * depois baixando o arquivo não dá: o redirecionamento para o R2 vira origem
 * `null` e o CORS bloqueia. Quem grava sabe quanto gravou; o arquivo nasce certo.
 *
 * mp4 (Safari) já declara a duração e passa intacto.
 */
import fixWebmDuration from "fix-webm-duration";

type Corrigir = (blob: Blob, duracaoMs: number, opcoes: { logger: false }) => Promise<Blob>;

export async function comDuracao(
  blob: Blob,
  duracaoMs: number,
  corrigir: Corrigir = fixWebmDuration as Corrigir,
): Promise<Blob> {
  if (!blob.type.toLowerCase().includes("webm") || !(duracaoMs > 0)) return blob;
  try {
    return await corrigir(blob, duracaoMs, { logger: false });
  } catch {
    // Melhor um áudio sem duração do que nenhum áudio.
    return blob;
  }
}
