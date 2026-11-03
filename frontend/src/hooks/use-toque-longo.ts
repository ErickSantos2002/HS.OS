/**
 * Liga o `criarDetectorDeToqueLongo` aos eventos de toque de um elemento.
 *
 * Com `ativo = false` (desktop) devolve handlers vazios: o desktop segue com a
 * seta do `MenuDaMensagem` e nada aqui roda.
 *
 * ⚠️ **Nada aqui é estado React.** Durante o gesto o elemento ganha
 * `data-pressionando="true"` direto no DOM (é o que o CSS usa para desligar a
 * seleção nativa — senão o iOS abre a lupa e o menu de copiar por cima da
 * folha). Com estado, cada `touchstart` re-renderizava quem usa o hook: no
 * `AgentMessageList`, a lista inteira, a cada vez que o dedo encostava numa
 * bolha para rolar (revisão de 03/11/2026).
 */
import { useEffect, useMemo, useRef } from "react";
import type React from "react";

import { criarDetectorDeToqueLongo, menuVeioDoMouse } from "@/lib/toque-longo";

export interface HandlersDoToqueLongo {
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onTouchCancel?: (e: React.TouchEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * ⚠️ O React propaga eventos pela árvore de COMPONENTES, não pela do DOM: a
 * folha de ações é um portal filho da bolha, e segurar um item dela disparava
 * o detector da própria bolha (a ação não acontecia), assim como tocar nela
 * ligava e desligava o horário. Só vale evento que nasceu dentro do elemento.
 */
export function doProprioElemento(e: { currentTarget: EventTarget | null; target: EventTarget | null }): boolean {
  const alvo = e.target as Node | null;
  const dono = e.currentTarget as Node | null;
  return !!alvo && !!dono && typeof dono.contains === "function" && dono.contains(alvo);
}

const ATRIBUTO = "data-pressionando";

export function useToqueLongo(aoDisparar: () => void, ativo: boolean): { handlers: HandlersDoToqueLongo } {
  const aoDispararRef = useRef(aoDisparar);
  aoDispararRef.current = aoDisparar;
  const ultimoToqueRef = useRef<number | null>(null);
  const elementoRef = useRef<HTMLElement | null>(null);
  const aoRolarRef = useRef<() => void>(() => {});

  const detector = useMemo(
    () =>
      criarDetectorDeToqueLongo({
        aoDisparar: () => {
          try {
            navigator.vibrate?.(10);
          } catch {
            /* vibrar é enfeite; o iOS nem tem */
          }
          aoDispararRef.current();
        },
      }),
    [],
  );

  const handlers = useMemo<HandlersDoToqueLongo>(() => {
    if (!ativo) return {};

    // Rolagem cancela. Escuta em captura porque quem rola é a lista, não o window.
    const aoRolar = () => detector.rolou();
    aoRolarRef.current = aoRolar;

    const encerrar = () => {
      detector.fim();
      document.removeEventListener("scroll", aoRolar, true);
      elementoRef.current?.removeAttribute(ATRIBUTO);
      elementoRef.current = null;
    };

    return {
      onTouchStart: (e) => {
        if (!doProprioElemento(e) || e.touches.length !== 1) return;
        ultimoToqueRef.current = Date.now();
        const t = e.touches[0];
        detector.inicio(t.clientX, t.clientY);
        elementoRef.current?.removeAttribute(ATRIBUTO);
        elementoRef.current = e.currentTarget as HTMLElement;
        elementoRef.current.setAttribute(ATRIBUTO, "true");
        document.addEventListener("scroll", aoRolar, true);
      },
      onTouchMove: (e) => {
        if (!doProprioElemento(e)) return;
        const t = e.touches[0];
        if (t) detector.mover(t.clientX, t.clientY);
      },
      onTouchEnd: (e) => {
        if (!doProprioElemento(e)) return;
        // Disparou: o soltar não pode virar clique no link ou na imagem.
        if (detector.disparou() && e.cancelable) e.preventDefault();
        encerrar();
      },
      onTouchCancel: () => encerrar(),
      // Do dedo (Android), só bloqueia o menu nativo — o detector já abriu.
      // Do mouse (janela estreita), abre a folha: a seta de hover não existe
      // no modo toque e o botão direito é o caminho para as ações.
      onContextMenu: (e) => {
        if (!doProprioElemento(e)) return;
        e.preventDefault();
        const pointerType = (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType;
        if (menuVeioDoMouse({ pointerType, agora: Date.now(), ultimoToque: ultimoToqueRef.current })) {
          aoDispararRef.current();
        }
      },
    };
  }, [ativo, detector]);

  useEffect(
    () => () => {
      detector.fim();
      document.removeEventListener("scroll", aoRolarRef.current, true);
      elementoRef.current?.removeAttribute(ATRIBUTO);
    },
    [detector],
  );

  return { handlers };
}
