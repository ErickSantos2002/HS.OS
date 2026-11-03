/**
 * Conversa em tela cheia no celular — spec 2026-11-03, Frente C1.
 *
 * Com a conversa aberta somem o cabeçalho do HS.OS e a barra de baixo, como no
 * WhatsApp. A lista continua com os dois — é de lá que se sai do chat.
 *
 * ⚠️ O que estes testes trancam: a primeira versão decidia pela URL, e um
 * `?channel=` de canal que não existe mais deixava a pessoa na lista sem
 * cabeçalho, sem BottomNav e sem seta — no PWA do iPhone, presa.
 */
import { describe, expect, it } from "vitest";

import { canalNaoResolve, conversaEmTelaCheia } from "@/lib/tela-cheia";

describe("conversaEmTelaCheia", () => {
  it("lista do chat mantém cabeçalho e barra", () => {
    expect(conversaEmTelaCheia("/chat", true, false)).toBe(false);
  });
  it("conversa selecionada no celular é tela cheia", () => {
    expect(conversaEmTelaCheia("/chat", true, true)).toBe(true);
  });
  it("desktop nunca", () => {
    expect(conversaEmTelaCheia("/chat", false, true)).toBe(false);
  });
  it("outras rotas nunca", () => {
    expect(conversaEmTelaCheia("/agents", true, true)).toBe(false);
    expect(conversaEmTelaCheia("/chatbot", true, true)).toBe(false);
  });
});

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
