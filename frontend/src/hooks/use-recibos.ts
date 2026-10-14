import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { assinar } from "@/lib/realtime";

/**
 * Visto por mensagem num canal — DM ou grupo (spec 2026-10-14). Substitui o
 * `use-dm-reads`, que guardava um horário só por pessoa e canal.
 *
 * - `recibos`: `{message_id: estado}` das MINHAS mensagens, do servidor.
 * - `marcarLido()`: eu li o canal agora. No máximo uma chamada a cada 2s.
 *
 * Recarrega quando chega mensagem (`gatilho`) e quando o servidor avisa que um
 * recibo do canal mudou — o evento diz só "mudou", quem diz o quê é a rota.
 */
export function useRecibos(channelId: string | null, gatilho: number) {
  const [recibos, setRecibos] = useState<Record<string, string>>({});
  const ultimoLido = useRef(0);

  const carregar = useCallback(async () => {
    if (!channelId) return;
    try {
      setRecibos(await api<Record<string, string>>(`/channels/${channelId}/recibos`));
    } catch {
      /* visto é acessório: sem ele a bolha mostra ✓ */
    }
  }, [channelId]);

  useEffect(() => {
    setRecibos({});
    if (!channelId) return;
    void carregar();
    return assinar(`canal:${channelId}`, (_tipo, dados) => {
      if ((dados as { tabela?: string })?.tabela === "recibos_mensagem") void carregar();
    });
  }, [channelId, carregar]);

  useEffect(() => {
    if (gatilho > 0) void carregar();
  }, [gatilho, carregar]);

  const marcarLido = useCallback(() => {
    if (!channelId) return;
    const agora = Date.now();
    if (agora - ultimoLido.current < 2000) return;
    ultimoLido.current = agora;
    // O horário é do servidor: relógio de navegador errado mostraria "lida" na
    // hora errada para quem mandou.
    void api(`/channels/${channelId}/lido`, { method: "POST" }).catch(() => {
      /* visto é acessório */
    });
  }, [channelId]);

  return { recibos, marcarLido };
}
