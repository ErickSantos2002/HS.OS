/**
 * O changelog é o que a pessoa lê para saber o que mudou — e é dele que sai a
 * versão do rodapé. Os dois defeitos que estes testes trancam são silenciosos:
 *
 * - **Versão nova no lugar errado da lista.** O modal abre sozinho quando o
 *   topo da lista muda; uma entrada acrescentada no FIM não muda o topo, e o
 *   time nunca vê a novidade — nem a versão do rodapé anda.
 * - **Abrir a cada carregamento.** Se a comparação com a versão vista falhar
 *   (chave diferente, valor com espaço), o modal vira um pop-up em toda tela,
 *   que é o jeito mais rápido de ensinar todo mundo a fechar sem ler.
 */
import { describe, expect, it } from "vitest";

import { CHANGELOG, VERSAO_ATUAL } from "@/data/changelog";
import { deveMostrarNovidades } from "@/lib/novidades";

function partes(v: string): number[] {
  return v.split(".").map(Number);
}

function maior(a: string, b: string): boolean {
  const [x, y] = [partes(a), partes(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

describe("changelog", () => {
  it("a versão atual é a do topo da lista", () => {
    expect(VERSAO_ATUAL).toBe(CHANGELOG[0].version);
  });

  it("toda versão é semver X.Y.Z, sem 'v' na frente", () => {
    for (const v of CHANGELOG) expect(v.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("a mais recente vem primeiro, sem versão repetida", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(maior(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBe(true);
    }
  });

  it("datas em ISO e nunca andando para trás de cima para baixo", () => {
    for (let i = 0; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (i > 0) expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
    }
  });

  it("toda versão diz o que mudou", () => {
    for (const v of CHANGELOG) {
      expect(v.changes.length).toBeGreaterThan(0);
      for (const c of v.changes) expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("deveMostrarNovidades", () => {
  it("abre para quem nunca viu", () => {
    expect(deveMostrarNovidades(null, "2.2.0")).toBe(true);
  });

  it("abre quando há versão que a pessoa ainda não viu", () => {
    expect(deveMostrarNovidades("2.1.0", "2.2.0")).toBe(true);
  });

  it("não abre de novo na mesma versão", () => {
    expect(deveMostrarNovidades("2.2.0", "2.2.0")).toBe(false);
  });

  it("não abre ao voltar para uma versão mais velha (deploy revertido)", () => {
    expect(deveMostrarNovidades("2.3.0", "2.2.0")).toBe(false);
  });

  it("valor guardado ilegível conta como nunca visto", () => {
    expect(deveMostrarNovidades("lixo", "2.2.0")).toBe(true);
  });
});
