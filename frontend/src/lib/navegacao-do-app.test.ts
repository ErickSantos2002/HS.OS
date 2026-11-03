import { describe, expect, it } from "vitest";
import { LISTA_NEGADA, ehNavegacaoDoApp } from "./navegacao-do-app";

/**
 * O que estes testes protegem: **o fallback offline do service worker só
 * responde por telas do app.** Se ele servisse o `index.html` para `/api`,
 * `/ws`, `/storage` ou `/artifact`, uma navegação para baixar um arquivo ou
 * abrir um artefato publicado receberia a casca do SPA no lugar — com rede ou
 * sem, porque o SW atende antes da rede.
 */

const CASOS: Array<[string, boolean]> = [
  ["/", true],
  ["/chat", true],
  ["/chat?agent=nina", true],
  ["/settings", true],
  ["/api", false],
  ["/api/conversations/1/reply", false],
  ["/ws", false],
  ["/storage/anexos/a/b.pdf", false],
  ["/artifact/123", false],
  // Prefixo é segmento de caminho, não substring.
  ["/apis", true],
  ["/storagex", true],
];

describe("ehNavegacaoDoApp", () => {
  it.each(CASOS)("%s → %s", (caminho, esperado) => {
    expect(ehNavegacaoDoApp(caminho)).toBe(esperado);
  });
});

describe("LISTA_NEGADA (o denylist do NavigationRoute)", () => {
  // O Workbox testa a lista contra pathname + search. Ela tem que concordar
  // com a função acima, que é a que dá para ler.
  it.each(CASOS)("%s → app=%s", (caminho, esperado) => {
    const negado = LISTA_NEGADA.some((re) => re.test(caminho));
    expect(!negado).toBe(esperado);
  });
});
