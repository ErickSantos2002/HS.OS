/**
 * O bloco "No escritório agora" no topo da lista de DMs (EscritorioHS B).
 *
 * Os quatro estados importam por motivos diferentes:
 * - presença indefinida (API com erro ou backend antigo) → nada, em silêncio;
 * - `conectado: false` → o backend não está ouvindo o escritório; mostrar
 *   "Ninguém agora" ali seria mentir, então só o botão de entrar;
 * - conectado e vazio → "Ninguém agora", que aí é verdade;
 * - conectado com gente → nomes, com teto de 8 e "+K" para não empurrar a
 *   lista de DMs para fora da tela de 260 px.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ESCRITORIO_URL, type PessoaNoEscritorio } from "@/lib/escritorio";

import { NoEscritorioAgora } from "./NoEscritorioAgora";

function pessoa(i: number, extra: Partial<PessoaNoEscritorio> = {}): PessoaNoEscritorio {
  return {
    email: `p${i}@healthsafetytech.com`,
    nome: `Pessoa ${i}`,
    user_id: null,
    avatar_url: null,
    desde: "2026-10-15T10:00:00Z",
    ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("NoEscritorioAgora", () => {
  it("presença indefinida não renderiza nada", () => {
    const { container } = render(<NoEscritorioAgora presenca={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("desconectado mostra só o Escritório e o Entrar", () => {
    render(<NoEscritorioAgora presenca={{ conectado: false, pessoas: [] }} />);
    expect(screen.getByText("Escritório")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Entrar/ })).toBeInTheDocument();
    expect(screen.queryByText(/No escritório agora/)).toBeNull();
    expect(screen.queryByText("Ninguém agora")).toBeNull();
  });

  it("conectado e vazio diz Ninguém agora", () => {
    render(<NoEscritorioAgora presenca={{ conectado: true, pessoas: [] }} />);
    expect(screen.getByText("No escritório agora (0)")).toBeInTheDocument();
    expect(screen.getByText("Ninguém agora")).toBeInTheDocument();
  });

  it("conectado com gente mostra os nomes e a contagem", () => {
    render(
      <NoEscritorioAgora
        presenca={{ conectado: true, pessoas: [pessoa(1, { avatar_url: "https://x/a.png" }), pessoa(2)] }}
      />,
    );
    expect(screen.getByText("No escritório agora (2)")).toBeInTheDocument();
    expect(screen.getByText("Pessoa 1")).toBeInTheDocument();
    expect(screen.getByText("Pessoa 2")).toBeInTheDocument();
    // Sem avatar, as iniciais.
    expect(screen.getByText("P2")).toBeInTheDocument();
  });

  it("passando de 8, mostra 8 e +K", () => {
    const pessoas = Array.from({ length: 11 }, (_, i) => pessoa(i + 1));
    render(<NoEscritorioAgora presenca={{ conectado: true, pessoas }} />);
    expect(screen.getByText("No escritório agora (11)")).toBeInTheDocument();
    expect(screen.getByText("Pessoa 8")).toBeInTheDocument();
    expect(screen.queryByText("Pessoa 9")).toBeNull();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("o Entrar abre o escritório em aba nova", () => {
    render(<NoEscritorioAgora presenca={{ conectado: true, pessoas: [pessoa(1)] }} />);
    const link = screen.getByRole("link", { name: /Entrar/ });
    expect(link).toHaveAttribute("href", ESCRITORIO_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("recolher esconde os nomes e é lembrado", () => {
    const presenca = { conectado: true, pessoas: [pessoa(1)] };
    const { unmount } = render(<NoEscritorioAgora presenca={presenca} />);
    fireEvent.click(screen.getByRole("button", { name: /No escritório agora/ }));
    expect(screen.queryByText("Pessoa 1")).toBeNull();
    expect(localStorage.getItem("hsos:escritorio-aberto")).toBe("0");
    unmount();
    render(<NoEscritorioAgora presenca={presenca} />);
    expect(screen.queryByText("Pessoa 1")).toBeNull();
    expect(screen.getByRole("button", { name: /No escritório agora/ })).toHaveAttribute("aria-expanded", "false");
  });
});
