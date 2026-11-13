/**
 * Digitar no celular não pode redesenhar as bolhas — 13/11/2026.
 *
 * O mesmo defeito que custava ~2 s por tecla no desktop (DM com 200
 * mensagens: 35–65 ms de render síncrono + 56 ms do agendador a cada letra)
 * existia, pior, no app do celular — que roda nos aparelhos mais lentos. O
 * rascunho mora na `TelaConversaCanal` (e na `TelaThread`), e a `Bolha` (memo)
 * recebia a cada render `children` JSX novos (markdown, avatar, mídia),
 * reações montadas com `.map` e closures novas: o memo nunca segurava e cada
 * letra redesenhava todas as bolhas da conversa.
 *
 * O conserto: a lista virou `ListaDoCanal` (memo) e cada mensagem
 * `ItemDoCanal` (memo), que monta o conteúdo da bolha a partir do dado. As
 * ações chegam num objeto estável (`useAcoesEstaveis`). O harness abaixo liga
 * as peças como a tela: rascunho no pai, listas vindas de estado (referência
 * estável) e as ações pelo hook.
 *
 * O contador é a `Bolha`, embrulhada: cada render de item cria uma.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
  return { bolhas: 0 };
});
vi.mock("./Bolha", async (original) => {
  const real = await original<typeof import("./Bolha")>();
  const Contada = (props: Parameters<typeof real.Bolha>[0]) => {
    renders.bolhas += 1;
    return <real.Bolha {...props} />;
  };
  return { ...real, Bolha: Contada };
});
vi.mock("@/hooks/use-agent-avatar", () => ({
  useResolvedAgentAvatar: () => null,
  useAgentAvatar: () => ({ avatar: null }),
}));

import { useAcoesEstaveis } from "@/hooks/use-acoes-estaveis";
import type { ChannelMessage } from "@/hooks/use-channels";
import type { Person } from "@/hooks/use-people";
import { ListaDoCanal, type AcoesDoCanal } from "./ListaDoCanal";

function mensagem(id: string, conteudo: string, autor = "outra"): ChannelMessage {
  return {
    id, channel_id: "c1", author_id: autor, author_type: "human", author_name: "Ana",
    author_avatar: null, content: conteudo, thread_id: null, created_at: `2026-11-13T10:0${id.slice(1)}:00Z`,
    audio_url: null, edited_at: null, deleted_at: null, attachments: null,
  } as unknown as ChannelMessage;
}

const MENSAGENS = [mensagem("m1", "primeira"), mensagem("m2", "segunda"), mensagem("m3", "terceira", "eu")];
// Na tela estes vêm de estado de hook: a referência só muda quando o dado muda.
const REACOES = { m1: [{ emoji: "👍", user_ids: ["outra"], count: 1 }] };
const SEM_THREADS = {};
const SEM_RECIBOS = {};
const PESSOAS = new Map<string, Person>();
const NINGUEM_PENSANDO: string[] = [];

function Conversa({
  texto, mensagens, aoReagir,
}: {
  texto: string;
  mensagens: ChannelMessage[];
  aoReagir: (m: ChannelMessage, emoji: string) => void;
}) {
  const nada = () => {};
  const acoes = useAcoesEstaveis<AcoesDoCanal>({
    reagir: aoReagir,
    segurar: nada,
    responder: nada,
    abrirThread: nada,
    ampliar: nada,
  });
  return (
    <>
      <input aria-label="composer" value={texto} readOnly />
      <ListaDoCanal
        modo="canal"
        mensagens={mensagens}
        meuId="eu"
        isDm={false}
        isPessoal={false}
        recibos={SEM_RECIBOS}
        reactions={REACOES}
        threadCounts={SEM_THREADS}
        pessoaPorId={PESSOAS}
        resumoLigado
        podeEscrever
        destaqueId={null}
        agentesPensando={NINGUEM_PENSANDO}
        acoes={acoes}
      />
    </>
  );
}

describe("digitar no celular não redesenha as bolhas do canal", () => {
  beforeEach(() => {
    renders.bolhas = 0;
  });

  it("uma tecla no composer não redesenha nenhuma bolha", () => {
    const aoReagir = vi.fn();
    const { rerender } = render(<Conversa texto="o" mensagens={MENSAGENS} aoReagir={aoReagir} />);
    expect(renders.bolhas).toBe(3);

    renders.bolhas = 0;
    rerender(<Conversa texto="oi" mensagens={MENSAGENS} aoReagir={aoReagir} />);
    rerender(<Conversa texto="oi " mensagens={MENSAGENS} aoReagir={aoReagir} />);
    expect(renders.bolhas).toBe(0);
  });

  it("mensagem que muda é redesenhada, e só ela", () => {
    const aoReagir = vi.fn();
    const { rerender } = render(<Conversa texto="" mensagens={MENSAGENS} aoReagir={aoReagir} />);
    renders.bolhas = 0;

    const editada = [MENSAGENS[0], { ...MENSAGENS[1], content: "segunda, editada" }, MENSAGENS[2]];
    rerender(<Conversa texto="" mensagens={editada} aoReagir={aoReagir} />);
    expect(renders.bolhas).toBe(1);
    expect(screen.getByText("segunda, editada")).toBeInTheDocument();
  });

  it("a ação estável chama a versão mais nova do handler, com a mensagem certa", () => {
    // Sem isso, estabilizar trocaria o defeito por outro pior: a bolha que não
    // redesenha ficaria presa ao handler do primeiro render (closure velha).
    const velho = vi.fn();
    const novo = vi.fn();
    const { rerender } = render(<Conversa texto="" mensagens={MENSAGENS} aoReagir={velho} />);
    rerender(<Conversa texto="x" mensagens={MENSAGENS} aoReagir={novo} />);

    fireEvent.click(screen.getByText("👍"));
    expect(velho).not.toHaveBeenCalled();
    expect(novo).toHaveBeenCalledWith(MENSAGENS[0], "👍");
  });
});
