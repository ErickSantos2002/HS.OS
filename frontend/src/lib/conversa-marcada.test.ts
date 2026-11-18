import { describe, expect, it } from "vitest";
import { chaveDaMarca, indicadorDaAba, indicadorDaConversa, podeMarcar } from "./conversa-marcada";

/**
 * O que estes testes protegem: **a marca diz "fui eu que marquei", não "há
 * algo novo".** Por isso é uma bolinha sem número, e por isso o número de
 * verdade vence a marca — mostrar a bolinha no lugar de "3" esconderia três
 * mensagens por ler. E a marca nunca soma número na aba.
 */

describe("indicadorDaConversa", () => {
  it("marcada sem não lida mostra a bolinha", () => {
    expect(indicadorDaConversa(0, true)).toEqual({ tipo: "marca" });
  });

  it("não lida de verdade vence a marca", () => {
    expect(indicadorDaConversa(3, true)).toEqual({ tipo: "numero", texto: "3" });
  });

  it("sem nada, nada", () => {
    expect(indicadorDaConversa(0, false)).toBeNull();
  });

  it("acima de 99 vira 99+", () => {
    expect(indicadorDaConversa(120, false)).toEqual({ tipo: "numero", texto: "99+" });
  });
});

describe("indicadorDaAba", () => {
  it("só marcada: a aba mostra a bolinha, sem número", () => {
    expect(indicadorDaAba([{ naoLidas: 0, marcada: true }])).toEqual({ tipo: "marca" });
  });

  it("a marca não soma: o número é só o das não lidas", () => {
    expect(indicadorDaAba([{ naoLidas: 2 }, { naoLidas: 0, marcada: true }])).toEqual({
      tipo: "numero",
      texto: "2",
    });
  });

  it("aba vazia não mostra nada", () => {
    expect(indicadorDaAba([{ naoLidas: 0 }])).toBeNull();
  });
});

describe("podeMarcar e chaveDaMarca", () => {
  it("DM com pessoa que nunca conversou (sem canal) não oferece marcar", () => {
    expect(podeMarcar({ canalId: null, agentId: null })).toBe(false);
  });

  it("canal ou agente podem ser marcados", () => {
    expect(podeMarcar({ canalId: "c1", agentId: null })).toBe(true);
    expect(podeMarcar({ canalId: null, agentId: "nina" })).toBe(true);
  });

  it("a chave distingue canal de agente", () => {
    expect(chaveDaMarca({ canalId: "c1", agentId: null })).toBe("canal:c1");
    expect(chaveDaMarca({ canalId: null, agentId: "nina" })).toBe("agente:nina");
    expect(chaveDaMarca({ canalId: null, agentId: "openclaw:Nina" })).toBe("agente:nina");
  });
});
