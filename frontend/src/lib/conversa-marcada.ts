/**
 * Marcar conversa como não lida pela lista — regra pura (18/11/2026).
 *
 * Spec: docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md.
 *
 * A marca é a pessoa dizendo "voltarei aqui", não algo novo. Por isso:
 * - o indicador é uma **bolinha sem número**;
 * - se a conversa também tem não lida de verdade, **vale o número**;
 * - a marca **não soma** em contador nenhum (aba, sininho, ícone do app).
 *
 * Usada pelas duas listas (desktop e celular), para não divergirem.
 */
import { rotuloDoContador, somarNaoLidas } from "./contador-de-nao-lidas";

export type Indicador = { tipo: "numero"; texto: string } | { tipo: "marca" } | null;

/** O alvo da marca: um canal (DM, grupo, canal, a pessoal) ou um agente. */
export interface AlvoDaMarca {
  canalId: string | null;
  agentId: string | null;
}

export function indicadorDaConversa(naoLidas: number, marcada: boolean): Indicador {
  const texto = rotuloDoContador(naoLidas);
  if (texto) return { tipo: "numero", texto };
  return marcada ? { tipo: "marca" } : null;
}

export function indicadorDaAba(itens: ReadonlyArray<{ naoLidas: number; marcada?: boolean }>): Indicador {
  const texto = rotuloDoContador(somarNaoLidas(itens));
  if (texto) return { tipo: "numero", texto };
  return itens.some((i) => i.marcada) ? { tipo: "marca" } : null;
}

/** DM com pessoa que nunca conversou não tem canal ainda: não há o que marcar. */
export function podeMarcar(alvo: AlvoDaMarca): boolean {
  return Boolean(alvo.canalId || alvo.agentId);
}

export function chaveDaMarca(alvo: AlvoDaMarca): string {
  return alvo.canalId ? `canal:${alvo.canalId}` : `agente:${alvo.agentId}`;
}
