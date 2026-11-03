/**
 * A chave do cache das prévias não levava o usuário: trocar de conta no mesmo
 * aparelho mostrava, por um instante, a última mensagem das conversas da
 * conta anterior.
 */
import { expect, it } from "vitest";

import { CHAVE_PREVIAS, chaveDasPrevias } from "./use-lista";

it("a chave das prévias é por usuário e começa pelo prefixo que o tempo real invalida", () => {
  expect(chaveDasPrevias("u1")).not.toEqual(chaveDasPrevias("u2"));
  expect(chaveDasPrevias("u1").slice(0, CHAVE_PREVIAS.length)).toEqual([...CHAVE_PREVIAS]);
});
