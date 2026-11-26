/**
 * O cartão em par na tela: um cartão, dois botões, e cada botão confirma a
 * SUA ação. Trocar os ids aqui aprovaria quando o RH clicou em Recusar — o
 * defeito mais caro possível deste cartão.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verAcao = vi.fn();
const confirmarAcao = vi.fn();
vi.mock("@/lib/acoes", async (orig) => ({
  ...(await orig<typeof import("@/lib/acoes")>()),
  verAcao: (id: string) => verAcao(id),
  confirmarAcao: (id: string) => confirmarAcao(id),
}));

import CartaoAcao from "@/components/chat/CartaoAcao";

const acao = (id: string, acaoNome: string) => ({
  id, status: "pendente", sistema: "talenths", acao: acaoNome, resumo: "",
  payload: { acao: acaoNome.replace("talenths_", ""), ids: ["p1"],
    _exibir: { itens: [{ pessoa: "Welton", tipo: "Ida ao médico", datas: "05/01/2027", dias: 1 }] } },
});

describe("CartaoAcao em par", () => {
  beforeEach(() => {
    verAcao.mockReset(); confirmarAcao.mockReset();
    verAcao.mockImplementation(async (id: string) =>
      id === "a-aprovar" ? acao("a-aprovar", "talenths_aprovar_ausencia") : acao("a-recusar", "talenths_recusar_ausencia"));
    confirmarAcao.mockResolvedValue({ status: "feita", resultado: "Feito." });
  });

  it("mostra só Recusar e Aprovar — sem Cancelar/Confirmar", async () => {
    render(<CartaoAcao id="a-aprovar" rotulo="Aprovar" par={{ id: "a-recusar", rotulo: "Recusar" }} />);
    expect(await screen.findByRole("button", { name: /Aprovar/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recusar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancelar|Confirmar/ })).toBeNull();
  });

  it("Recusar confirma a ação de recusar e some com os botões", async () => {
    render(<CartaoAcao id="a-aprovar" rotulo="Aprovar" par={{ id: "a-recusar", rotulo: "Recusar" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
    await waitFor(() => expect(confirmarAcao).toHaveBeenCalledWith("a-recusar"));
    expect(confirmarAcao).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("✓ Recusar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Aprovar|Recusar/ })).toBeNull();
  });

  it("Aprovar confirma a ação de aprovar", async () => {
    render(<CartaoAcao id="a-aprovar" rotulo="Aprovar" par={{ id: "a-recusar", rotulo: "Recusar" }} />);
    fireEvent.click(await screen.findByRole("button", { name: /Aprovar/ }));
    await waitFor(() => expect(confirmarAcao).toHaveBeenCalledWith("a-aprovar"));
  });
});
