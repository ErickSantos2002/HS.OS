/**
 * Objeto de ações com identidade estável que sempre chama a versão mais nova.
 *
 * Existe para o `memo` das listas de mensagem segurar (13/11/2026): passar
 * `() => fazer(msg.id)` criado a cada render fazia toda bolha redesenhar a cada
 * tecla no composer. Com isto, o pai entrega UM objeto que nunca muda, e cada
 * função recebe a mensagem (ou o id) como argumento.
 *
 * ⚠️ As chaves são lidas só no primeiro render — não acrescente nem tire ação
 * condicionalmente; para "ação ausente", decida na hora da chamada ou passe um
 * booleano à parte.
 */
import { useLayoutEffect, useMemo, useRef } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Funcoes<T> = { [K in keyof T]: (...args: any[]) => any };

export function useAcoesEstaveis<T extends Funcoes<T>>(atuais: T): T {
  const ref = useRef(atuais);
  // Atualiza depois do commit: as ações só são chamadas por evento ou efeito,
  // nunca durante o render.
  useLayoutEffect(() => {
    ref.current = atuais;
  });
  return useMemo(() => {
    const estaveis = {} as Record<string, (...args: unknown[]) => unknown>;
    for (const chave of Object.keys(ref.current)) {
      estaveis[chave] = (...args: unknown[]) =>
        (ref.current as Record<string, (...a: unknown[]) => unknown>)[chave](...args);
    }
    return estaveis as T;
  }, []);
}
