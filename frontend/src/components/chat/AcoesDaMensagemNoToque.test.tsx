/**
 * Folha de ações do toque longo — spec 2026-11-03, Frente C3.
 *
 * O que ela tranca: a ação escolhida no celular é o MESMO callback do menu do
 * desktop, e a reação rápida chega com o emoji certo.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AcoesDaMensagemNoToque from "@/components/chat/AcoesDaMensagemNoToque";

describe("AcoesDaMensagemNoToque", () => {
  it("mostra as ações e chama o callback escolhido", async () => {
    const apagar = vi.fn();
    const aoMudar = vi.fn();
    render(
      <AcoesDaMensagemNoToque
        aberto
        aoMudar={aoMudar}
        acoes={[
          { rotulo: "Responder em thread", aoEscolher: vi.fn() },
          { rotulo: "Apagar", aoEscolher: apagar, perigo: true },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Responder em thread" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reagir com 👍" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apagar" }));
    expect(aoMudar).toHaveBeenCalledWith(false);
    await waitFor(() => expect(apagar).toHaveBeenCalledTimes(1));
  });

  it("reação rápida chama aoReagir com o emoji", async () => {
    const aoReagir = vi.fn();
    render(<AcoesDaMensagemNoToque aberto aoMudar={vi.fn()} acoes={[]} aoReagir={aoReagir} />);
    fireEvent.click(screen.getByRole("button", { name: "Reagir com ❤️" }));
    await waitFor(() => expect(aoReagir).toHaveBeenCalledWith("❤️"));
  });
});
