/**
 * O celular não mostrava contador nas abas Pessoas/Agentes/Canais: com 5 não
 * lidas em canais, a pessoa só descobria trocando de aba. A regra veio do
 * desktop, e mora aqui para as duas telas não divergirem.
 */
import { expect, it } from "vitest";

import { rotuloDoContador, somarNaoLidas } from "./contador-de-nao-lidas";

it("soma as não lidas da aba, silenciadas inclusive", () => {
  expect(somarNaoLidas([{ naoLidas: 2 }, { naoLidas: 0 }, { naoLidas: 3 }])).toBe(5);
  expect(somarNaoLidas([])).toBe(0);
});

it("número negativo (dado torto) não desconta das outras", () => {
  expect(somarNaoLidas([{ naoLidas: -1 }, { naoLidas: 1 }])).toBe(1);
});

it("some no zero e corta em 99+", () => {
  expect(rotuloDoContador(0)).toBeNull();
  expect(rotuloDoContador(7)).toBe("7");
  expect(rotuloDoContador(99)).toBe("99");
  expect(rotuloDoContador(100)).toBe("99+");
});
