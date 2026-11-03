import { describe, expect, it } from "vitest";

import { horaDaLista, linhaDaPrevia, montarLista, type ItemCelular } from "./lista";

const AGORA = new Date(2026, 10, 3, 9, 50); // terça, 03/11/2026 09:50 local

function item(p: Partial<ItemCelular> & Pick<ItemCelular, "id" | "tipo" | "nome">): ItemCelular {
  return {
    chave: `${p.tipo}:${p.id}`, canalId: null, subtitulo: "", previa: null, naoLidas: 0,
    silenciado: false, pensando: false, ...p,
  };
}

const itens: ItemCelular[] = [
  item({ id: "marina", tipo: "pessoa", nome: "Marina Costa", canalId: "dm1", previa: { texto: "Combinado, mando a planilha", quando: AGORA.getTime() - 38 * 60e3, minha: true, lida: true } }),
  item({ id: "camila", tipo: "pessoa", nome: "Camila Rocha" }),
  item({ id: "bruno", tipo: "pessoa", nome: "Bruno Alves" }),
  item({ id: "rafael", tipo: "pessoa", nome: "Rafael Lima", canalId: "dm2", previa: { texto: "👍", quando: AGORA.getTime() - 2 * 864e5, minha: false } }),
  item({ id: "nina", tipo: "agente", nome: "Nina", previa: { texto: "Em outubro de 2025…", quando: AGORA.getTime() - 9 * 60e3, minha: false }, naoLidas: 1 }),
  item({ id: "iris", tipo: "agente", nome: "Iris", pensando: true, previa: { texto: "Faturamento líquido", quando: AGORA.getTime() - 53 * 60e3, minha: false } }),
  item({ id: "c-op", tipo: "canal", nome: "operacao", silenciado: true, naoLidas: 12, previa: { texto: "3 calibrações", quando: AGORA.getTime() - 864e5, minha: false, autor: "Flow" } }),
];

describe("montarLista", () => {
  it("o chip filtra pelo tipo — não existe 'Tudo'", () => {
    expect(montarLista(itens, "agente", "").map((i) => i.id)).toEqual(["nina", "iris"]);
    expect(montarLista(itens, "canal", "").map((i) => i.id)).toEqual(["c-op"]);
  });

  it("ordena pela última mensagem; quem nunca conversou vai para o fim, em ordem alfabética", () => {
    expect(montarLista(itens, "pessoa", "").map((i) => i.id)).toEqual(["marina", "rafael", "bruno", "camila"]);
  });

  it("não lida não fura a fila: a ordem é a do WhatsApp, pela hora", () => {
    const comNaoLida = itens.map((i) => (i.id === "rafael" ? { ...i, naoLidas: 3 } : i));
    expect(montarLista(comNaoLida, "pessoa", "")[0].id).toBe("marina");
  });

  it("a busca casa o nome e a prévia, sem acento", () => {
    expect(montarLista(itens, "pessoa", "planilha").map((i) => i.id)).toEqual(["marina"]);
    expect(montarLista(itens, "agente", "liquido").map((i) => i.id)).toEqual(["iris"]);
    expect(montarLista(itens, "pessoa", "rafa").map((i) => i.id)).toEqual(["rafael"]);
  });
});

describe("linhaDaPrevia", () => {
  it("em canal, mensagem dos outros leva o primeiro nome de quem escreveu", () => {
    expect(linhaDaPrevia(itens[6])).toEqual({ autor: "Flow", texto: "3 calibrações" });
  });
  it("em DM não há prefixo, e a minha não leva nome", () => {
    expect(linhaDaPrevia(itens[0])).toEqual({ autor: null, texto: "Combinado, mando a planilha" });
  });
  it("sem conversa ainda, a linha é vazia", () => {
    expect(linhaDaPrevia(itens[1])).toEqual({ autor: null, texto: "" });
  });
});

describe("horaDaLista", () => {
  it("hoje é a hora, ontem é 'ontem', na semana o dia, depois a data", () => {
    expect(horaDaLista(new Date(2026, 10, 3, 9, 12).getTime(), AGORA)).toBe("09:12");
    expect(horaDaLista(new Date(2026, 10, 2, 18, 0).getTime(), AGORA)).toBe("ontem");
    expect(horaDaLista(new Date(2026, 10, 1, 18, 0).getTime(), AGORA)).toBe("dom");
    expect(horaDaLista(new Date(2026, 9, 27, 18, 0).getTime(), AGORA)).toBe("27/10");
    expect(horaDaLista(0, AGORA)).toBe("");
  });
});
