/**
 * O contador das abas da lista de conversas (DMs/Pessoas · Agentes · Canais).
 *
 * A regra é a do desktop desde sempre e o celular passou a usá-la em
 * 13/11/2026: soma das não lidas dos itens da aba, **silenciados inclusive**
 * (silenciar corta push, som e notificação, não a não lida — ver
 * `channel_members.silenciado`), e "99+" acima de 99. Em lugar só, para as
 * duas telas não contarem diferente.
 */
export function somarNaoLidas(itens: ReadonlyArray<{ naoLidas: number }>): number {
  return itens.reduce((acc, i) => acc + (i.naoLidas > 0 ? i.naoLidas : 0), 0);
}

/** O texto da bolinha; `null` quando não há o que mostrar. */
export function rotuloDoContador(n: number): string | null {
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}
