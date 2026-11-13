/**
 * "Capacidade" do Guardi (spec 2026-11-13). O que tranca: sistema que não
 * respondeu nunca parece "pode tudo" nem "não pode nada" — cada estado tem a
 * sua linha, e a lista só vem com `ok`.
 */
import { describe, expect, it } from "vitest";
import { resumoDoSistema, textoDoEstado, tituloDoFazer, urlDaCapacidade, type SistemaDaCapacidade } from "./capacidade";

const base: SistemaDaCapacidade = { sistema: "talenths", nome: "TalentHS", papel: "Colaborador", estado: "ok", consultar: [], fazer: [] };

describe("capacidade", () => {
  it("cada estado fora do ok tem a sua explicação", () => {
    expect(textoDoEstado("ok")).toBeNull();
    expect(textoDoEstado("sem_conta")).toMatch(/conta ativa/);
    expect(textoDoEstado("fora_do_ar")).toMatch(/Fora do ar/);
    // ⚠️ Nunca "pode tudo": diz que ainda não sabe e manda perguntar ao Guardi.
    expect(textoDoEstado("sem_resposta_de_capacidade")).toMatch(/pergunte ao Guardi/);
  });

  it("o resumo conta o que veio; ok vazio não se confunde com sem resposta", () => {
    expect(resumoDoSistema({ ...base, consultar: [{ rotulo: "a" }, { rotulo: "b" }], fazer: [{ rotulo: "c", confirma: true }] }))
      .toBe("consulta 2 · faz 1");
    expect(resumoDoSistema(base)).toBe("nada com o seu login");
    expect(resumoDoSistema({ ...base, estado: "sem_resposta_de_capacidade" })).toBe("ainda sem resposta");
    expect(resumoDoSistema({ ...base, estado: "fora_do_ar" })).toBe("fora do ar");
  });

  it("'com sua confirmação' só quando tudo espera o clique", () => {
    expect(tituloDoFazer([{ rotulo: "a", confirma: true }])).toBe("Fazer (com sua confirmação)");
    expect(tituloDoFazer([{ rotulo: "a", confirma: true }, { rotulo: "b", confirma: false }])).toBe("Fazer");
  });

  it("atualizar pede ao backend que ignore o cache", () => {
    expect(urlDaCapacidade("ana-bot")).toBe("/bots/capacidade/ana-bot");
    expect(urlDaCapacidade("ana-bot", true)).toBe("/bots/capacidade/ana-bot?atualizar=true");
  });
});
