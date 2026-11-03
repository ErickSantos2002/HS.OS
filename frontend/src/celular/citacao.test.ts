import { describe, expect, it } from "vitest";

import { montarResposta, separarCitacao, trechoParaCitar } from "./citacao";

describe("responder citando", () => {
  it("ida e volta: o que se manda é o que se reconhece", () => {
    const enviado = montarResposta({ autor: "Rafael Lima", texto: "o laudo da Sabesp saiu" }, "Valeu!\nVou conferir.");
    expect(enviado).toBe("> **Rafael Lima:** o laudo da Sabesp saiu\n\nValeu!\nVou conferir.");
    expect(separarCitacao(enviado)).toEqual({
      citacao: { autor: "Rafael Lima", texto: "o laudo da Sabesp saiu" },
      resto: "Valeu!\nVou conferir.",
    });
  });

  it("sem citação, o texto passa intacto", () => {
    expect(montarResposta(null, "oi")).toBe("oi");
    expect(separarCitacao("> só uma citação solta\n\noi")).toEqual({ citacao: null, resto: "> só uma citação solta\n\noi" });
  });

  it("o trecho é uma linha, sem a citação anterior, e corta em 140", () => {
    expect(trechoParaCitar("> **Ana:** antes\n\nlinha 1\nlinha 2")).toBe("linha 1 linha 2");
    expect(trechoParaCitar("x".repeat(200))).toBe("x".repeat(140) + "…");
  });
});
