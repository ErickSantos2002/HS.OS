import { useEffect } from "react";

/**
 * Pede ao service worker que procure versão nova, a cada 2 minutos.
 *
 * ⚠️ **Este hook não avisa nem recarrega — quem avisa é o `onNeedRefresh` do
 * `main.tsx`.** Até 03/11/2026 ele comparava o `/index.html` do servidor com o
 * carregado, mostrava um SEGUNDO toast "Nova versão disponível" e, no clique,
 * apagava os caches e recarregava por conta própria. Eram dois avisos
 * sobrepostos para o mesmo deploy, e o reload dele passava por cima do SW
 * ("prompt", que espera o clique — ver o comentário no `vite.config.ts`):
 * a página recarregava com o SW velho ainda no controle.
 *
 * O `main.tsx` já confere a cada 30 min, ao voltar para a aba e ao voltar a
 * rede; o intervalo curto daqui só encurta o tempo até o aviso aparecer com o
 * app aberto e parado.
 */

const POLL_MS = 2 * 60 * 1000;

function isPreviewOrDev(): boolean {
  if (!import.meta.env.PROD) return true;
  if (typeof window === "undefined") return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  return false;
}

async function procurarAtualizacao() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
  } catch {
    /* sem rede ou sem SW: tenta de novo no próximo ciclo */
  }
}

export function useVersionCheck() {
  useEffect(() => {
    if (isPreviewOrDev() || !("serviceWorker" in navigator)) return;
    const intervalo = window.setInterval(() => void procurarAtualizacao(), POLL_MS);
    return () => window.clearInterval(intervalo);
  }, []);
}
