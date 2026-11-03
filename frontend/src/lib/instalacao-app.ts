/**
 * Instalar o HS.OS como app (PWA): detecção e captura do convite do navegador.
 *
 * Duas portas de entrada, uma por família de aparelho:
 *
 * - **Android e Chrome de desktop** disparam `beforeinstallprompt`. O evento
 *   chega **uma vez, cedo** — muitas vezes antes de o React montar. Por isso a
 *   escuta nasce no `main.tsx` (`iniciarCapturaDeInstalacao`) e guarda o evento
 *   aqui, em nível de módulo; o componente só assina. Escutar dentro do
 *   componente perderia o evento de quem abre direto numa tela sem o botão.
 * - **iPhone/iPad** não têm evento nenhum: instala-se pelo menu Compartilhar →
 *   "Adicionar à Tela de Início". E é **só** instalado que o iOS entrega push
 *   (16.4+), então quem está no Safari comum precisa do passo a passo — sem ele
 *   a pessoa fica sem notificação e sem saber por quê.
 *
 * `estaInstalado` e `ehIosNaoInstalado` são o contrato que outras telas usam
 * (o banner de permissão de notificações, Frente B): puros, com o ambiente
 * injetável para teste.
 */

export type AmbienteNavegador = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** `navigator.standalone` — só existe no iOS. */
  standalone?: boolean;
  /** `matchMedia("(display-mode: standalone)")`. */
  displayModeStandalone: boolean;
};

export function lerAmbiente(): AmbienteNavegador {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { userAgent: "", displayModeStandalone: false };
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent ?? "",
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone,
    displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches ?? false,
  };
}

export function estaInstalado(amb: AmbienteNavegador = lerAmbiente()): boolean {
  return amb.displayModeStandalone || amb.standalone === true;
}

export function ehIos(amb: AmbienteNavegador = lerAmbiente()): boolean {
  if (/iPhone|iPad|iPod/i.test(amb.userAgent)) return true;
  // ⚠️ iPadOS 13+ se apresenta como Mac. O que o separa de um Mac de verdade
  // é a tela de toque.
  return amb.platform === "MacIntel" && (amb.maxTouchPoints ?? 0) > 1;
}

/** iPhone/iPad fora do app instalado — quem precisa do passo a passo. */
export function ehIosNaoInstalado(amb: AmbienteNavegador = lerAmbiente()): boolean {
  return ehIos(amb) && !estaInstalado(amb);
}

/** Só ícone quadrado serve de `apple-touch-icon`; o iOS espremeria o resto. */
export function ehQuadrado(largura: number, altura: number): boolean {
  return largura > 0 && largura === altura;
}

// ── Cartão dispensável ──────────────────────────────────────────────────────

const CHAVE_DISPENSA = "hsos:instalar-app:dispensado-em";
const QUATORZE_DIAS_MS = 14 * 24 * 60 * 60 * 1000;

/** `true` enquanto a dispensa ainda vale (menos de 14 dias). */
export function cartaoDispensadoVale(dispensadoEm: number | null, agora: number): boolean {
  if (dispensadoEm == null) return false;
  return agora - dispensadoEm < QUATORZE_DIAS_MS;
}

// localStorage pode lançar (Safari privado, armazenamento bloqueado). Convite
// para instalar é acessório: na dúvida, "nunca dispensado", e nada quebra.
export function lerDispensa(): number | null {
  try {
    const bruto = localStorage.getItem(CHAVE_DISPENSA);
    const n = bruto == null ? NaN : Number(bruto);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function gravarDispensa(agora: number): void {
  try {
    localStorage.setItem(CHAVE_DISPENSA, String(agora));
  } catch {
    /* sem armazenamento, o cartão só volta na próxima visita */
  }
}

// ── beforeinstallprompt ─────────────────────────────────────────────────────

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" | string }>;
};

let promptGuardado: BeforeInstallPromptEvent | null = null;
let capturaIniciada = false;
const assinantes = new Set<() => void>();

function avisar() {
  assinantes.forEach((fn) => fn());
}

export function iniciarCapturaDeInstalacao(): void {
  if (capturaIniciada || typeof window === "undefined") return;
  capturaIniciada = true;
  window.addEventListener("beforeinstallprompt", (ev) => {
    // Sem o preventDefault o Chrome mostra a barrinha dele por conta própria,
    // no momento que ele escolher; com ele, o convite é o nosso botão.
    ev.preventDefault();
    promptGuardado = ev as BeforeInstallPromptEvent;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    promptGuardado = null;
    avisar();
  });
}

export function assinarInstalacao(fn: () => void): () => void {
  assinantes.add(fn);
  return () => {
    assinantes.delete(fn);
  };
}

export function temPromptDeInstalacao(): boolean {
  return promptGuardado != null;
}

export type ResultadoInstalacao = "aceito" | "recusado" | "indisponivel";

/**
 * Abre o diálogo de instalação do navegador. Tem que ser chamado direto do
 * clique (gesto do usuário). O evento só serve uma vez: depois do `prompt()`
 * ele é descartado, aceito ou não.
 */
export async function pedirInstalacao(): Promise<ResultadoInstalacao> {
  const ev = promptGuardado;
  if (!ev) return "indisponivel";
  promptGuardado = null;
  avisar();
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  return outcome === "accepted" ? "aceito" : "recusado";
}
