/**
 * Digitar para o agente no celular não pode redesenhar as bolhas — 13/11/2026.
 *
 * Mesmo defeito do canal (ver `ListaDoCanal.digitacao.test.tsx`): o rascunho
 * mora na `TelaConversaAgente`, e cada bolha recebia `children` novos (o
 * markdown do `ArtifactMessage`, a mídia) e closures novas a cada letra. Numa
 * conversa longa com o agente — respostas grandes em markdown — cada tecla
 * redesenhava tudo, no aparelho mais lento da casa.
 *
 * O contador é a `Bolha`, embrulhada: cada render de item cria uma.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renders = vi.hoisted(() => ({ bolhas: 0 }));
vi.mock("./Bolha", async (original) => {
  const real = await original<typeof import("./Bolha")>();
  const Contada = (props: Parameters<typeof real.Bolha>[0]) => {
    renders.bolhas += 1;
    return <real.Bolha {...props} />;
  };
  return { ...real, Bolha: Contada };
});
// O markdown real não interessa aqui; só que o texto da resposta apareça.
vi.mock("@/components/chat/ArtifactMessage", () => ({
  default: ({ content }: { content: string }) => <p>{content}</p>,
}));

import { useAcoesEstaveis } from "@/hooks/use-acoes-estaveis";
import type { ChatMessage } from "@/lib/mock-data";
import { BolhaPensandoDoAgente, ListaDoAgente, type AcoesDoAgente } from "./ListaDoAgente";

const UUID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
function mensagem(n: number, role: "user" | "agent", conteudo: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: UUID(n), role, content: conteudo, agentId: "nina",
    timestamp: new Date(`2026-11-13T10:0${n}:00Z`), ...extra,
  } as unknown as ChatMessage;
}

const MENSAGENS = [
  mensagem(1, "user", "pergunta"),
  mensagem(2, "agent", "resposta"),
  mensagem(3, "agent", "[error] caiu", { isError: true }),
];

function Conversa({
  texto, mensagens, aoTentar, trabalhando = false, hoje = "2026-11-13",
}: {
  texto: string;
  mensagens: ChatMessage[];
  aoTentar: (id: string) => void;
  trabalhando?: boolean;
  hoje?: string;
}) {
  const nada = () => {};
  const acoes = useAcoesEstaveis<AcoesDoAgente>({
    segurar: nada,
    responder: nada,
    tentarNovamente: aoTentar,
    abrirArtefato: nada,
    abrirVivo: nada,
    ampliar: nada,
  });
  return (
    <>
      <input aria-label="composer" value={texto} readOnly />
      <ListaDoAgente mensagens={mensagens} isAgentWorking={trabalhando} destaqueId={null} hoje={hoje} acoes={acoes} />
      {trabalhando && <BolhaPensandoDoAgente nome="Nina" parcial="" inicio />}
    </>
  );
}

describe("digitar para o agente no celular não redesenha as bolhas", () => {
  beforeEach(() => {
    renders.bolhas = 0;
  });

  it("uma tecla no composer não redesenha nenhuma bolha (nem a de 'pensando')", () => {
    const aoTentar = vi.fn();
    const { rerender } = render(<Conversa texto="o" mensagens={MENSAGENS} aoTentar={aoTentar} trabalhando />);
    expect(renders.bolhas).toBe(4);

    renders.bolhas = 0;
    rerender(<Conversa texto="oi" mensagens={MENSAGENS} aoTentar={aoTentar} trabalhando />);
    rerender(<Conversa texto="oi " mensagens={MENSAGENS} aoTentar={aoTentar} trabalhando />);
    expect(renders.bolhas).toBe(0);
  });

  it("mensagem que muda é redesenhada, e só ela", () => {
    const aoTentar = vi.fn();
    const { rerender } = render(<Conversa texto="" mensagens={MENSAGENS} aoTentar={aoTentar} />);
    renders.bolhas = 0;

    const nova = [MENSAGENS[0], { ...MENSAGENS[1], content: "resposta revista" }, MENSAGENS[2]];
    rerender(<Conversa texto="" mensagens={nova} aoTentar={aoTentar} />);
    expect(renders.bolhas).toBe(1);
    expect(screen.getByText("resposta revista")).toBeInTheDocument();
  });

  it("a ação estável chama a versão mais nova do handler, com a mensagem certa", () => {
    // A bolha que não redesenha não pode ficar presa ao "Tentar novamente" do
    // primeiro render — reenviaria pela closure velha.
    const velho = vi.fn();
    const novo = vi.fn();
    const { rerender } = render(<Conversa texto="" mensagens={MENSAGENS} aoTentar={velho} />);
    rerender(<Conversa texto="x" mensagens={MENSAGENS} aoTentar={novo} />);

    fireEvent.click(screen.getByText("Tentar novamente"));
    expect(velho).not.toHaveBeenCalled();
    expect(novo).toHaveBeenCalledWith(UUID(3));
  });

  it("virou o dia: 'Hoje' passa a 'Ontem' e só a bolha com o separador redesenha", () => {
    // Com a lista em memo, nada redesenhava o separador à meia-noite.
    const aoTentar = vi.fn();
    const { rerender } = render(<Conversa texto="" mensagens={MENSAGENS} aoTentar={aoTentar} hoje="2026-11-13" />);
    expect(screen.getByText("Hoje")).toBeInTheDocument();
    renders.bolhas = 0;

    rerender(<Conversa texto="" mensagens={MENSAGENS} aoTentar={aoTentar} hoje="2026-11-14" />);
    expect(screen.getByText("Ontem")).toBeInTheDocument();
    expect(renders.bolhas).toBe(1);
  });
});
