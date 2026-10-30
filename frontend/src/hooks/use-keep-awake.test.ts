/**
 * A TV da War Room não pode apagar — e nada disso pode vazar para outra tela.
 *
 * Tranca: quando ligar (só sinal de TV), a queda do Wake Lock para o vídeo, o
 * vídeo invisível sem `display:none` (vídeo oculto pausa), a retentativa do
 * autoplay recusado na primeira tecla do controle e a limpeza ao desmontar —
 * um <video> órfão no body seguiria tocando em toda tela visitada depois.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deveManterAcordada } from "@/lib/manter-acordada";
import { useKeepAwake } from "./use-keep-awake";

const UA_LG = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/87.0 Safari/537.36 WebAppManager";
const UA_NOTE = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

describe("deveManterAcordada", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("liga na TV: webOS, token da TV ou ?tv=1", () => {
    expect(deveManterAcordada(q(""), UA_LG)).toBe(true);
    expect(deveManterAcordada(q("t=abc"), UA_NOTE)).toBe(true);
    expect(deveManterAcordada(q("tv=1"), UA_NOTE)).toBe(true);
  });
  it("não liga no notebook logado, e ?tv=0 vence tudo", () => {
    expect(deveManterAcordada(q(""), UA_NOTE)).toBe(false);
    expect(deveManterAcordada(q("tv=0&t=abc"), UA_LG)).toBe(false);
  });
});

let play: ReturnType<typeof vi.fn>;
const videos = () => document.querySelectorAll("video");

beforeEach(() => {
  play = vi.fn(function (this: HTMLVideoElement) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
});

const assentar = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("useKeepAwake", () => {
  it("desligado não toca em nada", async () => {
    renderHook(() => useKeepAwake(false));
    await assentar();
    expect(videos()).toHaveLength(0);
  });

  it("sem Wake Lock cai para o vídeo invisível — e o remove ao desmontar", async () => {
    const { result, unmount } = renderHook(() => useKeepAwake(true));
    await assentar();
    const v = videos()[0];
    expect(v).toBeDefined();
    expect(v.muted && v.loop).toBe(true);
    expect(v.style.display).not.toBe("none");
    expect(v.style.visibility).not.toBe("hidden");
    expect(v.getAttribute("aria-hidden")).toBe("true");
    expect(result.current).toMatchObject({ metodo: "video", rodando: true });
    unmount();
    expect(videos()).toHaveLength(0);
  });

  it("autoplay recusado tenta de novo na primeira tecla do controle", async () => {
    play.mockImplementationOnce(() => Promise.reject(new DOMException("x", "NotAllowedError")));
    const { result, unmount } = renderHook(() => useKeepAwake(true));
    await assentar();
    expect(result.current.rodando).toBe(false);
    expect(result.current.detalhe).toMatch(/NotAllowedError/);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); });
    await assentar();
    expect(result.current.rodando).toBe(true);
    unmount();
  });

  it("com Wake Lock usa só ele, e solta ao desmontar", async () => {
    const sentinela = Object.assign(new EventTarget(), {
      released: false,
      release: vi.fn(async () => { sentinela.released = true; }),
    });
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn(async () => sentinela) }, configurable: true,
    });
    const { result, unmount } = renderHook(() => useKeepAwake(true));
    await assentar();
    expect(result.current).toMatchObject({ metodo: "wakelock", rodando: true });
    expect(videos()).toHaveLength(0);
    unmount();
    expect(sentinela.release).toHaveBeenCalled();
  });

  it("Wake Lock que nunca responde (o da LG) não impede o vídeo", async () => {
    // Na webOS o `request` fica pendurado para sempre — 30/10/2026, a TV apagou
    // com a página "protegida" porque o vídeo esperava por ele.
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn(() => new Promise(() => {})) }, configurable: true,
    });
    const naTv = renderHook(() => useKeepAwake(true, true));
    await assentar();
    expect(videos()).toHaveLength(1);
    expect(naTv.result.current).toMatchObject({ metodo: "video", rodando: true });
    naTv.unmount();

    // Fora da webOS, o vídeo entra quando o prazo do lock vence.
    vi.useFakeTimers();
    const fora = renderHook(() => useKeepAwake(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(videos()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(videos()).toHaveLength(1);
    fora.unmount();
    vi.useRealTimers();
  });

  it("na webOS reforça o Wake Lock com o vídeo", async () => {
    const sentinela = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {}) });
    Object.defineProperty(navigator, "wakeLock", {
      value: { request: vi.fn(async () => sentinela) }, configurable: true,
    });
    const { result, unmount } = renderHook(() => useKeepAwake(true, true));
    await assentar();
    expect(result.current.metodo).toBe("wakelock+video");
    expect(videos()).toHaveLength(1);
    unmount();
  });
});
