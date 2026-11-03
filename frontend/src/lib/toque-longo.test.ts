/**
 * Segurar a mensagem no celular abre as ações — spec 2026-11-03, Frente C3.
 *
 * O long-press que existia (500ms, sem olhar movimento) disparava no meio da
 * rolagem: quem arrastava a conversa com o dedo parado em cima de uma bolha
 * ganhava um menu que não pediu. O detector cancela com movimento e rolagem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { criarDetectorDeToqueLongo, menuVeioDoMouse } from "@/lib/toque-longo";

describe("criarDetectorDeToqueLongo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dispara depois de 450ms parado", () => {
    const aoDisparar = vi.fn();
    const d = criarDetectorDeToqueLongo({ aoDisparar });
    d.inicio(100, 100);
    vi.advanceTimersByTime(449);
    expect(aoDisparar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(aoDisparar).toHaveBeenCalledTimes(1);
  });

  it("soltar antes do prazo não dispara", () => {
    const aoDisparar = vi.fn();
    const d = criarDetectorDeToqueLongo({ aoDisparar });
    d.inicio(0, 0);
    vi.advanceTimersByTime(300);
    d.fim();
    vi.advanceTimersByTime(1000);
    expect(aoDisparar).not.toHaveBeenCalled();
    expect(d.disparou()).toBe(false);
  });

  it("mover mais de 10px cancela", () => {
    const aoDisparar = vi.fn();
    const d = criarDetectorDeToqueLongo({ aoDisparar });
    d.inicio(50, 50);
    d.mover(50, 61);
    vi.advanceTimersByTime(1000);
    expect(aoDisparar).not.toHaveBeenCalled();
  });

  it("mover até 10px não cancela — o dedo nunca fica parado de verdade", () => {
    const aoDisparar = vi.fn();
    const d = criarDetectorDeToqueLongo({ aoDisparar });
    d.inicio(50, 50);
    d.mover(56, 58); // 10px na diagonal
    vi.advanceTimersByTime(450);
    expect(aoDisparar).toHaveBeenCalledTimes(1);
  });

  it("cancela quando a página rola", () => {
    const aoDisparar = vi.fn();
    const d = criarDetectorDeToqueLongo({ aoDisparar });
    d.inicio(10, 10);
    d.rolou();
    vi.advanceTimersByTime(1000);
    expect(aoDisparar).not.toHaveBeenCalled();
  });

  it("disparou() fica true só depois do disparo e zera no próximo toque", () => {
    const d = criarDetectorDeToqueLongo({ aoDisparar: () => {} });
    d.inicio(0, 0);
    expect(d.disparou()).toBe(false);
    vi.advanceTimersByTime(450);
    expect(d.disparou()).toBe(true);
    d.fim();
    d.inicio(0, 0);
    expect(d.disparou()).toBe(false);
  });

  it("mover sem toque em curso não faz nada", () => {
    const aoDisparar = vi.fn();
    const d = criarDetectorDeToqueLongo({ aoDisparar });
    d.mover(500, 500);
    d.rolou();
    vi.advanceTimersByTime(1000);
    expect(aoDisparar).not.toHaveBeenCalled();
  });
});

/**
 * Mouse numa janela abaixo de 768px: a seta de hover não é desenhada no modo
 * toque, então o botão direito é o único caminho para as ações.
 */
describe("menuVeioDoMouse", () => {
  it("pointerType mouse é mouse, touch é dedo", () => {
    expect(menuVeioDoMouse({ pointerType: "mouse", agora: 5000, ultimoToque: 4900 })).toBe(true);
    expect(menuVeioDoMouse({ pointerType: "touch", agora: 5000, ultimoToque: null })).toBe(false);
  });
  it("sem pointerType: toque recente é dedo", () => {
    expect(menuVeioDoMouse({ agora: 5000, ultimoToque: 4500 })).toBe(false);
  });
  it("sem pointerType e sem toque recente é mouse", () => {
    expect(menuVeioDoMouse({ agora: 5000, ultimoToque: null })).toBe(true);
    expect(menuVeioDoMouse({ agora: 5000, ultimoToque: 3000 })).toBe(true);
  });
});
