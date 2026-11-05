/**
 * Rótulos do cartão de aprovação de e-mail. O que importa trancar: o cartão
 * nunca diz "enviado" para o que não saiu, e mostra Cco / Responder-para /
 * anexo quando existem — o hash do servidor os cobre, a tela tem que mostrar.
 */
import { describe, expect, it } from "vitest";
import { linhasDoCartao, rotuloStatus, mensagemDaConexao } from "./email";

describe("cartão de e-mail", () => {
  it("status", () => {
    expect(rotuloStatus("enviado")).toMatch(/enviado/i);
    expect(rotuloStatus("pendente")).not.toMatch(/enviado/i);
    expect(rotuloStatus("vencido")).toMatch(/venc/i);
    expect(rotuloStatus("qualquer")).toBe("qualquer");
  });

  it("linhas extras só quando existem", () => {
    const base = { de: "ti@hs.com.br", para: ["a@y.com"], cc: [], cco: [], responder_para: [], tem_anexo: false };
    expect(linhasDoCartao(base).map((l) => l.rotulo)).toEqual(["De", "Para", "Assinatura"]);
    const cheio = { ...base, cc: ["c@y.com"], cco: ["e@z.com"], responder_para: ["r@z.com"], tem_anexo: true };
    expect(linhasDoCartao(cheio).map((l) => l.rotulo)).toEqual(["De", "Para", "Cc", "Cco", "Responder para", "Anexo", "Assinatura"]);
    expect(linhasDoCartao({ ...cheio, assinatura: true }).map((l) => l.rotulo)).not.toContain("Anexo");
  });

  it("mensagem da volta da Microsoft", () => {
    expect(mensagemDaConexao("conectado")?.tipo).toBe("ok");
    expect(mensagemDaConexao("erro_conta")?.texto).toMatch(/mesma conta/i);
    expect(mensagemDaConexao(null)).toBeNull();
  });
});
