/**
 * Conversas anteriores (spec 2026-10-14): o que vai para o campo de digitar ao
 * citar, e para onde a busca leva.
 */
import { describe, expect, it } from "vitest";
import { acrescentarCitacao, citarTrecho, destinoDaBusca } from "./conversas-anteriores";

describe("citarTrecho", () => {
  it("cada linha vira citação, a linha vazia também, e sobra espaço para escrever", () => {
    expect(citarTrecho("total: 22\n\n3 cancelados")).toBe("> total: 22\n>\n> 3 cancelados\n\n");
  });
});

describe("acrescentarCitacao", () => {
  it("campo vazio recebe só a citação", () => {
    expect(acrescentarCitacao("", "a")).toBe("> a\n\n");
  });
  it("não apaga o que a pessoa já tinha digitado", () => {
    expect(acrescentarCitacao("com base nisto", "a")).toBe("com base nisto\n\n> a\n\n");
    expect(acrescentarCitacao("linha\n", "a")).toBe("linha\n\n> a\n\n");
  });
});

describe("destinoDaBusca", () => {
  it("mensagem da conversa atual continua abrindo o chat como sempre", () => {
    expect(destinoDaBusca({ origem: "nina", id: "m1" })).toBe("/chat?agent=nina&message=m1");
    expect(destinoDaBusca({ origem: "nina", id: "m1", conversa_anterior: null })).toBe("/chat?agent=nina&message=m1");
  });
  it("mensagem de conversa encerrada abre o histórico nela", () => {
    expect(destinoDaBusca({ origem: "nina", id: "m1", conversa_anterior: "r1" }))
      .toBe("/chat?agent=nina&anterior=r1&message=m1");
  });
});
