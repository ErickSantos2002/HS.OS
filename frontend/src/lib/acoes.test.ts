/**
 * Cartão de ação do bot no TaskHS: o dono confirma o que o PAYLOAD diz, não
 * um texto livre — os campos estruturados aparecem sempre.
 */
import { describe, expect, it } from "vitest";
import { camposDaAcao, rotuloAcao } from "./acoes";

describe("cartão de ação", () => {
  it("status", () => {
    expect(rotuloAcao("feita")).toMatch(/feito/i);
    expect(rotuloAcao("pendente")).not.toMatch(/feito/i);
  });
  it("campos do payload legíveis", () => {
    expect(camposDaAcao("mover", { list_id: 3, card_id: 9, para_list_id: 4 })).toEqual([
      ["Tarefa", "card 9 (lista 3)"], ["Para a lista", "4"]]);
    expect(camposDaAcao("comentar", { list_id: 3, card_id: 9, texto: "ok" })).toEqual([
      ["Tarefa", "card 9 (lista 3)"], ["Comentário", "ok"]]);
    expect(camposDaAcao("atualizar", { list_id: 3, card_id: 9, campos: { done: true } })).toEqual([
      ["Tarefa", "card 9 (lista 3)"], ["Concluída", "sim"]]);
    expect(camposDaAcao("criar", { list_id: 3, title: "Nova", priority: "high" })).toEqual([
      ["Na lista", "3"], ["Título", "Nova"], ["Prioridade", "high"]]);
  });
});
