/**
 * Prévia da última mensagem na lista do celular — spec 2026-11-03, C9.
 * A resposta do agente é markdown; a lista mostraria os asteriscos.
 */
import { describe, expect, it } from "vitest";

import { semMarkdown } from "@/lib/previa-da-mensagem";

describe("semMarkdown", () => {
  it("tira negrito, código e quebra de linha", () => {
    expect(semMarkdown("O faturamento foi de **R$ 441.712,80**.\n\nUse `x`."))
      .toBe("O faturamento foi de R$ 441.712,80. Use x.");
  });
  it("lista e título viram texto corrido", () => {
    expect(semMarkdown("# Resumo\n- **42** calibrações\n- 3 pendentes")).toBe("Resumo 42 calibrações 3 pendentes");
  });
  it("link fica só com o texto", () => {
    expect(semMarkdown("Veja [o painel](https://x.y/z)")).toBe("Veja o painel");
  });
  it("itálico some, mas asterisco solto e nome com _ ficam", () => {
    expect(semMarkdown("isto é *importante* agora")).toBe("isto é importante agora");
    expect(semMarkdown("arquivo meu_relatorio.xlsx 2 * 3")).toBe("arquivo meu_relatorio.xlsx 2 * 3");
  });
});
