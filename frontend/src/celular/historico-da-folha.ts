/**
 * A entrada de histórico de uma folha (ou do ⋮) — o que faz o voltar do
 * Android fechá-la em vez de desempilhar a conversa.
 *
 * Abrir põe uma entrada com a MESMA URL; o voltar a consome. Fechar pelo
 * toque devolve a entrada com `history.back()`.
 *
 * ⚠️ **Folha aberta de dentro de outra** ("Nova conversa", "Apagar", "Mais
 * emojis"): o `back()` da primeira é assíncrono, a segunda empilhava a dela
 * por cima, e o `popstate` atrasado chegava para a segunda — que fechava
 * sozinha, deixando uma entrada órfã e um voltar que não fazia nada. Por isso
 * o `back()` é adiado um tique: se outra folha abre nesse meio-tempo, ela
 * ASSUME a entrada (`replaceState`) e o `back()` não acontece. Um nível só.
 */

export interface HistoricoMinimo {
  readonly state: unknown;
  pushState(estado: unknown, titulo: string): void;
  replaceState(estado: unknown, titulo: string): void;
  back(): void;
}

type Agendar = (fn: () => void) => unknown;
type Cancelar = (id: unknown) => void;

function marcaDe(estado: unknown): number | undefined {
  return (estado as { celFolha?: number } | null)?.celFolha;
}

export function criarControleDeFolhas(
  historico: HistoricoMinimo,
  agendar: Agendar = (fn) => setTimeout(fn, 0),
  cancelar: Cancelar = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
) {
  let pendente: { marca: number; id: unknown } | null = null;

  return {
    /** A folha abriu: empilha a entrada dela, ou assume a da folha que acabou de fechar. */
    abrir(marca: number) {
      const atual = historico.state;
      if (pendente && marcaDe(atual) === pendente.marca) {
        cancelar(pendente.id);
        pendente = null;
        historico.replaceState({ ...(atual as object), celFolha: marca }, "");
        return;
      }
      historico.pushState({ ...((atual as object | null) ?? {}), celFolha: marca }, "");
    },
    /** A folha fechou. Pelo voltar, a entrada já foi; pelo toque, devolve — depois de um tique. */
    fechar(marca: number, peloVoltar: boolean) {
      if (peloVoltar || marcaDe(historico.state) !== marca) return;
      const id = agendar(() => {
        if (pendente?.marca !== marca) return;
        pendente = null;
        // Se a ação escolhida navegou, a entrada já não é a do topo: voltar
        // ali desfaria a navegação.
        if (marcaDe(historico.state) === marca) historico.back();
      });
      pendente = { marca, id };
    },
  };
}

let controle: ReturnType<typeof criarControleDeFolhas> | null = null;

/** O controle da janela — um só, porque o histórico é um só. */
export function controleDeFolhas() {
  controle ??= criarControleDeFolhas(window.history);
  return controle;
}
