/**
 * Liga o `criarDetectorDeToqueLongo` aos eventos de toque de um elemento.
 *
 * Com `ativo = false` (desktop) devolve handlers vazios: o desktop segue com a
 * seta do `MenuDaMensagem` e nada aqui roda. `pressionando` existe para a
 * bolha desligar a seleção nativa de texto durante o gesto — senão o iOS abre
 * a lupa e o menu de copiar por cima da nossa folha.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export function useToqueLongo(aoDisparar: () => void, ativo: boolean) {
  const [pressionando, setPressionando] = useState(false);
  const aoDispararRef = useRef(aoDisparar);
  const ultimoToqueRef = useRef<number | null>(null);
  aoDispararRef.current = aoDisparar;

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

  // Rolagem cancela. Escuta em captura porque quem rola é a lista, não o window.
  useEffect(() => {
    if (!pressionando) return;
    const aoRolar = () => detector.rolou();
    document.addEventListener("scroll", aoRolar, true);
    return () => document.removeEventListener("scroll", aoRolar, true);
  }, [pressionando, detector]);

  useEffect(() => () => detector.fim(), [detector]);

  const encerrar = useCallback(() => {
    detector.fim();
    setPressionando(false);
  }, [detector]);

  const handlers = useMemo<HandlersDoToqueLongo>(() => {
    if (!ativo) return {};
    return {
      onTouchStart: (e) => {
        if (!doProprioElemento(e) || e.touches.length !== 1) return;
        ultimoToqueRef.current = Date.now();
        const t = e.touches[0];
        detector.inicio(t.clientX, t.clientY);
        setPressionando(true);
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
      // Menu nativo do Android ao segurar (copiar link, salvar imagem).
      // Do dedo (Android), só bloqueia o menu nativo — o detector já abriu.
      // Do mouse (janela estreita), abre a folha: a seta de hover não existe
      // no modo toque e o botão direito é o caminho para as ações.
      onContextMenu: (e) => {
        if (!doProprioElemento(e)) return;
        e.preventDefault();
        const pointerType = (e.nativeEvent as PointerEvent | MouseEvent & { pointerType?: string }).pointerType;
        if (menuVeioDoMouse({ pointerType, agora: Date.now(), ultimoToque: ultimoToqueRef.current })) {
          aoDispararRef.current();
        }
      },
    };
  }, [ativo, detector, encerrar]);

  return { handlers, pressionando: ativo && pressionando };
}
