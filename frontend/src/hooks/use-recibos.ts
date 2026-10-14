import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { assinar } from "@/lib/realtime";

/**
 * Visto por mensagem num canal — DM ou grupo (spec 2026-10-14). Substitui o
 * `use-dm-reads`, que guardava um horário só por pessoa e canal.
 *
 * - `recibos`: `{message_id: estado}` das MINHAS mensagens, do servidor.
 * - `marcarLido(threadId?)`: eu li o canal (ou a thread) agora. No máximo uma
 *   chamada a cada 2s por alvo — a que cai dentro da janela é adiada.
 *
 * Recarrega quando chega mensagem (`gatilho`) e quando o servidor avisa que um
 * recibo do canal mudou — o evento diz só "mudou", quem diz o quê é a rota.
 */
export function useRecibos(channelId: string | null, gatilho: number) {
  const [recibos, setRecibos] = useState<Record<string, string>>({});

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

  // ⚠️ Limite com disparo no FIM da janela, não descarte. Descartando, duas
  // mensagens em menos de 2s deixavam a segunda sem leitura — e quem mandou
  // no cinza até a próxima mensagem (revisão final, 14/10/2026). Uma janela
  // por alvo (o canal, ou uma thread), zeradas na troca de canal: o
  // `ChannelChat` não remonta ao trocar, e o limite do anterior vazava.
  const janelas = useRef(new Map<string, { ultimo: number; timer?: number }>());

  useEffect(() => {
    const mapa = janelas.current;
    return () => {
      mapa.forEach((j) => window.clearTimeout(j.timer));
      mapa.clear();
    };
  }, [channelId]);

  const marcarLido = useCallback((threadId?: string) => {
    if (!channelId) return;
    const caminho = threadId
      ? `/channels/${channelId}/lido?thread_id=${encodeURIComponent(threadId)}`
      : `/channels/${channelId}/lido`;
    const enviar = () => {
      janelas.current.set(caminho, { ultimo: Date.now() });
      // O horário é do servidor: relógio de navegador errado mostraria "lida"
      // na hora errada para quem mandou.
      void api(caminho, { method: "POST" }).catch(() => {
        /* visto é acessório */
      });
    };
    const j = janelas.current.get(caminho);
    if (!j) return enviar();
    if (j.timer !== undefined) return;
    const falta = 2000 - (Date.now() - j.ultimo);
    if (falta <= 0) return enviar();
    j.timer = window.setTimeout(enviar, falta);
  }, [channelId]);

  return { recibos, marcarLido };
}
