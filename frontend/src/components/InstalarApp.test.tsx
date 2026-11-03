import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoInstalacao } from "@/hooks/use-instalacao-app";

/**
 * O que estes testes protegem: **cada aparelho vê o convite que funciona nele.**
 * Botão no Android, passo a passo no iPhone (dizendo que é isso que liga as
 * notificações — sem essa frase, ninguém instala), nada dentro do app já
 * instalado, e o cartão dispensado não volta antes dos 14 dias.
 */

let estado: EstadoInstalacao;
vi.mock("@/hooks/use-instalacao-app", () => ({ useInstalacaoApp: () => estado }));

import { InstalarApp } from "@/components/InstalarApp";

function base(parcial: Partial<EstadoInstalacao> = {}): EstadoInstalacao {
  return {
    instalado: false,
    ios: false,
    podeInstalar: false,
    instalar: vi.fn(async () => "aceito" as const),
    ...parcial,
  };
}

beforeEach(() => {
  localStorage.clear();
  estado = base();
});

describe("InstalarApp", () => {
  it("já instalado: não aparece em nenhuma variante", () => {
    estado = base({ instalado: true, ios: true, podeInstalar: true });
    const { container: c1 } = render(<InstalarApp variante="cartao" />);
    const { container: c2 } = render(<InstalarApp variante="entrada" />);
    expect(c1).toBeEmptyDOMElement();
    expect(c2).toBeEmptyDOMElement();
  });

  it("Android com prompt: o botão abre o diálogo do navegador", () => {
    estado = base({ podeInstalar: true });
    render(<InstalarApp variante="entrada" />);
    fireEvent.click(screen.getByRole("button", { name: /instalar o app/i }));
    expect(estado.instalar).toHaveBeenCalledOnce();
  });

  it("iPhone no Safari: passo a passo, dizendo que liga as notificações", () => {
    estado = base({ ios: true });
    render(<InstalarApp variante="cartao" />);
    expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
    expect(screen.getByText(/notificações/i)).toBeInTheDocument();
  });

  it("cartão dispensado some e lembra da dispensa", () => {
    estado = base({ ios: true });
    const { container } = render(<InstalarApp variante="cartao" />);
    fireEvent.click(screen.getByRole("button", { name: /agora não/i }));
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem("hsos:instalar-app:dispensado-em")).not.toBeNull();
  });

  it("cartão dispensado há pouco não volta ao remontar", () => {
    estado = base({ ios: true });
    localStorage.setItem("hsos:instalar-app:dispensado-em", String(Date.now()));
    const { container } = render(<InstalarApp variante="cartao" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a entrada fixa ignora a dispensa do cartão", () => {
    estado = base({ ios: true });
    localStorage.setItem("hsos:instalar-app:dispensado-em", String(Date.now()));
    render(<InstalarApp variante="entrada" />);
    expect(screen.getByText(/Adicionar à Tela de Início/)).toBeInTheDocument();
  });

  it("sem prompt e sem iOS: o cartão não aparece, a entrada explica o menu do navegador", () => {
    const { container } = render(<InstalarApp variante="cartao" />);
    expect(container).toBeEmptyDOMElement();
    render(<InstalarApp variante="entrada" />);
    expect(screen.getByText(/menu do navegador/i)).toBeInTheDocument();
  });
});
