import { describe, expect, it } from "vitest";

import { pilhaDaUrl, urlAoAbrir, urlDaAba, urlDaPilha, urlDoPai, usaAppCelular } from "./pilha";

describe("pilhaDaUrl", () => {
  it("lista sozinha abre em Conversas", () => {
    expect(pilhaDaUrl("")).toEqual([{ tipo: "inicio", aba: "conversas" }]);
  });

  it("aba vem da URL, valor estranho cai em Conversas", () => {
    expect(pilhaDaUrl("?aba=eu")[0]).toEqual({ tipo: "inicio", aba: "eu" });
    expect(pilhaDaUrl("?aba=xpto")[0]).toEqual({ tipo: "inicio", aba: "conversas" });
  });

  it("link de push de agente empilha a conversa sobre a lista", () => {
    expect(pilhaDaUrl("?agent=nina")).toEqual([
      { tipo: "inicio", aba: "conversas" },
      { tipo: "agente", id: "nina" },
    ]);
  });

  it("thread de canal fica em cima do canal", () => {
    expect(pilhaDaUrl("?channel=c1&thread=m9")).toEqual([
      { tipo: "inicio", aba: "conversas" },
      { tipo: "canal", id: "c1" },
      { tipo: "thread", canal: "c1", raiz: "m9" },
    ]);
  });

  it("?channel= de DM de agente abre a conversa com o agente, como no desktop", () => {
    const agenteDoCanal = (id: string) => (id === "dm-nina" ? "nina" : null);
    expect(pilhaDaUrl("?channel=dm-nina", agenteDoCanal)[1]).toEqual({ tipo: "agente", id: "nina" });
  });

  it("painel fica em cima da conversa; painel desconhecido é ignorado", () => {
    expect(pilhaDaUrl("?agent=nina&painel=arquivos").at(-1)).toEqual({ tipo: "painel", painel: "arquivos" });
    expect(pilhaDaUrl("?agent=nina&painel=hack")).toHaveLength(2);
  });

  it("painel das silenciadas sai do Eu, sem conversa", () => {
    expect(pilhaDaUrl("?aba=eu&painel=silenciados")).toEqual([
      { tipo: "inicio", aba: "eu" },
      { tipo: "painel", painel: "silenciados" },
    ]);
  });
});

describe("urlDaPilha / urlAoAbrir / urlDoPai", () => {
  it("ida e volta pela URL", () => {
    for (const s of ["", "?aba=atividade", "?agent=nina", "?agent=nina&painel=contexto", "?channel=c1&thread=m9", "?aba=eu&painel=silenciados"]) {
      expect(urlDaPilha(pilhaDaUrl(s))).toBe(`/chat${s}`);
    }
  });

  it("abrir conversa a partir da lista e painel a partir da conversa", () => {
    expect(urlAoAbrir("", { tipo: "canal", id: "c1" })).toBe("/chat?channel=c1");
    expect(urlAoAbrir("?channel=c1", { tipo: "thread", canal: "c1", raiz: "m9" })).toBe("/chat?channel=c1&thread=m9");
    expect(urlAoAbrir("?agent=nina", { tipo: "painel", painel: "anteriores" })).toBe("/chat?agent=nina&painel=anteriores");
  });

  it("abrir conversa a partir da Atividade mantém a aba para o voltar", () => {
    expect(urlAoAbrir("?aba=atividade", { tipo: "canal", id: "c1" })).toBe("/chat?aba=atividade&channel=c1");
  });

  it("o pai de uma thread aberta por push é o canal, e o do canal é a lista", () => {
    expect(urlDoPai("?channel=c1&thread=m9")).toBe("/chat?channel=c1");
    expect(urlDoPai("?channel=c1")).toBe("/chat");
    expect(urlDoPai("?agent=nina&painel=arquivos")).toBe("/chat?agent=nina");
    expect(urlDoPai("")).toBe("/chat");
  });

  it("trocar de aba não empilha conversa", () => {
    expect(urlDaAba("eu")).toBe("/chat?aba=eu");
    expect(urlDaAba("conversas")).toBe("/chat");
  });
});

describe("usaAppCelular", () => {
  it("só no celular e só na raiz e no /chat", () => {
    expect(usaAppCelular(true, "/chat")).toBe(true);
    expect(usaAppCelular(true, "/")).toBe(true);
    expect(usaAppCelular(true, "/settings")).toBe(false);
    expect(usaAppCelular(false, "/chat")).toBe(false);
  });
});
