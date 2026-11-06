/**
 * Cartão de ação do bot no TaskHS: o dono confirma o que o PAYLOAD diz, não
 * um texto livre — os campos estruturados aparecem sempre.
 */
import { describe, expect, it } from "vitest";
import { cartaoDaAcao, rotuloAcao } from "./acoes";

describe("cartão de ação", () => {
  it("status", () => {
    expect(rotuloAcao("feita")).toMatch(/feito/i);
    expect(rotuloAcao("pendente")).not.toMatch(/feito/i);
  });
  it("lista pelo nome quando o servidor resolveu; id só como recurso", () => {
    // 06/11: "Na lista 368" não dizia nada a ninguém.
    expect(cartaoDaAcao("criar", { list_id: 368, title: "T", _exibir: { lista: "EM ANDAMENTO - ERICK" } }).linhas[0])
      .toEqual(["Lista", "EM ANDAMENTO - ERICK"]);
    expect(cartaoDaAcao("criar", { list_id: 368, title: "T" }).linhas[0]).toEqual(["Lista", "lista 368"]);
  });
  it("criar separa descrição e checklist", () => {
    const c = cartaoDaAcao("criar", { list_id: 3, title: "Nova", priority: "high", due_date: "2026-11-10",
      description: "d", checklist: { title: "Checklist", items: ["a", "b"] } });
    expect(c.titulo).toBe("Nova");
    expect(c.linhas).toEqual([["Lista", "lista 3"], ["Membro", "você"], ["Prioridade", "Alta"], ["Prazo", "10/11/2026"]]);
    expect(c.texto).toEqual({ rotulo: "Descrição", valor: "d" });
    expect(c.checklist?.itens.map((i) => i.texto)).toEqual(["a", "b"]);
  });
  it("mover, comentar e atualizar", () => {
    expect(cartaoDaAcao("mover", { list_id: 3, card_id: 9, para_list_id: 4, _exibir: { tarefa: "X", para_lista: "Feito" } }))
      .toMatchObject({ titulo: "X", linhas: [["Para", "Feito"]] });
    expect(cartaoDaAcao("comentar", { list_id: 3, card_id: 9, texto: "ok" }))
      .toMatchObject({ titulo: "card 9", texto: { rotulo: "Comentário", valor: "ok" } });
    const a = cartaoDaAcao("atualizar", { list_id: 3, card_id: 9, campos: { done: true },
      marcar_itens: [{ checklist_id: 5, item_id: 50, checked: true }], _exibir: { itens: { "5:50": "Miguel" } } });
    expect(a.linhas).toEqual([["Concluída", "sim"]]);
    expect(a.checklist?.itens).toEqual([{ texto: "Miguel", feito: true }]);
  });
});
