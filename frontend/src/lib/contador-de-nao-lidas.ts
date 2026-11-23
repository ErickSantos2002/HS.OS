/**
 * O contador das abas da lista de conversas (DMs/Pessoas · Agentes · Canais).
 *
 * Soma das não lidas dos itens da aba, **sem as silenciadas**, e "99+" acima
 * de 99. Em lugar só, para o desktop e o celular não contarem diferente.
 *
 * ⚠️ Até 23/11/2026 a silenciada somava aqui, enquanto a aba "Conversas" do
 * celular já a deixava de fora — o mesmo app dizia dois números. Silenciar é
 * não querer ser cobrado pela conversa (decisão do Erick). A conversa mantém o
 * próprio número na lista; só a soma da aba a ignora.
 */
export function somarNaoLidas(itens: ReadonlyArray<{ naoLidas: number; silenciado?: boolean }>): number {
  return itens.reduce((acc, i) => acc + (i.naoLidas > 0 && !i.silenciado ? i.naoLidas : 0), 0);
}

/** O texto da bolinha; `null` quando não há o que mostrar. */
export function rotuloDoContador(n: number): string | null {
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}
