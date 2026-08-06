/**
 * Envio e espera de resposta do agente, pela nossa API.
 *
 * Substitui o miolo de rede do `chat-sender.ts`, que falava HTTP com SSE em
 * `/v1/chat/completions` do gateway — rota que **não existe mais**. O contrato
 * novo é assíncrono: dispara e espera.
 *
 * Duas diferenças de fundo em relação ao caminho antigo, e nenhuma é escolha
 * estética:
 *
 * 1. **O histórico não vai mais junto.** O código antigo montava a conversa
 *    inteira a cada turno (`limitHistory`, `toChatMessages`) e mandava no corpo.
 *    Agora quem guarda a conversa é a sessão do agente no gateway — mandar de
 *    novo duplicaria o contexto e estouraria a janela mais rápido.
 * 2. **Não há streaming.** `agent.wait` devolve a resposta pronta. A espera é
 *    long-poll, então a latência é a do agente, não a de um intervalo de
 *    perguntas; mas o texto aparece de uma vez. Streaming token a token exige
 *    eventos no WebSocket e está na fila do pós-entrega.
 */

import { api, ErroApi } from "@/lib/api";

/** Quantas rodadas de espera antes de desistir. Cada uma segura até 20s no
 *  servidor, então isto é ~10 minutos de tolerância — o suficiente para turno
 *  longo com ferramenta, sem deixar a tela pendurada para sempre. */
const MAX_ESPERAS = 30;

export interface RespostaDoAgente {
  status: "pronta" | "erro";
  /** Texto da resposta quando `pronta`. */
  content?: string;
  /** Id da linha já gravada em `conversations`, para a tela reconciliar. */
  messageId?: string;
  createdAt?: string;
  detalhe?: string;
}

interface RespostaApi {
  status: "executando" | "pronta" | "erro";
  message?: { id: string; content: string; created_at: string };
  detalhe?: string;
}

/**
 * Dispara o agente e espera a resposta.
 *
 * A mensagem do usuário **já deve estar gravada** antes desta chamada — quem
 * faz isso é a tela, que precisa da linha persistida para trocar pela bolha
 * otimista. Aqui só se dispara e se espera.
 *
 * `sinal` permite cancelar a espera quando o usuário aperta parar ou troca de
 * conversa. Cancelar não aborta o agente no gateway: ele termina e a resposta
 * fica gravada, aparecendo no próximo carregamento. Abortar de verdade é
 * `chat.abort`, que ainda não foi portado.
 */
export async function enviarParaAgente(
  agentId: string,
  content: string,
  sinal?: AbortSignal,
): Promise<RespostaDoAgente> {
  let runId: string;
  try {
    const r = await api<{ run_id: string }>(
      `/conversations/${encodeURIComponent(agentId)}/send`,
      { method: "POST", body: { content }, signal: sinal },
    );
    runId = r.run_id;
  } catch (e) {
    return { status: "erro", detalhe: mensagemDeErro(e) };
  }

  for (let i = 0; i < MAX_ESPERAS; i++) {
    if (sinal?.aborted) return { status: "erro", detalhe: "Espera cancelada." };
    try {
      const r = await api<RespostaApi>(
        `/conversations/${encodeURIComponent(agentId)}/reply?run_id=${encodeURIComponent(runId)}`,
        { signal: sinal },
      );
      if (r.status === "executando") continue;
      if (r.status === "pronta" && r.message) {
        return {
          status: "pronta",
          content: r.message.content,
          messageId: r.message.id,
          createdAt: r.message.created_at,
        };
      }
      return { status: "erro", detalhe: r.detalhe ?? "O agente não respondeu." };
    } catch (e) {
      if (sinal?.aborted) return { status: "erro", detalhe: "Espera cancelada." };
      // Rede instável no meio de uma espera longa não é motivo para desistir do
      // turno — o agente continua trabalhando do outro lado. Só erro de regra
      // (4xx) encerra.
      if (e instanceof ErroApi && e.status >= 400 && e.status < 500) {
        return { status: "erro", detalhe: mensagemDeErro(e) };
      }
    }
  }

  return {
    status: "erro",
    detalhe: "O agente passou do tempo máximo de espera. Se ele terminar, a "
      + "resposta aparece ao recarregar a conversa.",
  };
}

function mensagemDeErro(e: unknown): string {
  if (e instanceof ErroApi) {
    if (e.indisponivel) return "Não foi possível falar com o servidor.";
    return e.message;
  }
  return (e as Error)?.message ?? "Erro desconhecido.";
}
