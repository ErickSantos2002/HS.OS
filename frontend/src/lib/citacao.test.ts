import { describe, expect, it } from "vitest";

import { acharCitada, montarResposta, separarCitacao, trechoParaCitar } from "@/lib/citacao";

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

/**
 * Clicar na citação leva à mensagem citada (10/11/2026). Não há id no banco —
 * a citação é texto —, então a busca é pelo trecho, de trás para a frente a
 * partir da resposta: com a mesma frase dita duas vezes, a citada é a mais
 * recente ANTES da resposta, nunca uma que veio depois.
 */
describe("acharCitada", () => {
  const msgs = [
    { id: "a", content: "bom dia" },
    { id: "b", content: "pode revisar o contrato?" },
    { id: "c", content: "bom dia" },
    { id: "r", content: "> **Ana:** bom dia\n\nbom dia!" },
    { id: "d", content: "bom dia" },
  ];

  it("acha a mais recente antes da resposta", () => {
    expect(acharCitada(msgs, "r", { autor: "Ana", texto: "bom dia" })).toBe("c");
  });

  it("acha trecho cortado de mensagem longa", () => {
    const longa = "x".repeat(200);
    const lista = [{ id: "l", content: longa }, { id: "r", content: "" }];
    expect(acharCitada(lista, "r", { autor: "Ana", texto: trechoParaCitar(longa) })).toBe("l");
  });

  it("não acha nada quando a citada sumiu (apagada ou fora da página)", () => {
    expect(acharCitada(msgs, "r", { autor: "Ana", texto: "outra coisa" })).toBeNull();
  });
});
