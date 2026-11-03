/**
 * O detector da bolha não pode ouvir o que acontece dentro da folha de ações.
 *
 * O React propaga eventos pela árvore de componentes: a folha é um portal
 * filho da bolha, e segurar um item dela disparava o toque longo da própria
 * bolha — a ação escolhida não acontecia (revisão de 03/11/2026).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToqueLongo } from "@/hooks/use-toque-longo";

function Bolha({ aoDisparar }: { aoDisparar: () => void }) {
  const { handlers } = useToqueLongo(aoDisparar, true);
  return (
    <div {...handlers}>
      <span>texto da bolha</span>
      {createPortal(<button type="button">item da folha</button>, document.body)}
    </div>
  );
}

describe("useToqueLongo", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("segurar a própria bolha dispara", () => {
    const aoDisparar = vi.fn();
    render(<Bolha aoDisparar={aoDisparar} />);
    fireEvent.touchStart(screen.getByText("texto da bolha"), { touches: [{ clientX: 0, clientY: 0 }] });
    act(() => { vi.advanceTimersByTime(450); });
    expect(aoDisparar).toHaveBeenCalledTimes(1);
  });

  it("botão direito do mouse (janela estreita) abre a folha", () => {
    const aoDisparar = vi.fn();
    render(<Bolha aoDisparar={aoDisparar} />);
    fireEvent.contextMenu(screen.getByText("texto da bolha"));
    expect(aoDisparar).toHaveBeenCalledTimes(1);
  });

  it("contextmenu logo depois de um toque (Android segurando) não abre de novo", () => {
    const aoDisparar = vi.fn();
    render(<Bolha aoDisparar={aoDisparar} />);
    const alvo = screen.getByText("texto da bolha");
    fireEvent.touchStart(alvo, { touches: [{ clientX: 0, clientY: 0 }] });
    act(() => { vi.advanceTimersByTime(450); });
    fireEvent.contextMenu(alvo);
    expect(aoDisparar).toHaveBeenCalledTimes(1);
  });

  it("segurar algo do portal (a folha) não dispara o detector da bolha", () => {
    const aoDisparar = vi.fn();
    render(<Bolha aoDisparar={aoDisparar} />);
    fireEvent.touchStart(screen.getByText("item da folha"), { touches: [{ clientX: 0, clientY: 0 }] });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(aoDisparar).not.toHaveBeenCalled();
  });
});
