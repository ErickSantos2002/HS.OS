/**
 * iPhone/iPad fora do app instalado.
 *
 * No iPhone o push só existe com o HS.OS adicionado à Tela de Início
 * (iOS ≥ 16.4); no Safari comum nem existe `Notification`, e o banner de
 * permissão simplesmente sumia sem explicar nada.
 *
 * TODO integração: trocar pelo detector da Frente A (fluxo `InstalarApp`).
 */
export function ehIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS se apresenta como Mac; o toque denuncia.
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

export function rodandoInstalado(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
  return !!standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function ehIosForaDoApp(): boolean {
  return ehIos() && !rodandoInstalado();
}
