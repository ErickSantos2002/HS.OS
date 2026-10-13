/** O botão de velocidade do player — 13/10/2026. */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import AudioMessagePlayer from "@/components/chat/AudioMessagePlayer";

afterEach(() => localStorage.clear());

describe("velocidade no AudioMessagePlayer", () => {
  it("clicar troca a velocidade do áudio e o rótulo", () => {
    const { container } = render(<AudioMessagePlayer src="https://x/a.mp3" />);
    const botao = screen.getByRole("button", { name: /velocidade/i });
    expect(botao).toHaveTextContent("1x");
    fireEvent.click(botao);
    expect(botao).toHaveTextContent("1,5x");
    expect(container.querySelector("audio")!.playbackRate).toBe(1.5);
  });

  it("o próximo player já nasce na velocidade escolhida", () => {
    const primeiro = render(<AudioMessagePlayer src="https://x/a.mp3" />);
    fireEvent.click(screen.getByRole("button", { name: /velocidade/i }));
    fireEvent.click(screen.getByRole("button", { name: /velocidade/i }));
    primeiro.unmount();
    const { container } = render(<AudioMessagePlayer src="https://x/b.mp3" />);
    expect(screen.getByRole("button", { name: /velocidade/i })).toHaveTextContent("2x");
    expect(container.querySelector("audio")!.playbackRate).toBe(2);
  });
});
