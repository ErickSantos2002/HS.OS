/**
 * Atende a resposta rápida do push que chegou pela URL (ver
 * `pedido-da-url.ts`): limpa a URL e chama `atender` uma vez só.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { jaAtendido, pedidoDaUrl, semPedido, type PedidoDeResposta } from "./pedido-da-url";

export function usePedidoDaUrl(
  onde: string,
  /** O que precisa estar carregado para enviar (canal, usuário). */
  pronto: boolean,
  /** Outra tela é quem atende (o canal, quando a URL aponta uma thread). */
  ignorar: boolean,
  atender: (pedido: PedidoDeResposta) => void,
) {
  const location = useLocation();
  const navigate = useNavigate();
  const atenderRef = useRef(atender);
  atenderRef.current = atender;
  useEffect(() => {
    if (!pronto || ignorar) return;
    const pedido = pedidoDaUrl(location.search);
    if (!pedido) return;
    navigate(`${location.pathname}${semPedido(location.search)}`, { replace: true });
    if (jaAtendido(onde, pedido)) return;
    atenderRef.current(pedido);
  }, [pronto, ignorar, location.pathname, location.search, navigate, onde]);
}
