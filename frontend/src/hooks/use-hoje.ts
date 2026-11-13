/**
 * O dia de hoje (`AAAA-MM-DD`, fuso do aparelho) que muda à meia-noite.
 *
 * Existe porque as listas de mensagem viraram `memo` (13/11/2026): o rótulo
 * "Hoje"/"Ontem" era recalculado a cada render, e render havia a cada tecla.
 * Sem tecla, a lista aberta de um dia para o outro ficava dizendo "Hoje" para
 * as mensagens de ontem. As listas recebem este valor como prop e o rótulo
 * passa a ser calculado contra ele (`agoraDoDia`).
 *
 * Confere de novo ao voltar para a aba: timer de aba em segundo plano (e de
 * celular dormindo) atrasa ou nem dispara.
 */
import { useEffect, useState } from "react";

export function diaDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Um instante dentro do dia `hoje` (meio-dia local), para os rótulos de data. */
export function agoraDoDia(hoje: string): Date {
  const [a, m, d] = hoje.split("-").map(Number);
  return new Date(a, m - 1, d, 12);
}

export function useHoje(): string {
  const [hoje, setHoje] = useState(() => diaDe(new Date()));
  useEffect(() => {
    const conferir = () => setHoje(diaDe(new Date()));
    const agora = new Date();
    const meiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(conferir, meiaNoite.getTime() - agora.getTime());
    const aoVoltar = () => { if (document.visibilityState === "visible") conferir(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [hoje]);
  return hoje;
}
