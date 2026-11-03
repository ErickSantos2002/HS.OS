import { expect, it } from "vitest";

import { naoLidasDoAgente } from "./nao-lidas-do-agente";

it("soma as do canal de DM e as órfãs, sem contar a mesma duas vezes", () => {
  expect(naoLidasDoAgente("nina", { nina: "dm1" }, { dm1: 2, outro: 5 }, { nina: 1 })).toBe(3);
});

it("sem canal de DM conhecido, só as órfãs contam", () => {
  expect(naoLidasDoAgente("iris", {}, { dm1: 2 }, { iris: 4 })).toBe(4);
  expect(naoLidasDoAgente("atlas", {}, {}, {})).toBe(0);
});
