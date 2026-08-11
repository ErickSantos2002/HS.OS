import { beforeEach, describe, expect, it } from "vitest";
import { apagarChave, gravarChave, lerChave } from "./chaves-locais";

/**
 * O que estes testes protegem: **o valor que já estava no navegador da pessoa
 * não pode sumir por causa do rebrand.**
 *
 * As flags `dnos_flag_*` são o caso que dói: elas ligam correções no caminho
 * do chat e vêm desligadas por padrão. Renomear sem migrar desligaria as de
 * quem as tinha ligado, e o sintoma seria a volta de um bug já resolvido — sem
 * nada ligando o efeito ao rebrand.
 */

beforeEach(() => localStorage.clear());

describe("lerChave", () => {
  it("lê o nome novo quando ele existe", () => {
    localStorage.setItem("hsos:tema", "escuro");
    expect(lerChave("hsos:tema")).toBe("escuro");
  });

  it("adota o valor do nome antigo quando o novo não existe", () => {
    localStorage.setItem("dnos:tema", "claro");
    expect(lerChave("hsos:tema")).toBe("claro");
  });

  it("migra a flag de estabilidade, que é o caso grave", () => {
    localStorage.setItem("dnos_flag_real_stop", "on");
    expect(lerChave("hsos_flag_real_stop")).toBe("on");
  });

  it("regrava sob o nome novo e apaga o antigo", () => {
    localStorage.setItem("dnos-theme", "dark");
    lerChave("hsos-theme");
    expect(localStorage.getItem("hsos-theme")).toBe("dark");
    expect(localStorage.getItem("dnos-theme")).toBeNull();
  });

  it("o nome novo vence quando os dois existem", () => {
    // Pode acontecer entre duas abas durante a transição. O novo é o que a
    // aplicação está escrevendo agora.
    localStorage.setItem("dnos:x", "velho");
    localStorage.setItem("hsos:x", "novo");
    expect(lerChave("hsos:x")).toBe("novo");
  });

  it("devolve null quando não existe sob nenhum dos dois", () => {
    expect(lerChave("hsos:inexistente")).toBeNull();
  });

  it("não inventa migração para chave sem prefixo conhecido", () => {
    localStorage.setItem("outra-coisa", "x");
    expect(lerChave("qualquer")).toBeNull();
  });
});

describe("apagarChave", () => {
  it("apaga os dois nomes, senão o antigo ressuscita na próxima leitura", () => {
    localStorage.setItem("dnos:y", "velho");
    localStorage.setItem("hsos:y", "novo");
    apagarChave("hsos:y");
    expect(lerChave("hsos:y")).toBeNull();
  });
});

describe("gravarChave", () => {
  it("grava sob o nome novo", () => {
    gravarChave("hsos:z", "1");
    expect(localStorage.getItem("hsos:z")).toBe("1");
  });
});
