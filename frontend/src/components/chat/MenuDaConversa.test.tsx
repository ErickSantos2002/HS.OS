/**
 * O menu da conversa na lista do desktop. O que se tranca: o clique direito
 * abre o mesmo menu do ⋮; DM com pessoa que nunca conversou (sem canal) não
 * oferece marcar; conversa marcada oferece "Marcar como lida"; e o número de
 * não lidas vence a bolinha.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  marcada: false,
  marcar: vi.fn(async () => true),
  desmarcar: vi.fn(async () => true),
  pedirLimpar: vi.fn(),
}));
vi.mock("@/hooks/use-conversas-marcadas", () => ({
  useConversasMarcadas: () => ({ estaMarcada: () => estado.marcada, marcar: estado.marcar, desmarcar: estado.desmarcar }),
}));

vi.mock("@/lib/limpar-conversa", () => ({ pedirLimparConversa: estado.pedirLimpar }));

import { IndicadorDaConversa, MenuDaConversa } from "./MenuDaConversa";

beforeEach(() => { vi.clearAllMocks(); estado.marcada = false; });

describe("MenuDaConversa", () => {
  it("clique direito abre o menu e marca", async () => {
    render(<MenuDaConversa alvo={{ canalId: "c1", agentId: null }}><button>Ana</button></MenuDaConversa>);
    fireEvent.contextMenu(screen.getByText("Ana"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Marcar como não lida" }));
    expect(estado.marcar).toHaveBeenCalledWith({ canalId: "c1", agentId: null });
  });

  it("marcada oferece marcar como lida", async () => {
    estado.marcada = true;
    render(<MenuDaConversa alvo={{ canalId: null, agentId: "nina" }}><button>Nina</button></MenuDaConversa>);
    fireEvent.contextMenu(screen.getByText("Nina"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Marcar como lida" }));
    expect(estado.desmarcar).toHaveBeenCalledWith({ canalId: null, agentId: "nina" });
  });

  it("DM e grupo oferecem limpar a conversa (27/11/2026)", async () => {
    render(<MenuDaConversa alvo={{ canalId: "c1", agentId: null }} limpar={{ nome: "Ana" }}><button>Ana</button></MenuDaConversa>);
    fireEvent.contextMenu(screen.getByText("Ana"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Limpar conversa" }));
    expect(estado.pedirLimpar).toHaveBeenCalledWith({ canalId: "c1", nome: "Ana" });
  });

  it("sem `limpar` (agente, anotações) não oferece", async () => {
    render(<MenuDaConversa alvo={{ canalId: null, agentId: "nina" }}><button>Nina</button></MenuDaConversa>);
    fireEvent.contextMenu(screen.getByText("Nina"));
    await screen.findByRole("menuitem", { name: "Marcar como não lida" });
    expect(screen.queryByRole("menuitem", { name: "Limpar conversa" })).toBeNull();
  });

  it("sem canal nem agente não há menu", () => {
    render(<MenuDaConversa alvo={{ canalId: null, agentId: null }}><button>Zé</button></MenuDaConversa>);
    expect(screen.queryByRole("button", { name: "Opções da conversa" })).toBeNull();
  });
});

describe("IndicadorDaConversa", () => {
  it("bolinha sem número para a marca; número para não lida", () => {
    const { rerender } = render(<IndicadorDaConversa indicador={{ tipo: "marca" }} />);
    expect(screen.getByRole("img", { name: "Marcada como não lida" }).textContent).toBe("");
    rerender(<IndicadorDaConversa indicador={{ tipo: "numero", texto: "3" }} />);
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("MenuDaConversa — botão do hover", () => {
  it("o ˅ abre o mesmo item, sem abrir a conversa", async () => {
    const abrir = vi.fn();
    render(<MenuDaConversa alvo={{ canalId: "c1", agentId: null }}><button onClick={abrir}>Ana</button></MenuDaConversa>);
    const botao = screen.getByRole("button", { name: "Opções da conversa" });
    fireEvent.pointerDown(botao, { button: 0, pointerType: "mouse" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Marcar como não lida" }));
    expect(estado.marcar).toHaveBeenCalledWith({ canalId: "c1", agentId: null });
    expect(abrir).not.toHaveBeenCalled();
  });
});
