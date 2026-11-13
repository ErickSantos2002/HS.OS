/**
 * Digitar numa conversa longa não pode redesenhar as mensagens — 13/11/2026.
 *
 * Medido em produção numa DM com 200 mensagens: cada tecla custava 35–65 ms
 * de re-render síncrono do React mais uma tarefa de 56 ms do agendador. Nos
 * PCs mais lentos do escritório isso virava ~2 s de atraso entre a letra
 * digitada e a letra na tela. A causa: o `ChannelChat` guarda o estado do
 * composer, e cada tecla redesenhava o componente inteiro; a lista passava ~15
 * funções criadas na hora (e um `?? []` novo) para cada `MessageBubble`, então
 * o `memo` dela nunca segurava e TODAS as bolhas eram redesenhadas a cada letra.
 *
 * O conserto: a lista virou `ListaDeMensagensDoCanal` (memo), cada item é
 * `ItemDaMensagem` (memo), e as ações chegam num objeto estável
 * (`useAcoesEstaveis`) que recebe a mensagem como argumento. O harness abaixo
 * liga as peças do mesmo jeito que o `ChannelChat`: estado de digitação no pai,
 * listas vindas de estado (referência estável) e as ações pelo hook.
 *
 * O contador de renders é o `useAgentAvatar`, que a `MessageBubble` chama uma
 * vez por render.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).DOMMatrix ??= class {};
  return { bolhas: 0 };
});
vi.mock("@/hooks/use-agent-avatar", () => ({
  useAgentAvatar: () => {
    renders.bolhas += 1;
    return { avatar: null };
  },
}));

import { ListaDeMensagensDoCanal, type AcoesDaLista } from "@/components/chat/ChannelChat";
import { useAcoesEstaveis } from "@/hooks/use-acoes-estaveis";
import type { ChannelMessage } from "@/hooks/use-channels";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof IntersectionObserver;

function mensagem(id: string, conteudo: string, autor = "outra"): ChannelMessage {
  return {
    id, channel_id: "c1", author_id: autor, author_type: "human", author_name: "Ana",
    author_avatar: null, content: conteudo, thread_id: null, created_at: `2026-11-13T10:0${id.slice(1)}:00Z`,
    audio_url: null, edited_at: null, deleted_at: null, attachments: null,
  } as unknown as ChannelMessage;
}

const MENSAGENS = [mensagem("m1", "primeira"), mensagem("m2", "segunda"), mensagem("m3", "terceira", "eu")];
// No ChannelChat estes vêm de estado de hook: a referência só muda quando o dado muda.
const REACOES = { m1: [{ emoji: "👍", user_ids: ["outra"], count: 1 }] };
const SEM_THREADS = {};
const SEM_MARCADAS = new Set<string>();
const NOMES = new Map<string, string>();
const STATUS = new Map<string, { emoji: string; label: string; setAt: string | null } | null>();
const SEM_RECIBOS = {};

function Conversa({
  texto, mensagens, aoReagir, hoje = "2026-11-13",
}: {
  texto: string;
  mensagens: ChannelMessage[];
  aoReagir: (msgId: string, emoji: string) => void;
  hoje?: string;
}) {
  const nada = () => {};
  const acoes = useAcoesEstaveis<AcoesDaLista>({
    reagir: aoReagir,
    editar: nada,
    salvarEdicao: nada,
    cancelarEdicao: nada,
    apagar: nada,
    responder: nada,
    irParaCitada: nada,
    marcarNaoLida: () => true,
    marcarLida: nada,
    abrirImagem: nada,
    preverAnexo: nada,
    dadosDaMensagem: nada,
    apagarParaMim: nada,
  });
  return (
    <>
      <input aria-label="composer" value={texto} readOnly />
      <ListaDeMensagensDoCanal
        mensagens={mensagens}
        editandoId={null}
        meuId="eu"
        meuNome="Eu"
        resumoLigado
        podeEscrever
        reactions={REACOES}
        threadCounts={SEM_THREADS}
        threadViewedVersion={0}
        marcadasNaoLidas={SEM_MARCADAS}
        userNameById={NOMES}
        statusByUserId={STATUS}
        isPessoal={false}
        recibos={SEM_RECIBOS}
        hoje={hoje}
        acoes={acoes}
      />
    </>
  );
}

describe("digitar não redesenha as mensagens do canal", () => {
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
    expect(novo).toHaveBeenCalledWith("m1", "👍");
  });

  it("virou o dia: o separador passa de 'Hoje' para 'Ontem' sem redesenhar bolha", () => {
    // Com a lista em memo, nada redesenhava o separador à meia-noite: a
    // conversa aberta de um dia para o outro dizia "Hoje" para as de ontem.
    const aoReagir = vi.fn();
    const { rerender } = render(<Conversa texto="" mensagens={MENSAGENS} aoReagir={aoReagir} hoje="2026-11-13" />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    renders.bolhas = 0;

    rerender(<Conversa texto="" mensagens={MENSAGENS} aoReagir={aoReagir} hoje="2026-11-14" />);
    expect(screen.getByText("Ontem")).toBeInTheDocument();
    expect(screen.queryByText("Hoje")).not.toBeInTheDocument();
    expect(renders.bolhas).toBe(0);
  });
});
