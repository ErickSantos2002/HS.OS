/**
 * Cartão em par — Recusar | Aprovar (aviso de ausência, 26/11/2026).
 *
 * O RH recebia dois cartões, cada um com Cancelar/Confirmar: quatro botões
 * para uma decisão, e "Cancelar" lido como "recusar". Agora é um cartão com as
 * duas opções; o que se tranca aqui é o que ele mostra em cada estado — botões
 * só enquanto AS DUAS estão pendentes, e depois qual foi a escolhida.
 */
import { describe, expect, it } from "vitest";
import { estadoDoPar, type Acao } from "@/lib/acoes";

const acao = (id: string, status: string, resultado?: string): Acao => ({
  id, status, sistema: "talenths", acao: "talenths_aprovar_ausencia", resumo: "", payload: {}, resultado,
});

describe("estadoDoPar", () => {
  it("as duas pendentes: mostra os botões, nada escolhido", () => {
    expect(estadoDoPar(acao("a", "pendente"), acao("b", "pendente")))
      .toEqual({ pendente: true, escolhida: null, status: "pendente" });
  });

  it("a outra foi feita: a escolhida é ela, sem botões", () => {
    expect(estadoDoPar(acao("a", "cancelada"), acao("b", "feita", "Recusado.")))
      .toEqual({ pendente: false, escolhida: "outra", status: "feita" });
  });

  it("a principal deu erro: sem botões, mostra o erro dela", () => {
    // O servidor não cancela a outra quando o executor falha, mas o cartão não
    // pode oferecer de novo um clique que já executou pela metade.
    expect(estadoDoPar(acao("a", "erro"), acao("b", "pendente")))
      .toEqual({ pendente: false, escolhida: "principal", status: "erro" });
  });

  it("vencidas: sem botões, nenhuma escolhida", () => {
    expect(estadoDoPar(acao("a", "vencida"), acao("b", "vencida")))
      .toEqual({ pendente: false, escolhida: null, status: "vencida" });
  });

  it("a outra ainda carregando: não mostra botões antes de saber", () => {
    expect(estadoDoPar(acao("a", "pendente"), null))
      .toEqual({ pendente: false, escolhida: null, status: "pendente" });
  });
});
