import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  definirAgenteAberto,
  definirCanalAberto,
  estaVendoConversa,
} from "./conversa-aberta";

// O SW pergunta "você está nesta conversa?" antes de mostrar o push. Errar para
// o "sim" engole a notificação de quem não está olhando; errar para o "não"
// toca o celular de quem está com a conversa na cara (spec 2026-11-03, B1).

function tela(visivel: boolean, foco: boolean) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(visivel ? "visible" : "hidden");
  vi.spyOn(document, "hasFocus").mockReturnValue(foco);
}

describe("estaVendoConversa", () => {
  beforeEach(() => {
    definirCanalAberto(null);
    definirAgenteAberto(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it("canal aberto, visível e com foco", () => {
    tela(true, true);
    definirCanalAberto("c1");
    expect(estaVendoConversa("canal:c1")).toBe(true);
    expect(estaVendoConversa("canal:c2")).toBe(false);
  });

  it("aba escondida ou sem foco não conta como olhando", () => {
    definirCanalAberto("c1");
    tela(false, true);
    expect(estaVendoConversa("canal:c1")).toBe(false);
    tela(true, false);
    expect(estaVendoConversa("canal:c1")).toBe(false);
  });

  it("agente casa por apelido do id", () => {
    tela(true, true);
    definirAgenteAberto("openclaw:nina");
    expect(estaVendoConversa("agente:nina")).toBe(true);
    expect(estaVendoConversa("agente:iris")).toBe(false);
  });

  it("nada aberto, nada casa", () => {
    tela(true, true);
    expect(estaVendoConversa("canal:c1")).toBe(false);
    expect(estaVendoConversa("")).toBe(false);
  });
});
