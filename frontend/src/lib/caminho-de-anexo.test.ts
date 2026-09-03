/**
 * ⚠️ **O caminho do anexo era adivinhável, e o balde é de leitura pública.**
 *
 * `agent-files` é público de propósito — está escrito em `app/routers/storage.py`
 * — e por dois motivos que continuam válidos: avatar aparece em `<img src>`, que
 * não manda `Authorization`, e **o agente busca o arquivo do lado do gateway**,
 * onde não teria como carregar o nosso token.
 *
 * A defesa declarada para isso é uma só: *"o caminho carrega um id difícil de
 * adivinhar"*. Para anexo de canal isso não era verdade. O caminho era
 * `channel-<uuid do canal>/<epoch em ms>_<nome original do arquivo>`, e medido
 * na pilha local em 03/09/2026 o `epoch` do arquivo ficou a **65 ms** do
 * `created_at` da mensagem — que a API devolve com precisão de microssegundo.
 * Quem conhecesse o canal e o nome do arquivo reconstruía a URL.
 *
 * Demonstrado no mesmo dia: numa conversa **privada**, a API recusa quem não é
 * membro (devolve lista vazia) e o arquivo era servido a uma requisição **sem
 * token nenhum**.
 *
 * Isto **não** fecha o buraco maior — URL pública é permanente e repassável.
 * Fecha o que dava para fechar sem mexer no que o agente e o `<img>` precisam.
 */
import { describe, it, expect } from "vitest";
import { caminhoDeAnexo } from "./caminho-de-anexo";

describe("caminhoDeAnexo", () => {
  it("não deixa o nome original no caminho", () => {
    const c = caminhoDeAnexo("channel-abc", "Folha de pagamento 2026.pdf");
    expect(c.toLowerCase()).not.toContain("folha");
    expect(c.toLowerCase()).not.toContain("pagamento");
  });

  it("mantém a extensão — é dela que sai o Content-Type servido", () => {
    // Sem extensão o storage devolve octet-stream e `<img src>` para de
    // renderizar; era assim que este conserto quebraria avatar e imagem.
    expect(caminhoDeAnexo("channel-abc", "grafico.PNG")).toMatch(/\.png$/);
  });

  it("guarda o arquivo dentro do prefixo que recebeu", () => {
    expect(caminhoDeAnexo("channel-abc", "x.pdf").startsWith("channel-abc/")).toBe(true);
  });

  it("dois envios do mesmo arquivo não colidem", () => {
    const a = caminhoDeAnexo("channel-abc", "igual.pdf");
    const b = caminhoDeAnexo("channel-abc", "igual.pdf");
    expect(a).not.toBe(b);
  });

  it("arquivo sem extensão não vira caminho quebrado", () => {
    const c = caminhoDeAnexo("channel-abc", "LEIAME");
    expect(c.startsWith("channel-abc/")).toBe(true);
    expect(c).not.toContain("LEIAME");
    expect(c.endsWith(".")).toBe(false);
  });

  it("extensão esquisita não escapa do diretório", () => {
    // O storage valida segmento por segmento, mas mandar barra ou ponto-ponto
    // daqui seria pedir 400 no meio de um envio que a pessoa acha que deu certo.
    const c = caminhoDeAnexo("channel-abc", "malicioso.../../etc/passwd");
    expect(c.split("/")).toHaveLength(2);
    expect(c).not.toContain("..");
  });
});
