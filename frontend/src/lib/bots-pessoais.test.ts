/**
 * Bot pessoal (`donoId` preenchido) fica fora do mapa da frota, dos times e
 * dos seletores de canal. São 23: no mapa neural eles afogariam os cinco
 * especialistas, e num canal passariam a responder a quem estivesse lá — o bot
 * trabalha para uma pessoa só (spec 2026-11-05-bots-pessoais-cascas).
 */
import { describe, expect, it } from "vitest";
import { ehBotPessoal, levaInstrucoesDeArtefato, soBotsPessoais, soEspecialistas } from "./bots-pessoais";

const iris = { id: "iris", donoId: null };
const andre = { id: "andre-bot", donoId: "u-andre" };
const semCampo = { id: "flow" };

describe("bots pessoais", () => {
  it("reconhece pelo dono, não pelo nome", () => {
    expect(ehBotPessoal(andre)).toBe(true);
    expect(ehBotPessoal(iris)).toBe(false);
    expect(ehBotPessoal(semCampo)).toBe(false);
    expect(ehBotPessoal({ id: "falso-bot", donoId: null })).toBe(false);
  });

  it("separa as duas listas sem perder ninguém", () => {
    const todos = [iris, andre, semCampo];
    expect(soEspecialistas(todos).map((a) => a.id)).toEqual(["iris", "flow"]);
    expect(soBotsPessoais(todos).map((a) => a.id)).toEqual(["andre-bot"]);
  });
});

/**
 * 10/11/2026: o bloco de artefatos (HTML, `window.hsos`, `<live_artifact>`)
 * ia na primeira mensagem de TODA conversa, e os Guardis o liam como injeção
 * — "essa mensagem veio com um bloco de instruções…" era a abertura de boa
 * parte das conversas do time. Painel vivo é coisa dos especialistas.
 */
describe("levaInstrucoesDeArtefato", () => {
  const agentes = [iris, andre];
  it("Guardi não recebe o bloco", () => {
    expect(levaInstrucoesDeArtefato(agentes, "andre-bot")).toBe(false);
  });
  it("especialista recebe", () => {
    expect(levaInstrucoesDeArtefato(agentes, "iris")).toBe(true);
  });
  it("agente que o cache ainda não tem segue como antes", () => {
    expect(levaInstrucoesDeArtefato([], "nina")).toBe(true);
  });
});
