/**
 * Ações do toque longo — spec 2026-11-03, Frente C3.
 *
 * A folha do celular usa o MESMO array que o `MenuDaMensagem` do desktop: uma
 * segunda lista seria a primeira a ficar para trás quando alguém acrescentasse
 * uma ação. O único acréscimo é o "Copiar", porque no celular a seleção nativa
 * some durante o gesto — e a thread não o tem no menu do desktop.
 */
import { describe, expect, it, vi } from "vitest";

import { acoesDoToque, temOQueAbrir, REACOES_RAPIDAS } from "@/lib/acoes-do-toque";

describe("acoesDoToque", () => {
  it("acrescenta Copiar quando falta e há texto", () => {
    const copiar = vi.fn();
    const editar = { rotulo: "Editar", aoEscolher: vi.fn() };
    const r = acoesDoToque([editar], { texto: "oi", copiar });
    expect(r.map((a) => a.rotulo)).toEqual(["Copiar", "Editar"]);
    r[0].aoEscolher();
    expect(copiar).toHaveBeenCalledTimes(1);
  });

  it("não duplica Copiar e devolve o mesmo array", () => {
    const acoes = [{ rotulo: "Copiar", aoEscolher: vi.fn() }];
    expect(acoesDoToque(acoes, { texto: "oi", copiar: vi.fn() })).toBe(acoes);
  });

  it("sem texto não acrescenta", () => {
    const acoes = [{ rotulo: "Apagar", aoEscolher: vi.fn() }];
    expect(acoesDoToque(acoes, { texto: "   ", copiar: vi.fn() })).toBe(acoes);
    expect(acoesDoToque(acoes)).toBe(acoes);
  });
});

describe("temOQueAbrir", () => {
  it("sem ações nem reação, não há o que abrir (otimista, apagada)", () => {
    expect(temOQueAbrir([], false)).toBe(false);
  });
  it("reação sozinha já justifica a folha", () => {
    expect(temOQueAbrir([], true)).toBe(true);
  });
  it("uma ação basta", () => {
    expect(temOQueAbrir([{ rotulo: "Copiar", aoEscolher: () => {} }], false)).toBe(true);
  });
});

it("as reações rápidas são as cinco da spec, nesta ordem", () => {
  expect(REACOES_RAPIDAS).toEqual(["👍", "❤️", "😂", "😮", "🙏"]);
});
