import { describe, expect, it } from "vitest";

import { classificarAtividade, nomeDoAutor, textoDaAtividade } from "./atividade";

const n = (author_name: string, content_preview: string, agent_id: string | null = null) => ({ author_name, content_preview, agent_id });

describe("classificarAtividade", () => {
  it("resposta de agente na conversa direta", () => {
    expect(classificarAtividade(n("Iris", "Faturamento do trimestre", "iris"), "Erick Santos")).toBe("agente");
  });
  it("resposta em thread, pelo formato que o servidor grava", () => {
    expect(classificarAtividade(n("Marina Costa (em conversa)", "💬 Ótimo, obrigada!"), "Erick Santos")).toBe("thread");
  });
  it("menção pelo nome inteiro, pelo primeiro nome e @todos", () => {
    expect(classificarAtividade(n("Rafael", "@Erick Santos o laudo saiu"), "Erick Santos")).toBe("mencao");
    expect(classificarAtividade(n("Rafael", "@erick o laudo saiu"), "Erick Santos")).toBe("mencao");
    expect(classificarAtividade(n("Camila", "@todos reunião quinta"), "Erick Santos")).toBe("mencao");
  });
  it("mensagem comum de canal não entra", () => {
    expect(classificarAtividade(n("Flow", "3 calibrações vencem"), "Erick Santos")).toBeNull();
    expect(classificarAtividade(n("Flow", "fale com @Marina"), "Erick Santos")).toBeNull();
  });
});

it("nome e texto saem limpos das marcas do servidor", () => {
  expect(nomeDoAutor({ author_name: "Marina Costa (em conversa)" })).toBe("Marina Costa");
  expect(textoDaAtividade({ content_preview: "💬 Ótimo" })).toBe("Ótimo");
});
