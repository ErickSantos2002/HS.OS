/**
 * Velocidade de reprodução dos áudios (13/10/2026), igual ao WhatsApp:
 * 1x → 1,5x → 2x → 0,5x. A escolha fica no navegador de cada pessoa e vale para
 * os próximos áudios. Sem armazenamento (modo privado, bloqueio), é 1x.
 */
const CHAVE = "hsos.velocidade-audio";
const VELOCIDADES = [1, 1.5, 2, 0.5] as const;

export function proximaVelocidade(atual: number): number {
  // Valor desconhecido conta como 1x: o próximo é 1,5x, como no primeiro clique.
  const i = Math.max(0, VELOCIDADES.indexOf(atual as (typeof VELOCIDADES)[number]));
  return VELOCIDADES[(i + 1) % VELOCIDADES.length];
}

export function rotuloVelocidade(v: number): string {
  return `${String(v).replace(".", ",")}x`;
}

export function lerVelocidade(): number {
  try {
    const v = Number(localStorage.getItem(CHAVE));
    return (VELOCIDADES as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function gravarVelocidade(v: number): void {
  try {
    localStorage.setItem(CHAVE, String(v));
  } catch {
    /* sem armazenamento a escolha vale só para este áudio */
  }
}
