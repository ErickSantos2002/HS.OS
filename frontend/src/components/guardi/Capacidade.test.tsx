/**
 * Tela "Capacidade" do Guardi (spec 2026-11-13). O que tranca: o sistema
 * expande e mostra Consultar e Fazer com o exemplo; o fora do ar diz isso em vez
 * de uma lista; e "Atualizar" pede de novo ignorando o cache.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: vi.fn(async (_caminho: string) => ({
    agent_id: "ana-bot",
    sistemas: [
      { sistema: "talenths", nome: "TalentHS", papel: "Colaborador", estado: "ok",
        consultar: [{ rotulo: "Os seus pedidos de férias e ausência", exemplo: "quais ausências eu pedi?" }],
        fazer: [{ rotulo: "Pedir férias, folga ou ausência", exemplo: "pede folga na terça", confirma: true }] },
      { sistema: "gestorhs", nome: "GestorHS", papel: null, estado: "fora_do_ar", consultar: [], fazer: [] },
    ],
    no_hsos: [
      { sistema: "memoria", nome: "Memória", papel: null, estado: "ok",
        consultar: [{ rotulo: "O que você pediu para ele lembrar" }],
        fazer: [{ rotulo: "Guardar uma preferência", confirma: false }] },
    ],
  })),
}));
vi.mock("@/lib/api", () => ({ api, ErroApi: class extends Error { status = 0; } }));

import Capacidade from "./Capacidade";

describe("Capacidade", () => {
  it("lista os sistemas, expande e atualiza", async () => {
    render(<Capacidade agentId="ana-bot" aberto />);
    fireEvent.click(await screen.findByText("TalentHS"));
    expect(screen.getByText("seu papel lá: Colaborador")).toBeInTheDocument();
    expect(screen.getByText("Consultar")).toBeInTheDocument();
    expect(screen.getByText("Fazer (com sua confirmação)")).toBeInTheDocument();
    expect(screen.getByText("“pede folga na terça”")).toBeInTheDocument();

    fireEvent.click(screen.getByText("GestorHS"));
    expect(screen.getByText(/Fora do ar agora/)).toBeInTheDocument();
    expect(screen.queryByText("Pedir férias, folga ou ausência")).toBeNull();   // um aberto por vez

    expect(screen.getByText("No HS.OS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith("/bots/capacidade/ana-bot?atualizar=true"));
    expect(api).toHaveBeenCalledWith("/bots/capacidade/ana-bot");
  });
});
