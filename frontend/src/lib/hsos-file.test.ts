import { describe, expect, it } from "vitest";
import { validarArquivo, versaoDoArquivo } from "./hsos-file";

/**
 * O que estes testes protegem: **arquivo exportado antes do rebrand tem que
 * continuar importando.**
 *
 * O formato de exportação passou de `.dnos`/`dnos_version` para
 * `.hsos`/`hsos_version` em 11/08/2026. Quem já tinha um agente exportado não
 * sabe que o nome mudou, e recusar o arquivo por causa de uma chave seria uma
 * regressão silenciosa — o erro apareceria como "Campo hsos_version ausente",
 * que não ajuda ninguém a entender que o arquivo está certo.
 *
 * Se um dia alguém remover a tolerância ao nome antigo, que seja de propósito
 * e com estes testes na frente.
 */

const base = {
  agent: { agent_id: "nina", name: "Nina" },
  files: { "SOUL.md": "# alma" },
};

describe("versaoDoArquivo", () => {
  it("lê o campo novo", () => {
    expect(versaoDoArquivo({ hsos_version: "1.1" })).toBe("1.1");
  });

  it("lê o campo antigo, de arquivo exportado antes do rebrand", () => {
    expect(versaoDoArquivo({ dnos_version: "1.1" })).toBe("1.1");
  });

  it("prefere o novo quando os dois estão presentes", () => {
    // A exportação de hoje grava os dois. Se um dia divergirem, o que vale é
    // o desta plataforma.
    expect(versaoDoArquivo({ hsos_version: "2.0", dnos_version: "1.1" })).toBe("2.0");
  });

  it("devolve null sem nenhum dos dois", () => {
    expect(versaoDoArquivo({})).toBeNull();
    expect(versaoDoArquivo(null)).toBeNull();
  });
});

describe("validarArquivo", () => {
  it("aceita o formato novo", () => {
    expect(validarArquivo({ ...base, hsos_version: "1.1" })).toBeNull();
  });

  it("aceita o formato antigo", () => {
    expect(validarArquivo({ ...base, dnos_version: "1.1" })).toBeNull();
  });

  it("recusa arquivo sem versão nenhuma", () => {
    expect(validarArquivo(base)).toMatch(/vers/i);
  });

  it("recusa agent_id fora do formato", () => {
    // O agent_id vira nome de pasta no workspace — daí a validação apertada.
    expect(validarArquivo({ ...base, hsos_version: "1.1", agent: { agent_id: "../fuga", name: "x" } }))
      .toMatch(/agent_id/);
  });

  it("exige SOUL.md, que é o que define o agente", () => {
    expect(validarArquivo({ ...base, hsos_version: "1.1", files: {} })).toMatch(/SOUL/);
  });
});
