/**
 * Atende o pedido que chegou pela URL (ver `pedido-da-url.ts`): limpa a URL,
 * põe o `prefill` no rascunho e — só se o id da resposta rápida for conferido
 * no Cache Storage (`consumirResposta`) — envia o texto guardado pelo SW.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { abrirCacheDeRespostas, consumirResposta } from "@/lib/resposta-rapida";
import { jaAtendido, pedidoDaUrl, semPedido } from "./pedido-da-url";

export function usePedidoDaUrl(
  onde: string,
  /** O que precisa estar carregado para enviar (canal, usuário). */
  pronto: boolean,
  /** Outra tela é quem atende (o canal, quando a URL aponta uma thread). */
  ignorar: boolean,
  /** Canal e thread desta tela: o registro guardado tem que ser deles. */
  alvo: { canal: string; thread: string | null },
  acoes: { rascunho: (texto: string) => void; enviar: (texto: string) => void; focar: () => void },
) {
  const location = useLocation();
  const navigate = useNavigate();
  const acoesRef = useRef(acoes);
  acoesRef.current = acoes;
  useEffect(() => {
    if (!pronto || ignorar) return;
    const pedido = pedidoDaUrl(location.search);
    if (!pedido) return;
    navigate(`${location.pathname}${semPedido(location.search)}`, { replace: true });
    if (jaAtendido(onde, pedido)) return;
    if (pedido.rascunho) acoesRef.current.rascunho(pedido.rascunho);
    if (pedido.focar) acoesRef.current.focar();
    if (pedido.respostaId) {
      const id = pedido.respostaId;
      void (async () => {
        const cache = await abrirCacheDeRespostas();
        const texto = cache ? await consumirResposta(cache, id, alvo) : null;
        if (texto) acoesRef.current.enviar(texto);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, ignorar, location.pathname, location.search, navigate, onde, alvo.canal, alvo.thread]);
}
