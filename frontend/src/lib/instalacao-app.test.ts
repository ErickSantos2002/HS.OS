import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assinarInstalacao,
  cartaoDispensadoVale,
  ehIos,
  ehIosNaoInstalado,
  ehQuadrado,
  estaInstalado,
  gravarDispensa,
  iniciarCapturaDeInstalacao,
  lerDispensa,
  pedirInstalacao,
  temPromptDeInstalacao,
  type AmbienteNavegador,
} from "./instalacao-app";

/**
 * O que estes testes protegem: **o convite para instalar aparece para quem
 * precisa dele, e só para quem precisa.**
 *
 * No iPhone é o único caminho para as notificações (o Safari comum não tem
 * `Notification`). Errar a detecção para o lado do "não é iOS" deixa a pessoa
 * sem push e sem saber por quê; errar para o lado do "não está instalado"
 * mostra o cartão dentro do próprio app instalado, que parece defeito.
 */

const UA_IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const UA_MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const UA_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

function amb(parcial: Partial<AmbienteNavegador>): AmbienteNavegador {
  return { userAgent: UA_ANDROID, displayModeStandalone: false, ...parcial };
}

describe("estaInstalado", () => {
  it("reconhece o display-mode standalone (Android, desktop)", () => {
    expect(estaInstalado(amb({ displayModeStandalone: true }))).toBe(true);
  });

  it("reconhece o navigator.standalone do iOS", () => {
    expect(estaInstalado(amb({ userAgent: UA_IPHONE_SAFARI, standalone: true }))).toBe(true);
  });

  it("aba comum não está instalada", () => {
    expect(estaInstalado(amb({}))).toBe(false);
  });
});

describe("ehIos", () => {
  it("iPhone no Safari", () => {
    expect(ehIos(amb({ userAgent: UA_IPHONE_SAFARI }))).toBe(true);
  });

  it("iPad do iPadOS 13+, que se apresenta como Mac — o toque o denuncia", () => {
    // Sem isto o passo a passo some justamente do iPad.
    expect(ehIos(amb({ userAgent: UA_MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 }))).toBe(true);
  });

  it("Mac de verdade, sem toque, não é iOS", () => {
    expect(ehIos(amb({ userAgent: UA_MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 }))).toBe(false);
  });

  it("Chrome no iPhone também é iOS (é WebKit e instala pelo Compartilhar)", () => {
    expect(ehIos(amb({ userAgent: UA_IPHONE_CHROME }))).toBe(true);
  });

  it("Android não é iOS", () => {
    expect(ehIos(amb({ userAgent: UA_ANDROID }))).toBe(false);
  });
});

describe("ehIosNaoInstalado", () => {
  it("iPhone no Safari, fora do app: é quem precisa do passo a passo", () => {
    expect(ehIosNaoInstalado(amb({ userAgent: UA_IPHONE_SAFARI }))).toBe(true);
  });

  it("iPhone já instalado não recebe o convite", () => {
    expect(ehIosNaoInstalado(amb({ userAgent: UA_IPHONE_SAFARI, standalone: true }))).toBe(false);
  });
});

describe("cartaoDispensadoVale (volta depois de 14 dias)", () => {
  const DIA = 24 * 60 * 60 * 1000;
  const agora = 1_800_000_000_000;

  it("nunca dispensado: o cartão aparece", () => {
    expect(cartaoDispensadoVale(null, agora)).toBe(false);
  });

  it("dispensado há 13 dias: continua escondido", () => {
    expect(cartaoDispensadoVale(agora - 13 * DIA, agora)).toBe(true);
  });

  it("dispensado há 14 dias: volta", () => {
    expect(cartaoDispensadoVale(agora - 14 * DIA, agora)).toBe(false);
  });
});

describe("lerDispensa / gravarDispensa", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("guarda e lê o instante da dispensa", () => {
    gravarDispensa(123);
    expect(lerDispensa()).toBe(123);
  });

  it("localStorage que lança (Safari privado) vira 'nunca dispensado', não erro na tela", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(lerDispensa()).toBeNull();
  });

  it("gravar com localStorage que lança não derruba o clique", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() => gravarDispensa(1)).not.toThrow();
  });
});

describe("captura do beforeinstallprompt", () => {
  function eventoDeInstalacao(escolha: "accepted" | "dismissed") {
    const ev = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    ev.prompt = vi.fn(() => Promise.resolve());
    ev.userChoice = Promise.resolve({ outcome: escolha });
    return ev;
  }

  it("o evento que chega ANTES de o React montar não se perde", async () => {
    // O navegador dispara uma vez, cedo. Se a escuta nascesse no componente,
    // o botão "Instalar" nunca apareceria para quem abriu direto no chat.
    iniciarCapturaDeInstalacao();
    const ev = eventoDeInstalacao("accepted");
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);

    const visto = vi.fn();
    const sair = assinarInstalacao(visto);
    expect(temPromptDeInstalacao()).toBe(true);

    expect(await pedirInstalacao()).toBe("aceito");
    expect(ev.prompt).toHaveBeenCalledOnce();
    // O prompt só pode ser usado uma vez: depois dele, some o botão.
    expect(temPromptDeInstalacao()).toBe(false);
    expect(visto).toHaveBeenCalled();
    sair();
  });

  it("appinstalled limpa o prompt guardado", () => {
    iniciarCapturaDeInstalacao();
    window.dispatchEvent(eventoDeInstalacao("dismissed"));
    expect(temPromptDeInstalacao()).toBe(true);
    window.dispatchEvent(new Event("appinstalled"));
    expect(temPromptDeInstalacao()).toBe(false);
  });

  it("sem prompt guardado, pedir é 'indisponivel'", async () => {
    window.dispatchEvent(new Event("appinstalled"));
    expect(await pedirInstalacao()).toBe("indisponivel");
  });
});

describe("ehQuadrado", () => {
  it("ícone quadrado pode virar apple-touch-icon", () => {
    expect(ehQuadrado(512, 512)).toBe(true);
  });

  it("wordmark não pode — o iOS o espremeria no quadrado", () => {
    expect(ehQuadrado(1910, 823)).toBe(false);
  });
});
