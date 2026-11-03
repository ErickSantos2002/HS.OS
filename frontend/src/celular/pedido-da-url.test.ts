/**
 * Resposta rápida do push com o app fechado: o texto vinha na URL e só o
 * `ChannelChat` (desktop) o lia — no app do celular a resposta se perdia.
 */
import { describe, expect, it } from "vitest";

import { anteriorDaUrl, jaAtendido, pedidoDaUrl, semPedido } from "./pedido-da-url";

describe("pedido da URL", () => {
  it("⚠️ autosend=1&prefill=x na URL NÃO pede envio: vira só rascunho", () => {
    // Um link forjado (WhatsApp, e-mail) faria a vítima postar no canal.
    expect(pedidoDaUrl("?channel=c1&prefill=Valeu%21&autosend=1&focus=composer")).toEqual({ rascunho: "Valeu!", respostaId: null, focar: true });
  });
  it("resposta rápida do push leva só o id, para conferir no cache", () => {
    expect(pedidoDaUrl("?channel=c1&resposta=abc&focus=composer")).toEqual({ rascunho: null, respostaId: "abc", focar: true });
  });
  it("só focus é só focar; nada é nada", () => {
    expect(pedidoDaUrl("?channel=c1&focus=composer")).toEqual({ rascunho: null, respostaId: null, focar: true });
    expect(pedidoDaUrl("?channel=c1")).toBeNull();
    expect(pedidoDaUrl("?channel=c1&prefill=%20%20&autosend=1")).toBeNull();
  });
  it("limpar a URL tira o pedido e mantém a conversa e a thread", () => {
    expect(semPedido("?channel=c1&thread=m9&prefill=oi&autosend=1&focus=composer&resposta=x")).toBe("?channel=c1&thread=m9");
    expect(semPedido("?agent=nina&anterior=r1&message=m2", ["anterior", "message"])).toBe("?agent=nina");
  });
  it("conversa anterior da busca global", () => {
    expect(anteriorDaUrl("?agent=nina&anterior=r1&message=m2")).toEqual({ reset: "r1", mensagem: "m2" });
    expect(anteriorDaUrl("?agent=nina")).toBeNull();
  });
  it("o mesmo pedido é atendido uma vez só, mesmo se a tela montar de novo", () => {
    const p = { rascunho: null, respostaId: "id1", focar: true };
    expect(jaAtendido("canal:c1", p)).toBe(false);
    expect(jaAtendido("canal:c1", p)).toBe(true);
    expect(jaAtendido("thread:c1:m9", p)).toBe(false);
  });
});
