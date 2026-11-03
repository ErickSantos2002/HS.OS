/**
 * `?channel=` que não resolve — spec 2026-11-03.
 *
 * ⚠️ O que estes testes trancam: um `?channel=` de canal que não existe mais
 * (push de canal do qual a pessoa saiu, canal apagado) deixava a tela num
 * limbo. Só se decide depois de recarregar a lista daquele canal.
 */
import { describe, expect, it } from "vitest";

import { canalNaoResolve } from "@/lib/tela-cheia";

describe("canalNaoResolve", () => {
  it("canal que sumiu, depois de recarregar a lista, sai da URL", () => {
    expect(canalNaoResolve({ channelParam: "c-apagado", recarregadoPara: "c-apagado", encontrado: false })).toBe(true);
  });
  it("antes de recarregar não decide — DM recém-criado ainda não está na lista", () => {
    expect(canalNaoResolve({ channelParam: "c-novo", recarregadoPara: null, encontrado: false })).toBe(false);
    expect(canalNaoResolve({ channelParam: "c-novo", recarregadoPara: "c-outro", encontrado: false })).toBe(false);
  });
  it("canal encontrado fica", () => {
    expect(canalNaoResolve({ channelParam: "c1", recarregadoPara: "c1", encontrado: true })).toBe(false);
  });
  it("sem ?channel= não há o que resolver", () => {
    expect(canalNaoResolve({ channelParam: null, recarregadoPara: null, encontrado: false })).toBe(false);
  });
});
