/**
 * "Capacidade" do Guardi (spec 2026-11-13). O que tranca: sistema que não
 * respondeu nunca parece "pode tudo" nem "não pode nada" — cada estado tem a
 * sua linha; o resumo do cartão conta assuntos e frases; e a cor e o ícone que o
 * backend manda são os que a tela sabe desenhar.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORES_CONHECIDAS, classesDaCor, resumoDoSistema, temConfirmacao, textoDoEstado, urlDaCapacidade,
  type AssuntoDaCapacidade, type SistemaDaCapacidade,
} from "./capacidade";
import { ICONES_CONHECIDOS, iconeDoAssunto } from "./capacidade-icones";

const assunto = (extra: Partial<AssuntoDaCapacidade> = {}): AssuntoDaCapacidade => ({
  chave: "ausencias", titulo: "Férias e ausências", icone: "plane", cor: "sky",
  ve: [], faz: [], na_hora: [], exemplos: [], ...extra,
});
const base: SistemaDaCapacidade = { sistema: "talenths", nome: "TalentHS", papel: "Colaborador", estado: "ok", assuntos: [] };

/** Uma tupla de strings do Python: `NOME = ( "a", "b", … )`. */
function tuplaDoBackend(nome: string): string[] {
  const py = readFileSync(resolve(__dirname, "../../../backend/app/capacidade_assuntos.py"), "utf8");
  const m = py.match(new RegExp(`^${nome} = \\(([\\s\\S]*?)\\n?\\)`, "m"));
  if (!m) throw new Error(`${nome} não achado`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("capacidade", () => {
  it("cada estado fora do ok tem a sua explicação", () => {
    expect(textoDoEstado("ok")).toBeNull();
    expect(textoDoEstado("sem_conta")).toMatch(/conta ativa/);
    expect(textoDoEstado("fora_do_ar")).toMatch(/Fora do ar/);
    // ⚠️ Nunca "pode tudo": diz que ainda não sabe e manda perguntar ao Guardi.
    expect(textoDoEstado("sem_resposta_de_capacidade")).toMatch(/pergunte ao Guardi/);
  });

  it("o resumo conta assuntos e frases; ok vazio não se confunde com sem resposta", () => {
    const s = { ...base, assuntos: [assunto({ ve: ["a", "b"], faz: ["c"] }), assunto({ chave: "ponto", ve: ["d"] })] };
    expect(resumoDoSistema(s)).toBe("2 assuntos · vê 3 · faz 1");
    expect(resumoDoSistema({ ...base, assuntos: [assunto({ ve: ["a"] })] })).toBe("1 assunto · vê 1");
    expect(resumoDoSistema(base)).toBe("nada com o seu login");
    expect(resumoDoSistema({ ...base, estado: "sem_resposta_de_capacidade" })).toBe("ainda sem resposta");
    expect(resumoDoSistema({ ...base, estado: "fora_do_ar" })).toBe("fora do ar");
  });

  it("confirmação só quando algo do 'faz' não sai na hora", () => {
    expect(temConfirmacao({ ...base, assuntos: [assunto({ faz: ["a"] })] })).toBe(true);
    expect(temConfirmacao({ ...base, assuntos: [assunto({ faz: ["a"], na_hora: ["a"] })] })).toBe(false);
    expect(temConfirmacao({ ...base, assuntos: [assunto({ ve: ["a"] })] })).toBe(false);
  });

  it("cores e ícones do backend são os que a tela desenha", () => {
    // ⚠️ Uma cor nova lá sem a classe escrita aqui cai no cinza em silêncio, e o
    // ícone novo vira um ponto de interrogação: o assunto perde o destaque que
    // era o pedido inteiro ("colorido, fácil de entender").
    expect(new Set(tuplaDoBackend("CORES"))).toEqual(new Set(CORES_CONHECIDAS));
    expect(new Set(tuplaDoBackend("ICONES"))).toEqual(new Set(ICONES_CONHECIDOS));
    expect(classesDaCor("nao-existe").faixa).toBe("border-l-border");
    expect(iconeDoAssunto("nao-existe")).toBeTruthy();
  });

  it("atualizar pede ao backend que ignore o cache", () => {
    expect(urlDaCapacidade("ana-bot")).toBe("/bots/capacidade/ana-bot");
    expect(urlDaCapacidade("ana-bot", true)).toBe("/bots/capacidade/ana-bot?atualizar=true");
  });
});
