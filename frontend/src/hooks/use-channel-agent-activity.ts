import { api } from "@/lib/api";
import { assinar } from "@/lib/realtime";
import { useEffect, useState } from "react";

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
      const data = await api<{ agent_id: string; passo: string | null }[]>(
        `/channels/${channelId}/agentes-trabalhando`,
      ).catch(() => null);
      if (!vivo) return;
      setTrabalhando(Object.fromEntries((data ?? []).map((r) => [r.agent_id, r.passo ?? null])));
    };
    puxar();

    // Recarrega a lista inteira a cada evento em vez de aplicar o delta: são
    // poucas linhas por canal, e reconciliar delta de INSERT/UPDATE/DELETE à
    // mão é onde esse tipo de código costuma divergir da verdade.
    const cancelar =
      // Vai pelo tópico do canal, não pelo da tabela: o backend roteia por
      // `channel_id`, e assinar o canal já exigiu provar que se é membro.
      assinar(`canal:${channelId}`, (_tipo, dados) => {
        if ((dados as { tabela?: string })?.tabela === "channel_agent_activity") puxar();
      });

    return () => { vivo = false; cancelar(); };
  }, [channelId]);

  return trabalhando;
}
