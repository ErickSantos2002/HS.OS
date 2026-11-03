/**
 * Ações da folha de toque longo — spec 2026-11-03, Frente C3.
 *
 * ⚠️ A fonte das ações é o array que a bolha já monta para o `MenuDaMensagem`
 * do desktop. Aqui não nasce ação nova, com uma exceção: "Copiar", porque no
 * celular a seleção nativa de texto é desligada durante o gesto e o "Copiar"
 * é o que cobre essa necessidade. Quem já o tem (agente, canal) recebe o
 * próprio array de volta, intacto.
 */
import { Copy } from "lucide-react";

import type { AcaoDaMensagem } from "@/components/chat/MenuDaMensagem";

export const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "🙏"] as const;

export function acoesDoToque(
  acoes: AcaoDaMensagem[],
  copia?: { texto: string; copiar: () => void },
): AcaoDaMensagem[] {
  if (!copia || !copia.texto.trim()) return acoes;
  if (acoes.some((a) => a.rotulo === "Copiar")) return acoes;
  return [{ rotulo: "Copiar", icone: Copy, aoEscolher: copia.copiar }, ...acoes];
}

/** Mensagem otimista ou apagada não tem ação nem reação: o toque não abre nada. */
export function temOQueAbrir(acoes: AcaoDaMensagem[], podeReagir: boolean): boolean {
  return podeReagir || acoes.length > 0;
}
