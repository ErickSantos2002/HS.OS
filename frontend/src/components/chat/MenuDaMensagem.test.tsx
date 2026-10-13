/**
 * Seta de opções da mensagem, como no WhatsApp — 13/10/2026.
 *
 * Antes, passar o mouse abria uma barra de seis ícones embaixo da mensagem
 * larga. Agora só uma setinha no canto da bolha; as ações ficam no menu dela.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MenuDaMensagem from "@/components/chat/MenuDaMensagem";

function abrir() {
  const seta = screen.getByRole("button", { name: "Opções da mensagem" });
  // O Radix abre no pointerdown real, que o jsdom não simula; o teclado (Enter)
  // é o mesmo gatilho e o caminho de acessibilidade.
  seta.focus();
  fireEvent.keyDown(seta, { key: "Enter" });
  return seta;
}

describe("MenuDaMensagem", () => {
  it("a seta abre o menu com as ações e cada uma chama o seu callback", async () => {
    const apagar = vi.fn();
    render(<MenuDaMensagem acoes={[
      { rotulo: "Copiar", aoEscolher: vi.fn() },
      { rotulo: "Apagar", aoEscolher: apagar, perigo: true },
    ]} />);
    abrir();
    expect(await screen.findByRole("menuitem", { name: "Copiar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Apagar" }));
    expect(apagar).toHaveBeenCalledTimes(1);
  });

  it("sem ações, não desenha a seta", () => {
    render(<MenuDaMensagem acoes={[]} />);
    expect(screen.queryByRole("button", { name: "Opções da mensagem" })).toBeNull();
  });
});
