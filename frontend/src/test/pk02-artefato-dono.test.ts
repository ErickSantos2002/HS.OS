/**
 * PK-02 — artefato vivo só lê dados para o dono (25/11/2026).
 *
 * A ponte do artefato agia com a sessão de QUEM VÊ: uma página gerada sob
 * injeção no chat de qualquer pessoa, aberta pelo CEO, lia as conversas do CEO
 * (`/artefatos/consultar` com o token dele) e, sem CSP, mandava para fora.
 */
import { describe, expect, it } from "vitest";
import { CSP_DO_ARTEFATO, comCsp, podeUsarDados, quemVeParaOArtefato } from "@/lib/artefato-dono";

const DONO = "11111111-1111-1111-1111-111111111111";
const OUTRA = "22222222-2222-2222-2222-222222222222";

describe("podeUsarDados", () => {
  it("dono, fora do modo público: pode", () => {
    expect(podeUsarDados({ publicMode: false, donoId: DONO, quemVeId: DONO })).toBe(true);
  });
  it("outra pessoa logada abrindo pelo id: não", () => {
    expect(podeUsarDados({ publicMode: false, donoId: DONO, quemVeId: OUTRA })).toBe(false);
  });
  it("link público, mesmo o dono logado: não", () => {
    expect(podeUsarDados({ publicMode: true, donoId: DONO, quemVeId: DONO })).toBe(false);
  });
  it("sem saber o dono ou quem vê: não", () => {
    expect(podeUsarDados({ publicMode: false, donoId: undefined, quemVeId: DONO })).toBe(false);
    expect(podeUsarDados({ publicMode: false, donoId: DONO, quemVeId: undefined })).toBe(false);
  });
});

describe("quemVeParaOArtefato", () => {
  const user = { id: DONO, email: "ana@hs.com" };
  it("o dono recebe id, papel e nome — nunca o e-mail", () => {
    const q = quemVeParaOArtefato({ user, nome: "Ana", papel: "colaborador", ehDono: true });
    expect(q).toEqual({ id: DONO, role: "colaborador", name: "Ana" });
    expect(JSON.stringify(q)).not.toContain("ana@hs.com");
  });
  it("quem não é dono não é apresentado ao HTML", () => {
    expect(quemVeParaOArtefato({ user, nome: "Ana", papel: "colaborador", ehDono: false })).toBeNull();
  });
});

describe("comCsp", () => {
  it("documento com doctype: CSP logo depois dele, antes de qualquer script", () => {
    const html = "<!DOCTYPE html><html><script>fetch('https://x')</script><head></head></html>";
    const saida = comCsp(html);
    expect(saida.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(saida.indexOf(CSP_DO_ARTEFATO)).toBeLessThan(saida.indexOf("<script>"));
  });
  it("fragmento: CSP no começo", () => {
    expect(comCsp("<div>oi</div>").startsWith(CSP_DO_ARTEFATO)).toBe(true);
  });
  it("bloqueia rede, formulário e base", () => {
    expect(CSP_DO_ARTEFATO).toContain("connect-src 'none'");
    expect(CSP_DO_ARTEFATO).toContain("form-action 'none'");
    expect(CSP_DO_ARTEFATO).toContain("base-uri 'none'");
  });
});
