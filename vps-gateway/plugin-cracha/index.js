// hsos-cracha — crachá assinado do turno (PK-11, 26/11/2026).
//
// ⚠️ O gateway não diz ao MCP de que sessão veio a chamada, e o Guardi só pode
// usar e-mail e sistemas no turno do DONO. O backend deduzia isso por
// `agent_runs` e, com admin e dono conversando com o bot ao mesmo tempo, não
// sabia de quem era a chamada. Este plugin, no `before_tool_call`, grava em
// `_cracha` o agente, a chave da sessão e o run, assinados com HMAC-SHA256 —
// e o backend confere (`backend/app/cracha.py`).
//
// ⚠️ O gancho é FAIL-CLOSED: se isto lançar, a ferramenta é bloqueada. Tudo
// fica dentro de try/catch e, na dúvida, não carimba — sem crachá o backend
// volta à dedução de antes, que é o comportamento de hoje.
//
// O segredo mora num arquivo 0600 FORA do openclaw.json: o `config.get` que o
// backend lê não o devolve, e os agentes com `exec` estão em sandbox (PK-06).
import crypto from "node:crypto";
import fs from "node:fs";

export const CAMPO = "_cracha";
export const ARQUIVO_SEGREDO = process.env.HSOS_CRACHA_SEGREDO_ARQ || "/root/.config/hsos-cracha/segredo";
// Só as ferramentas que decidem pela pessoa — e cujo backend sabe tirar o campo.
// Carimbar as outras `hsos-*` poria um argumento a mais em rota que não o espera.
const ALVO = /^(?:mcp__)?hsos-(?:email|bot)-/;

export function assinar(segredo, agente, sessao, run, ts) {
  return crypto.createHmac("sha256", segredo).update([agente, sessao, run, String(ts)].join("\n")).digest("hex");
}

export function carimbar(segredo, event, ctx, agora = () => Date.now()) {
  try {
    if (!segredo) return undefined;
    const nome = String(event?.toolName || "");
    if (!ALVO.test(nome)) return undefined;
    const p = event?.params;
    if (!p || typeof p !== "object" || Array.isArray(p)) return undefined;
    const agente = String(ctx?.agentId || "");
    const sessao = String(ctx?.sessionKey || "");
    if (!agente || !sessao) return undefined;
    const run = String(ctx?.runId || event?.runId || "");
    const ts = Math.floor(agora() / 1000);
    // O que o modelo tiver posto em `_cracha` é descartado: o campo é sempre o nosso.
    const { [CAMPO]: _ignorado, ...resto } = p;
    return { params: { ...resto, [CAMPO]: { agente, sessao, run, ts, sig: assinar(segredo, agente, sessao, run, ts) } } };
  } catch {
    return undefined;
  }
}

function lerSegredo() {
  try { return fs.readFileSync(ARQUIVO_SEGREDO, "utf8").trim() || null; } catch { return null; }
}

export default {
  id: "hsos-cracha",
  name: "HS.OS — crachá do turno",
  description: "Carimba as chamadas hsos-email/hsos-bot com a sessão de origem, assinada.",
  register(api) {
    const segredo = lerSegredo();
    if (!segredo) api?.logger?.warn?.(`hsos-cracha: sem ${ARQUIVO_SEGREDO}; chamadas seguem sem crachá`);
    api.on("before_tool_call", (event, ctx) => carimbar(segredo, event, ctx), { priority: 10, timeoutMs: 1000 });
  },
};
