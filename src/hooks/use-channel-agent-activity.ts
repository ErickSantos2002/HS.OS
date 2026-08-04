import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Quais agentes estão trabalhando neste canal, segundo o SERVIDOR.
 *
 * O sinal antigo (`channel-agent-pending`) vive no navegador de quem fez a
 * menção — então só essa pessoa via o "digitando...", e o indicador sumia ao
 * recarregar. Num canal, onde várias pessoas acompanham o mesmo trabalho, é
 * exatamente o sinal que não pode ser privado.
 *
 * Este lê `channel_agent_activity`, escrito pelo channel-agent-reply ao
 * despachar e ao concluir. Todo mundo vê o mesmo, com o mesmo relógio, e
 * sobrevive a reload.
 *
 * Os dois convivem de propósito: o local responde no mesmo instante do clique,
 * o do servidor chega logo depois e é a verdade. A união dos dois evita tanto
 * o atraso quanto a mentira.
 */
export function useChannelAgentActivity(channelId: string | null | undefined) {
  const [trabalhando, setTrabalhando] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (!channelId) { setTrabalhando({}); return; }
    let vivo = true;

    const puxar = async () => {
      const { data } = await supabase
        .from("channel_agent_activity")
        .select("agent_id, passo, finished_at")
        .eq("channel_id", channelId)
        .is("finished_at", null);
      if (!vivo) return;
      setTrabalhando(Object.fromEntries((data ?? []).map((r) => [r.agent_id, r.passo ?? null])));
    };
    puxar();

    // Recarrega a lista inteira a cada evento em vez de aplicar o delta: são
    // poucas linhas por canal, e reconciliar delta de INSERT/UPDATE/DELETE à
    // mão é onde esse tipo de código costuma divergir da verdade.
    const canal = supabase
      .channel(`atividade-agente-${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "channel_agent_activity", filter: `channel_id=eq.${channelId}` },
        puxar,
      )
      .subscribe();

    return () => { vivo = false; supabase.removeChannel(canal); };
  }, [channelId]);

  return trabalhando;
}
