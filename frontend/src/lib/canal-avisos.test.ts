import { describe, expect, it } from "vitest";
import { fraseDeQuemEscreve, podeEscreverNoCanal } from "./canal-avisos";

describe("canal de avisos", () => {
  it("a frase é a mesma do backend", () => {
    expect(fraseDeQuemEscreve(["Nicholson"])).toBe("Só Nicholson envia mensagens neste canal.");
    expect(fraseDeQuemEscreve(["Lidisay", "Nicholson"])).toBe("Só Lidisay e Nicholson enviam mensagens neste canal.");
    expect(fraseDeQuemEscreve(["A", "B", "C"])).toBe("Só A, B e C enviam mensagens neste canal.");
    expect(fraseDeQuemEscreve([])).toBe("Só o administrador envia mensagens neste canal.");
  });

  it("canal comum: todo mundo escreve", () => {
    expect(podeEscreverNoCanal({ soAlgunsEscrevem: false, souAdmin: false, meuPodeEscrever: false })).toBe(true);
    expect(podeEscreverNoCanal({ soAlgunsEscrevem: undefined, souAdmin: false, meuPodeEscrever: undefined })).toBe(true);
  });

  it("canal de avisos: admin e escolhidos escrevem, o resto lê", () => {
    expect(podeEscreverNoCanal({ soAlgunsEscrevem: true, souAdmin: true, meuPodeEscrever: false })).toBe(true);
    expect(podeEscreverNoCanal({ soAlgunsEscrevem: true, souAdmin: false, meuPodeEscrever: true })).toBe(true);
    expect(podeEscreverNoCanal({ soAlgunsEscrevem: true, souAdmin: false, meuPodeEscrever: false })).toBe(false);
    expect(podeEscreverNoCanal({ soAlgunsEscrevem: true, souAdmin: false, meuPodeEscrever: undefined })).toBe(false);
  });
});
