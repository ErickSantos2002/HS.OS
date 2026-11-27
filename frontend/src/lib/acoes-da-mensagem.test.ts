import { describe, expect, it, vi } from "vitest";

import { acoesDaMensagemDoAgente, acoesDaMensagemDoCanal, acoesDaRespostaNaThread } from "./acoes-da-mensagem";

const ctx = () => ({
  souAutor: false,
  aoResponder: vi.fn(), aoEditar: vi.fn(), aoApagar: vi.fn(),
  aoApagarParaMim: vi.fn(), depois: vi.fn(),
});
const msg = { id: "m1", content: "oi", deleted_at: null };

describe("acoesDaMensagemDoCanal", () => {
  it("mensagem dos outros: responder, copiar, não lida e apagar para mim — sem editar nem apagar", () => {
    expect(acoesDaMensagemDoCanal(msg, ctx()).map((a) => a.rotulo)).toEqual([
      "Responder", "Copiar", "Encaminhar", "Apagar para mim",
    ]);
  });

  it("minha: ganha dados, editar e apagar, e o apagar é perigo", () => {
    const acoes = acoesDaMensagemDoCanal(msg, { ...ctx(), souAutor: true, aoDados: vi.fn() });
    expect(acoes.map((a) => a.rotulo)).toEqual([
      "Responder", "Copiar", "Encaminhar", "Dados da mensagem", "Editar", "Apagar", "Apagar para mim",
    ]);
    expect(acoes.find((a) => a.rotulo === "Apagar")?.perigo).toBe(true);
  });

  it("otimista ou apagada não tem ação", () => {
    expect(acoesDaMensagemDoCanal({ ...msg, id: "optimistic-1" }, ctx())).toEqual([]);
    expect(acoesDaMensagemDoCanal({ ...msg, deleted_at: "2026-11-03" }, ctx())).toEqual([]);
  });

  it("só áudio ou anexo (sem texto) não oferece copiar", () => {
    expect(acoesDaMensagemDoCanal({ ...msg, content: "" }, ctx()).map((a) => a.rotulo)).not.toContain("Copiar");
  });

  it("escolher chama o handler e depois o fechamento", () => {
    const c = ctx();
    acoesDaMensagemDoCanal(msg, c)[0].aoEscolher();
    expect(c.aoResponder).toHaveBeenCalled();
    expect(c.depois).toHaveBeenCalled();
  });

  it("sem aoResponder (canal em que a pessoa não escreve), sem a opção Responder", () => {
    expect(acoesDaMensagemDoCanal(msg, { ...ctx(), aoResponder: undefined }).map((a) => a.rotulo)).not.toContain("Responder");
  });
});

describe("acoesDaMensagemDoAgente", () => {
  const base = { agentId: "nina", content: "texto", timestamp: "2026-11-03", channel: "web" } as const;
  it("resposta do agente: só copiar — marcar como não lida é pela lista (18/11/2026)", () => {
    expect(acoesDaMensagemDoAgente({ ...base, id: "a1", role: "agent" }, "nina").map((a) => a.rotulo)).toEqual(["Copiar"]);
  });
  it("minha: só copiar; erro: nada", () => {
    expect(acoesDaMensagemDoAgente({ ...base, id: "u1", role: "user" }, "nina").map((a) => a.rotulo)).toEqual(["Copiar"]);
    expect(acoesDaMensagemDoAgente({ ...base, id: "e1", role: "agent", isError: true }, "nina")).toEqual([]);
  });
});

describe("acoesDaRespostaNaThread", () => {
  it("só o autor edita e apaga", () => {
    const f = vi.fn();
    expect(acoesDaRespostaNaThread({ souAutor: true, aoEditar: f, aoApagar: f }).map((a) => a.rotulo)).toEqual(["Editar", "Apagar"]);
    expect(acoesDaRespostaNaThread({ souAutor: false, aoEditar: f, aoApagar: f })).toEqual([]);
  });
  it("com a mensagem, encaminha — a spec promete encaminhar de thread (revisão 27/11/2026)", () => {
    const f = vi.fn();
    expect(acoesDaRespostaNaThread({ souAutor: false, mensagem: msg }).map((a) => a.rotulo)).toEqual(["Encaminhar"]);
    expect(acoesDaRespostaNaThread({ souAutor: true, aoEditar: f, aoApagar: f, mensagem: msg }).map((a) => a.rotulo))
      .toEqual(["Encaminhar", "Editar", "Apagar"]);
    expect(acoesDaRespostaNaThread({ souAutor: false, mensagem: { ...msg, id: "optimistic-1" } })).toEqual([]);
  });
});
