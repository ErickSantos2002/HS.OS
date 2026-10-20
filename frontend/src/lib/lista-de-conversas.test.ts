import { describe, expect, it } from "vitest";
import { casaBusca, ordenarConversas } from "./lista-de-conversas";

/**
 * O que estes testes protegem: **mensagem por ler não pode ficar escondida
 * no meio da lista.** Desde que a aba "Não lidas" saiu (20/10/2026), o único
 * aviso de que alguém escreveu é a conversa subir com o contador. Se a ordem
 * errar, a mensagem fica tão perdida quanto ficava na aba que a engolia.
 */

const item = (nome: string, ultimaAtividade = 0, naoLidas = 0) => ({ nome, ultimaAtividade, naoLidas });

describe("ordenarConversas", () => {
  it("põe quem tem mensagem por ler no topo, mesmo mais antiga", () => {
    const lista = ordenarConversas([item("Ana", 3000), item("Gustavo", 1000, 2)]);
    expect(lista.map((i) => i.nome)).toEqual(["Gustavo", "Ana"]);
  });

  it("entre as não lidas, a mais recente vem primeiro", () => {
    const lista = ordenarConversas([item("Ana", 1000, 1), item("Bia", 2000, 5)]);
    expect(lista.map((i) => i.nome)).toEqual(["Bia", "Ana"]);
  });

  it("depois vem a conversa mais recente", () => {
    const lista = ordenarConversas([item("Ana", 1000), item("Bia", 2000)]);
    expect(lista.map((i) => i.nome)).toEqual(["Bia", "Ana"]);
  });

  it("quem nunca conversou fica embaixo, em ordem alfabética", () => {
    const lista = ordenarConversas([item("Zé"), item("Álvaro"), item("Maria", 500)]);
    expect(lista.map((i) => i.nome)).toEqual(["Maria", "Álvaro", "Zé"]);
  });

  it("não altera a lista recebida", () => {
    const original = [item("B"), item("A")];
    ordenarConversas(original);
    expect(original.map((i) => i.nome)).toEqual(["B", "A"]);
  });
});

describe("casaBusca", () => {
  const gustavo = ["Gustavo Oliveira", "gustavo@hs.com", "Comercial", "Vendedor"];

  it("termo vazio casa todo mundo", () => {
    expect(casaBusca(gustavo, "  ")).toBe(true);
  });

  it("casa pelo setor, não só pelo nome", () => {
    expect(casaBusca(gustavo, "comer")).toBe(true);
  });

  it("ignora acento e caixa", () => {
    expect(casaBusca(["Lidisay", null, "Gestão de Pessoas"], "GESTAO")).toBe(true);
  });

  it("não casa o que não está em campo nenhum", () => {
    expect(casaBusca(gustavo, "financeiro")).toBe(false);
  });
});
