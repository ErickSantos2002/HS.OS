import { useCallback, useEffect, useState } from "react";
import {
  assinarInstalacao,
  ehIos,
  estaInstalado,
  pedirInstalacao,
  temPromptDeInstalacao,
  type ResultadoInstalacao,
} from "@/lib/instalacao-app";

export type EstadoInstalacao = {
  /** Aberto como app (standalone): nenhum convite deve aparecer. */
  instalado: boolean;
  /** iPhone/iPad — instala pelo Compartilhar, e só instalado recebe push. */
  ios: boolean;
  /** O navegador entregou o `beforeinstallprompt`: dá para mostrar o botão. */
  podeInstalar: boolean;
  /** Chamar direto no clique. */
  instalar: () => Promise<ResultadoInstalacao>;
};

/**
 * Estado de instalação do app para a tela. A detecção é de
 * `@/lib/instalacao-app` (pura); aqui só se acompanha o prompt do navegador
 * e a troca para standalone, que acontece quando a pessoa instala pelo botão.
 */
export function useInstalacaoApp(): EstadoInstalacao {
  const [, setVersao] = useState(0);

  useEffect(() => {
    const atualizar = () => setVersao((v) => v + 1);
    const sair = assinarInstalacao(atualizar);
    const mq = window.matchMedia?.("(display-mode: standalone)");
    mq?.addEventListener?.("change", atualizar);
    return () => {
      sair();
      mq?.removeEventListener?.("change", atualizar);
    };
  }, []);

  const instalar = useCallback(() => pedirInstalacao(), []);

  const instalado = estaInstalado();
  return {
    instalado,
    ios: ehIos(),
    podeInstalar: !instalado && temPromptDeInstalacao(),
    instalar,
  };
}
