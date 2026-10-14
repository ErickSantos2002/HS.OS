/**
 * O visto por mensagem, igual ao WhatsApp — a decisão do que a bolha mostra.
 * Spec: docs/superpowers/specs/2026-10-14-vistos-por-mensagem-design.md
 *
 * Canal: o estado vem do servidor (`GET /channels/{id}/recibos`).
 * Agente: o servidor diz o que sabe (`recibo` no histórico) e a tela corrige
 * com o que só ela vê na hora — o agente trabalhando, a resposta que acabou de
 * chegar, o erro do envio.
 */
import type { ChatMessage } from "./mock-data";

export type EstadoDoVisto = "pendente" | "enviada" | "entregue" | "lida" | "falhou";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DO_SERVIDOR = new Set(["enviada", "entregue", "lida", "falhou"]);

export function estadoNoCanal(msgId: string, recibos: Record<string, string>): EstadoDoVisto {
  if (msgId.startsWith("optimistic-")) return "pendente";
  const e = recibos[msgId];
  return e && DO_SERVIDOR.has(e) ? (e as EstadoDoVisto) : "enviada";
}

/**
 * ⚠️ Resposta depois vence qualquer `recibo` do servidor: o `/recuperar` grava
 * resposta sem ligar ao run, e o servidor pode ter dito "falhou" antes dela.
 */
export function estadoNoAgente(msgs: ChatMessage[], indice: number, agenteTrabalhando: boolean): EstadoDoVisto {
  const msg = msgs[indice];
  if (!UUID_RE.test(msg.id)) return "pendente";
  let ultimaPergunta = true;
  for (let i = indice + 1; i < msgs.length; i++) {
    const depois = msgs[i];
    if (depois.role === "agent") return depois.isError ? "falhou" : "lida";
    ultimaPergunta = false;
  }
  if (ultimaPergunta && agenteTrabalhando) return "entregue";
  return msg.recibo && DO_SERVIDOR.has(msg.recibo) ? msg.recibo : "enviada";
}
