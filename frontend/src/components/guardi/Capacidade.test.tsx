/**
 * Tela "Capacidade" do Guardi (spec 2026-11-13), por assunto. O que tranca: o
 * sistema mostra os ícones dos assuntos fechado e, aberto, um bloco por assunto
 * com "Vê", "Faz" e "Experimente"; o fora do ar diz isso em vez de uma lista; o
 * que sai na hora (HS.OS) se distingue do que vira cartão; "Atualizar" ignora o
 * cache; e nada tem largura fixa — o mesmo componente vive no painel do
 * celular, com ~360px.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({
  api: vi.fn(async (_caminho: string) => ({
    agent_id: "ana-bot",
    sistemas: [
      { sistema: "talenths", nome: "TalentHS", papel: "Colaborador", estado: "ok", assuntos: [
        { chave: "ausencias", titulo: "Férias e ausências", icone: "plane", cor: "sky",
          ve: ["os seus pedidos de férias e ausência", "quem está ausente"],
          faz: ["pedir folga, férias ou ausência"], na_hora: [],
          exemplos: ["quais ausências eu pedi?", "pede folga na terça"] },
        { chave: "ponto", titulo: "Ponto", icone: "clock", cor: "teal",
          ve: ["as suas batidas de hoje"], faz: [], na_hora: [], exemplos: ["como está o meu ponto hoje?"] },
      ] },
      { sistema: "gestorhs", nome: "GestorHS", papel: null, estado: "fora_do_ar", assuntos: [] },
    ],
    no_hsos: [
      { sistema: "hsos", nome: "Memória, lembretes e e-mail", papel: null, estado: "ok", assuntos: [
        { chave: "email", titulo: "E-mail", icone: "inbox", cor: "sky", ve: ["os seus e-mails"],
          faz: ["preparar e-mails para outras pessoas", "marcar e-mails como lidos"],
          na_hora: ["marcar e-mails como lidos"], exemplos: [] },
      ] },
    ],
  })),
}));
vi.mock("@/lib/api", () => ({ api, ErroApi: class extends Error { status = 0; } }));

import Capacidade from "./Capacidade";

function noCelular() {
  return render(<div style={{ width: 360 }}><Capacidade agentId="ana-bot" aberto /></div>);
}

describe("Capacidade", () => {
  it("abre um sistema e mostra os assuntos com Vê, Faz e Experimente", async () => {
    noCelular();
    const cartao = await screen.findByRole("button", { name: /TalentHS/ });
    expect(within(cartao).getByText("2 assuntos · vê 3 · faz 1")).toBeInTheDocument();
    expect(within(cartao).getByLabelText("Assuntos: Férias e ausências, Ponto")).toBeInTheDocument();

    fireEvent.click(cartao);
    expect(screen.getByText("seu papel lá: Colaborador")).toBeInTheDocument();
    const ausencias = screen.getByRole("region", { name: "Férias e ausências" });
    expect(within(ausencias).getByText("Vê")).toBeInTheDocument();
    expect(within(ausencias).getByText("Os seus pedidos de férias e ausência; quem está ausente.")).toBeInTheDocument();
    expect(within(ausencias).getByText("pedir folga, férias ou ausência")).toBeInTheDocument();
    expect(within(ausencias).getByText("“pede folga na terça”")).toBeInTheDocument();
    expect(screen.getByText(/só acontece quando você confirma/)).toBeInTheDocument();
    // Assunto sem "faz" não mostra a linha vazia.
    expect(within(screen.getByRole("region", { name: "Ponto" })).queryByText("Faz")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /GestorHS/ }));
    expect(screen.getByText(/Fora do ar agora/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Férias e ausências" })).toBeNull();   // um aberto por vez
  });

  it("no HS.OS separa o que sai na hora do que vira cartão", async () => {
    noCelular();
    fireEvent.click(await screen.findByRole("button", { name: /Memória, lembretes e e-mail/ }));
    const email = screen.getByRole("region", { name: "E-mail" });
    const naHora = within(email).getByText("marcar e-mails como lidos").closest("span[title]");
    const cartao = within(email).getByText("preparar e-mails para outras pessoas").closest("span[title]");
    expect(naHora).toHaveAttribute("title", "Sai na hora, sem cartão");
    expect(cartao).toHaveAttribute("title", "Vira um cartão para você confirmar");
    expect(screen.getByText(/sai na hora; o resto vira um cartão/)).toBeInTheDocument();
  });

  it("nada tem largura fixa que estoure o painel do celular", async () => {
    // jsdom não calcula layout; o que dá para trancar é a causa: largura ou
    // mínimo fixo, ou texto proibido de quebrar fora de um `truncate`.
    const { container } = noCelular();
    for (const nome of [/TalentHS/, /Memória/]) fireEvent.click(await screen.findByRole("button", { name: nome }));
    fireEvent.click(screen.getByRole("button", { name: /TalentHS/ }));
    const classes = [...container.querySelectorAll("[class]")].map((e) => e.getAttribute("class") ?? "");
    for (const c of classes) {
      expect(c).not.toMatch(/\b(?:min-)?w-\[\d|\bw-(?:[4-9]\d|\d{3})\b|whitespace-nowrap/);
    }
  });

  it("atualizar pede de novo ignorando o cache", async () => {
    noCelular();
    await screen.findByText("TalentHS");
    expect(screen.getByText("No HS.OS")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Atualizar/ }));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith("/bots/capacidade/ana-bot?atualizar=true"));
    expect(api).toHaveBeenCalledWith("/bots/capacidade/ana-bot");
  });
});
