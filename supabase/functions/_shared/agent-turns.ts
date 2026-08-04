// Registro de turnos de agente (tabela agent_turns) — ver a migration
// 20260727100000_agent_turns.sql para o desenho completo.
//
// REGRA DESTE MÓDULO: nada aqui pode atrapalhar o turno. Toda função é
// best-effort — falha vira console.warn e a vida segue. O registro existe
// para o reconciliador; se ele falhar, o comportamento do chat é idêntico
// ao de antes da tabela existir.

// deno-lint-ignore no-explicit-any
type AnyClient = any;

export interface RegisterTurnArgs {
  agentId: string;
  /** Origem humana. Ausente quando quem pediu foi outro agente. */
  userId?: string | null;
  /** Origem agente: num canal, um agente menciona outro e o segundo trabalha
   *  por causa do primeiro. Sem isto, o trabalho era creditado ao último
   *  humano que tinha falado ali. */
  originAgentId?: string | null;
  sessionKey: string;
  userMessageTs: string;
  source?: string;
}

/** Registra o despacho de um turno. Idempotente (chave sessão+mensagem). */
export async function registerTurn(
  supabase: AnyClient,
  args: RegisterTurnArgs,
): Promise<void> {
  try {
    const { error } = await supabase.from("agent_turns").upsert(
      {
        agent_id: args.agentId,
        user_id: args.userId ?? null,
        origin_agent_id: args.originAgentId ?? null,
        session_key: args.sessionKey,
        user_message_ts: args.userMessageTs,
        source: args.source ?? "dm",
        status: "pending",
        dispatched_at: new Date().toISOString(),
      },
      { onConflict: "session_key,user_message_ts", ignoreDuplicates: true },
    );
    if (error) console.warn("[agent-turns] register failed:", error.message);
  } catch (e) {
    console.warn("[agent-turns] register threw:", e instanceof Error ? e.message : e);
  }
}

/**
 * Marca como 'failed' o turno pendente deste (agente, usuário). Chamar ANTES
 * de inserir o marcador de falha em conversations — o trigger de entrega só
 * toca linhas 'pending', então a ordem garante que o marcador não vira
 * 'delivered'.
 */
export async function markTurnFailed(
  supabase: AnyClient,
  agentId: string,
  userId: string,
  detail: string,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("agent_turns")
      .update({ status: "failed", detail: detail.slice(0, 500) })
      .eq("agent_id", agentId)
      .eq("user_id", userId)
      .eq("status", "pending");
    if (error) console.warn("[agent-turns] markFailed failed:", error.message);
  } catch (e) {
    console.warn("[agent-turns] markFailed threw:", e instanceof Error ? e.message : e);
  }
}

/**
 * Encerra um turno identificado pela chave natural (sessão + mensagem).
 *
 * A DM fecha sozinha: a resposta pousa em conversations e um trigger marca
 * 'delivered'. Canal grava em channel_messages, onde esse trigger não existe —
 * então quem despachou fecha explicitamente. Melhor isso do que espalhar mais
 * um trigger por tabela.
 */
export async function closeTurn(
  supabase: AnyClient,
  sessionKey: string,
  userMessageTs: string,
  status: "delivered" | "failed",
  detail?: string,
): Promise<void> {
  try {
    const campos: Record<string, unknown> = { status };
    if (status === "delivered") campos.delivered_at = new Date().toISOString();
    if (detail) campos.detail = detail.slice(0, 500);
    const { error } = await supabase
      .from("agent_turns").update(campos)
      .eq("session_key", sessionKey)
      .eq("user_message_ts", userMessageTs)
      .eq("status", "pending");
    if (error) console.warn("[agent-turns] close failed:", error.message);
  } catch (e) {
    console.warn("[agent-turns] close threw:", e instanceof Error ? e.message : e);
  }
}
