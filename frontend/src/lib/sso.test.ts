/**
 * Login com Microsoft, lado do navegador.
 *
 * O que estes testes trancam: o nonce é de uso único (é ele que impede um link
 * com o ticket de OUTRA pessoa de logar quem clicou), e falha ao perguntar o
 * status esconde o botão em vez de quebrar a tela de login.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { consumirNonceSso, mensagemErroSso, prepararLoginMicrosoft, ssoAtivo, trocarTicket } from "@/lib/sso";
import { lerToken } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function respostaJson(status: number, corpo: unknown) {
  return Promise.resolve(new Response(JSON.stringify(corpo), { status }));
}

describe("nonce", () => {
  it("sem clicar no botão não há nonce — o ticket de um link alheio é recusado", () => {
    expect(consumirNonceSso()).toBe(false);
  });

  it("vale uma vez só", () => {
    prepararLoginMicrosoft();
    expect(consumirNonceSso()).toBe(true);
    expect(consumirNonceSso()).toBe(false);
  });
});

describe("ssoAtivo", () => {
  it("true só quando o backend diz ativo", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respostaJson(200, { ativo: true })));
    expect(await ssoAtivo()).toBe(true);
  });

  it("backend fora do ar esconde o botão em vez de lançar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await ssoAtivo()).toBe(false);
  });
});

describe("trocarTicket", () => {
  it("guarda o token devolvido, como o login por senha", async () => {
    const fetch = vi.fn(() => respostaJson(200, { access_token: "jwt-do-hsos", expires_in: 1 }));
    vi.stubGlobal("fetch", fetch);
    await trocarTicket("t1");
    expect(lerToken()).toBe("jwt-do-hsos");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/auth\/sso\/exchange$/);
    expect(JSON.parse(String(init.body))).toEqual({ ticket: "t1" });
  });

  it("ticket recusado propaga a mensagem do backend e não grava nada", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respostaJson(400, { detail: "Link de acesso inválido ou expirado." })));
    await expect(trocarTicket("t1")).rejects.toThrow("Link de acesso inválido ou expirado.");
    expect(lerToken()).toBeNull();
  });
});

describe("mensagemErroSso", () => {
  it("cada código tem texto; o desconhecido cai no genérico", () => {
    expect(mensagemErroSso(null)).toBeNull();
    expect(mensagemErroSso("usuario_nao_encontrado")).toMatch(/não tem acesso/);
    expect(mensagemErroSso("cancelado")).toBe("Login com Microsoft cancelado.");
    expect(mensagemErroSso("state_invalido")).toMatch(/Tente de novo/);
  });
});
