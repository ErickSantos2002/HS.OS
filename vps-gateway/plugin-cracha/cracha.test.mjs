// node --test vps-gateway/plugin-cracha/cracha.test.mjs
// ⚠️ A assinatura tem que bater com a do Python (`backend/app/cracha.py`): o
// valor esperado abaixo foi calculado por ela. Divergir aqui é crachá recusado
// em toda chamada do Guardi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assinar, carimbar, CAMPO } from "./index.js";

const SEG = "segredo-de-teste";
const SESSAO = "agent:erick-bot:hsos-77071556-7a52-41d5-805a-cbbd3923da45";
const ctx = { agentId: "erick-bot", sessionKey: SESSAO, runId: "run-1" };

test("assinatura igual à do Python", () => {
  assert.equal(assinar(SEG, "erick-bot", SESSAO, "run-1", 1800000000),
    "07f637dae3e85eafe9b5f1518f080359d34d38b9e951bb5b52c6b22720b67331");
});

test("carimba e-mail e bot, e troca o crachá que o modelo forjou", () => {
  const r = carimbar(SEG, { toolName: "hsos-email-erick-bot__email_listar",
    params: { x: 1, [CAMPO]: { sig: "forjado" } } }, ctx, () => 1800000000_000);
  assert.equal(r.params.x, 1);
  assert.equal(r.params[CAMPO].sessao, SESSAO);
  assert.equal(r.params[CAMPO].sig, assinar(SEG, "erick-bot", SESSAO, "run-1", 1800000000));
  assert.ok(carimbar(SEG, { toolName: "hsos-bot-erick-bot__lembrar", params: {} }, ctx));
});

test("não toca no que não é alvo, nem sem segredo, nem com params estranho", () => {
  assert.equal(carimbar(SEG, { toolName: "hsos-documentos__documento_ler", params: {} }, ctx), undefined);
  assert.equal(carimbar(SEG, { toolName: "exec", params: {} }, ctx), undefined);
  assert.equal(carimbar(null, { toolName: "hsos-email-a__x", params: {} }, ctx), undefined);
  assert.equal(carimbar(SEG, { toolName: "hsos-email-a__x", params: [1] }, ctx), undefined);
  assert.equal(carimbar(SEG, { toolName: "hsos-email-a__x", params: {} }, {}), undefined);
});

test("nunca lança: o gancho é fail-closed", () => {
  const ruim = { get toolName() { throw new Error("x"); } };
  assert.equal(carimbar(SEG, ruim, ctx), undefined);
});
