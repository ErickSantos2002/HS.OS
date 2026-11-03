/**
 * O `ChatPage` avisa o `AppLayout` de que há conversa selecionada de fato —
 * é isso, e não a URL, que esconde o cabeçalho e a BottomNav no celular
 * (ver `conversaEmTelaCheia`).
 */
import { createContext, useContext, useEffect } from "react";

export const ConversaAbertaContext = createContext<(aberta: boolean) => void>(() => {});

export function useInformarConversaAberta(aberta: boolean) {
  const informar = useContext(ConversaAbertaContext);
  useEffect(() => {
    informar(aberta);
  }, [aberta, informar]);
  // Saiu do chat: o cabeçalho volta.
  useEffect(() => () => informar(false), [informar]);
}
