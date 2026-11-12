/**
 * Cartão de ação do bot no TaskHS: o dono confirma o que o PAYLOAD diz, não
 * um texto livre — os campos estruturados aparecem sempre.
 */
import { describe, expect, it } from "vitest";
import { cartaoDaAcao, dataBrasilia, nomeDoSistema, rotuloAcao } from "./acoes";

describe("cartão de ação", () => {
  it("status", () => {
    expect(rotuloAcao("feita")).toMatch(/feito/i);
    expect(rotuloAcao("pendente")).not.toMatch(/feito/i);
  });
  it("lista pelo nome quando o servidor resolveu; id só como recurso", () => {
    // 06/11: "Na lista 368" não dizia nada a ninguém.
    expect(cartaoDaAcao("criar", { list_id: 368, title: "T", _exibir: { lista: "EM ANDAMENTO - ERICK" } }).linhas[0])
      .toEqual(["Lista", "EM ANDAMENTO - ERICK"]);
    expect(cartaoDaAcao("criar", { list_id: 368, title: "T" }).linhas[0]).toEqual(["Lista", "lista 368"]);
  });
  it("criar separa descrição e checklist", () => {
    const c = cartaoDaAcao("criar", { list_id: 3, title: "Nova", priority: "high", due_date: "2026-11-10",
      description: "d", checklist: { title: "Checklist", items: ["a", "b"] } });
    expect(c.titulo).toBe("Nova");
    expect(c.linhas).toEqual([["Lista", "lista 3"], ["Membro", "você"], ["Prioridade", "Alta"], ["Prazo", "10/11/2026"]]);
    expect(c.texto).toEqual({ rotulo: "Descrição", valor: "d" });
    expect(c.checklists[0].itens.map((i) => i.texto)).toEqual(["a", "b"]);
  });
  it("mover, comentar e atualizar", () => {
    expect(cartaoDaAcao("mover", { list_id: 3, card_id: 9, para_list_id: 4, _exibir: { tarefa: "X", para_lista: "Feito" } }))
      .toMatchObject({ titulo: "X", linhas: [["Para", "Feito"]] });
    expect(cartaoDaAcao("comentar", { list_id: 3, card_id: 9, texto: "ok" }))
      .toMatchObject({ titulo: "card 9", texto: { rotulo: "Comentário", valor: "ok" } });
    const a = cartaoDaAcao("atualizar", { list_id: 3, card_id: 9, campos: { done: true },
      marcar_itens: [{ checklist_id: 5, item_id: 50, checked: true }], _exibir: { itens: { "5:50": "Miguel" } } });
    expect(a.linhas).toEqual([["Concluída", "sim"]]);
    expect(a.checklists[0].itens).toEqual([{ texto: "Miguel", feito: true }]);
  });
  it("atualizar descrição aparece no bloco de texto", () => {
    const a = cartaoDaAcao("atualizar", { list_id: 3, card_id: 9, campos: { description: "" } });
    expect(a.linhas).toEqual([]);
    expect(a.texto?.valor).toBe("(apagar a descrição)");
  });
  it("checklist novo e itens a marcar aparecem OS DOIS", () => {
    // Revisão de segurança: com `??`, o checklist novo escondia as marcações
    // — e o clique aprovava algo que o cartão não mostrou.
    const a = cartaoDaAcao("atualizar", { list_id: 3, card_id: 9, campos: {},
      checklist: { title: "Novo", items: ["x"] },
      marcar_itens: [{ checklist_id: 5, item_id: 50, checked: true }] });
    expect(a.checklists.map((c) => c.titulo)).toEqual(["Novo", "Marcar no checklist"]);
  });
  it("membros: quem entra e quem sai, pelo nome", () => {
    const c = cartaoDaAcao("membros", { list_id: 3, card_id: 9, adicionar: [2], remover: [1, 5],
      _exibir: { tarefa: "Card", adicionar: ["Ellen"], remover: ["Erick"] } });
    expect(c.verbo).toBe("Membros da tarefa");
    expect(c.titulo).toBe("Card");
    expect(c.linhas).toEqual([["Entram", "Ellen"], ["Saem", "Erick, user_id 5"]]);
  });
  it("acrescentar itens e excluir checklist aparecem no cartão", () => {
    const c = cartaoDaAcao("atualizar", { list_id: 3, card_id: 9, campos: {},
      adicionar_itens: { checklist_id: 5, items: ["Membros de card"] }, excluir_checklist: 6,
      _exibir: { tarefa: "Mudanças HS.OS", adicionar_em: "Mudanças", excluir: { titulo: "Mudanças", itens: 5 } } });
    expect(c.checklists).toEqual([{ titulo: "Acrescentar em “Mudanças”", itens: [{ texto: "Membros de card" }] }]);
    expect(c.linhas).toEqual([["Excluir checklist", "Mudanças (5 itens)"]]);
  });
});

describe("cartão do GestorHS (Expedição)", () => {
  it("nome do sistema no cabeçalho", () => {
    expect(nomeDoSistema("gestorhs")).toBe("GestorHS");
    expect(nomeDoSistema("taskhs")).toBe("TaskHS");
  });
  it("receber: o cliente em cada aparelho e o aviso da fase", () => {
    // A série falada pode ser de aparelho de outro cliente: sem o cliente em
    // cada linha, a pessoa confirmaria OS no cliente errado.
    const c = cartaoDaAcao("receber", {
      caixa: 40, data_chegada: null,
      aparelhos: [
        { equipamento_cliente: 5, tipo_servico: "C", condicao_chegada: null, checklist: [8], pilhas: 0, bocais: 2, observacoes: null },
        { equipamento_cliente: 6, tipo_servico: "M", condicao_chegada: "Com avarias", checklist: [], pilhas: 0, bocais: 0, observacoes: null },
      ],
      _exibir: { caixa: "caixa 40", clientes: 2, aviso: "a OS já entra em Laboratório",
        linhas: [{ cliente: "ACME", modelo: "Phoebus", serie: "F1", acessorios: ["Maleta"] },
                 { cliente: "Beta Ltda", modelo: "Phoebus", serie: "F2", acessorios: [] }] },
    });
    expect(c.verbo).toBe("Receber aparelhos");
    expect(c.titulo).toBe("Caixa 40");
    expect(c.linhas).toEqual([["Aparelhos", "2"], ["Clientes", "2 — confira"]]);
    const itens = c.checklists[0].itens.map((i) => i.texto);
    expect(itens[0]).toBe("Phoebus · série F1 · ACME · calibração · Maleta · 2 bocais");
    expect(itens[1]).toContain("Beta Ltda");
    expect(itens[1]).toContain("Com avarias");
    expect(c.texto).toEqual({ rotulo: "Atenção", valor: "a OS já entra em Laboratório" });
  });
  it("receber em caixa nova, de um cliente só, sem aviso", () => {
    const c = cartaoDaAcao("receber", { caixa: null,
      aparelhos: [{ equipamento_cliente: 5, tipo_servico: "A" }],
      _exibir: { caixa: "caixa nova", clientes: 1, aviso: null, linhas: [{ cliente: "ACME", modelo: "P", serie: "F1" }] } });
    expect(c.titulo).toBe("Caixa nova");
    expect(c.linhas).toEqual([["Aparelhos", "1"]]);
    expect(c.texto).toBeUndefined();
  });
  it("avançar caixa", () => {
    const c = cartaoDaAcao("avancar_caixa", { caixa: 41, cliente_principal: 2,
      _exibir: { fase: "Recebido", funcao: "Expedição", total_os: 3, cliente_principal: "Beta Ltda" } });
    expect(c).toMatchObject({ verbo: "Avançar caixa", titulo: "Caixa 41",
      linhas: [["Fase atual", "Recebido"], ["OS", "3"], ["Cliente principal", "Beta Ltda"]] });
  });
  it("fechar caixa mostra o rastreio", () => {
    const c = cartaoDaAcao("fechar_caixa", { caixa: 42, cod_retorno: "BR123",
      _exibir: { total_os: 1, clientes: ["ACME"] } });
    expect(c).toMatchObject({ verbo: "Fechar caixa", titulo: "Caixa 42" });
    expect(c.linhas[0]).toEqual(["Rastreio", "BR123"]);
  });
  it("gerar certificado: as 5 leituras, a média do servidor e o aviso de que conclui", () => {
    // O técnico confirma número por número: leitura escondida seria certificado
    // da Qualidade aprovado sem ser visto. E regerar mostra a data antiga.
    const c = cartaoDaAcao("gerar_certificado", {
      ordem: 11700, calib_cert: "HF02961", calib_temp: "22.0", calib_pressao: "1017.3",
      calib_teste1: "0,170", calib_teste2: "0,170", calib_teste3: "0,170", calib_teste4: "0,180",
      calib_teste5: "0,190", calib_teste_media: "0,176", calib_situacao: "Aparelho subsequente",
      _exibir: { os: 11700, cliente: "ACME", modelo: "Phoebus", serie: "F006097", data: "2026-11-10",
                 substitui: true, tipo: "calibração e manutenção", manutencao: true },
    });
    expect(c.verbo).toBe("Gerar certificado");
    expect(c.titulo).toBe("OS 11700 · série F006097");
    expect(c.linhas).toEqual([["Cliente", "ACME"], ["Modelo", "Phoebus"], ["Código", "HF02961"],
      ["Temperatura", "22.0 °C"], ["Pressão", "1017.3 hPa"], ["Média", "0,176"],
      ["Situação", "Aparelho subsequente"], ["Data", "10/11/2026"]]);
    expect(c.checklists).toEqual([{ titulo: "Leituras",
      itens: ["0,170", "0,170", "0,170", "0,180", "0,190"].map((x, i) => ({ texto: `${i + 1}ª: ${x}` })) }]);
    expect(c.texto?.rotulo).toBe("Atenção");
    expect(c.texto?.valor).toContain("conclui o aparelho");
    expect(c.texto?.valor).toContain("substitui o certificado já gerado");
    expect(c.texto?.valor).toContain("relatório de manutenção");
  });
  it("gerar certificado pela primeira vez sai com a data de hoje e sem 'substitui'", () => {
    const c = cartaoDaAcao("gerar_certificado", { ordem: 1, calib_teste1: "0,1",
      _exibir: { serie: "F1", data: "hoje", substitui: false, manutencao: false } });
    expect(c.linhas).toContainEqual(["Data", "hoje"]);
    expect(c.texto?.valor).not.toContain("substitui");
    expect(c.texto?.valor).not.toContain("manutenção");
  });
  it("cadastrar aparelho", () => {
    const c = cartaoDaAcao("cadastrar_aparelho", { cliente: 1, equipamento: 2, serie: "F9", patrimonio: "P1",
      _exibir: { cliente: "ACME", modelo: "Phoebus" } });
    expect(c).toMatchObject({ verbo: "Cadastrar aparelho", titulo: "Série F9",
      linhas: [["Cliente", "ACME"], ["Modelo", "Phoebus"], ["Patrimônio", "P1"]] });
  });
  it("nova proposta: total, itens com o preço do payload e os lembretes em destaque", () => {
    // Fase 2c. O que vai ao PDF do cliente é o payload: preço e quantidade saem
    // dele; lembrete escondido seria a pessoa confirmando sem ler o que fugiu
    // do padrão.
    const c = cartaoDaAcao("criar_proposta", {
      destinatario: { tipo: "cliente", id: 7 }, frete: 150, desconto: 10, condicao_pagamento: "60 dias",
      validade_dias: 30,
      itens: [{ descricao: "CALIBRAÇÃO COM GÁS", sku: "312", quantidade: 3, unidade: "UN", preco_un: 350 },
              { descricao: "BOCAL", sku: "P1", quantidade: 1200, unidade: "UN", preco_un: 2 }],
      aparelhos: [{ equipamento_cliente: 70 }],
      _exibir: { cliente: "ACME Transportes", total: 3590, modelo: "padrão",
        itens: [{ fora_do_catalogo: true }, { fora_do_catalogo: false }],
        aparelhos: [{ modelo: "Alcoolímetro X", serie: "F1" }],
        lembretes: ["Preço diferente do catálogo.", "Aparelho F2 ficou fora."] },
    });
    expect(c.verbo).toBe("Nova proposta");
    expect(c.titulo).toBe("ACME Transportes");
    expect(c.linhas).toEqual([["Total", "R$ 3.590,00"], ["Frete", "R$ 150,00"], ["Desconto", "R$ 10,00"],
      ["Pagamento", "60 dias"], ["Validade", "30 dias"], ["Modelo", "padrão"]]);
    expect(c.checklists[0]).toEqual({ titulo: "Itens", itens: [
      { texto: "3 × CALIBRAÇÃO COM GÁS — R$ 350,00 = R$ 1.050,00 (≠ catálogo)" },
      { texto: "1200 × BOCAL — R$ 2,00 = R$ 2.400,00" }] });
    expect(c.checklists[1]).toEqual({ titulo: "Aparelhos", itens: [{ texto: "Alcoolímetro X · série F1" }] });
    expect(c.texto).toEqual({ rotulo: "Lembretes", valor: "Preço diferente do catálogo.\nAparelho F2 ficou fora." });
  });
  it("nova proposta no padrão: sem desconto, sem lembrete, pagamento em branco", () => {
    const c = cartaoDaAcao("criar_proposta", { frete: 0, itens: [], _exibir: { cliente: "X", total: 0, lembretes: [] } });
    expect(c.linhas.map(([k]) => k)).not.toContain("Desconto");
    expect(c.linhas).toContainEqual(["Pagamento", "em branco"]);
    expect(c.texto).toBeUndefined();
  });
  it("alterar proposta: total antes → depois, uma linha por mudança, o que entra e o que sai", () => {
    // O `PUT` substitui a lista inteira: o cartão tem que mostrar o que SAI,
    // senão a pessoa aprova perder um aparelho sem ver.
    const c = cartaoDaAcao("alterar_proposta", { proposta: 500, corpo: { condicao_pagamento: "60 dias" },
      _exibir: { numero: 1234, cliente: "ACME", total_antes: 940, total_depois: 1335,
        mudancas: [["Pagamento", "30 dias", "60 dias"]],
        itens_entram: ["3 × CALIBRAÇÃO — R$ 395,00"], itens_saem: ["2 × CALIBRAÇÃO — R$ 395,00"],
        aparelhos_entram: [], aparelhos_saem: ["Alcoolímetro X · série F3"],
        lembretes: ["O texto de outros itens foi editado na tela."] } });
    expect(c.verbo).toBe("Alterar proposta");
    expect(c.titulo).toBe("Proposta 1234 · ACME");
    expect(c.linhas).toEqual([["Total", "R$ 940,00 → R$ 1.335,00"], ["Pagamento", "30 dias → 60 dias"]]);
    expect(c.checklists).toEqual([
      { titulo: "Entram", itens: [{ texto: "3 × CALIBRAÇÃO — R$ 395,00" }] },
      { titulo: "Saem", itens: [{ texto: "2 × CALIBRAÇÃO — R$ 395,00" }, { texto: "Alcoolímetro X · série F3" }] }]);
    expect(c.texto).toEqual({ rotulo: "Lembretes", valor: "O texto de outros itens foi editado na tela." });
  });
});

describe("cartão do HSGrowth", () => {
  it("o sistema tem nome", () => {
    expect(nomeDoSistema("hsgrowth")).toBe("HSGrowth");
  });
  it("cartão do registrar mostra as quatro partes", () => {
    // O vendedor confirma o que o cartão mostra: campo, nota, etapa e tarefas
    // têm que estar todos lá, com valores do payload. Faltar uma parte seria
    // aprovar o que não foi visto.
    const c = cartaoDaAcao("hsgrowth_registrar", {
      card_id: 7, campos: { value: 1500, modality: "locacao" }, nota: "Falei com o diretor.",
      mover_para: 61, campos_personalizados: [{ field_definition_id: 3, value: "Sim" }],
      tarefas: [{ op: "criar", title: "Ligar", task_type: "call", priority: "high", due_date: "2026-11-19T13:00:00Z" },
                { op: "concluir", task_id: 9, valida: true }, { op: "concluir", task_id: 10, valida: false }],
      _exibir: { card: "ACME", cliente: "ACME SA", antes: { value: 1000, modality: null },
        campos_personalizados: ["Nº de bafômetros"], tarefas: ["Ligar", "Reunião X", "Ligar Y"],
        etapa_para: "Qualificação", aviso: "Falta reunião agendada." } });
    expect(c.verbo).toBe("Atualizar card");
    expect(c.titulo).toBe("ACME");
    expect(c.linhas).toEqual([
      ["Cliente", "ACME SA"], ["Valor", "1500 (antes: 1000)"], ["Modalidade", "locacao (antes: (vazio))"],
      ["Nº de bafômetros", "Sim"],
      ["Nova tarefa", "Ligação · Ligar · prioridade Alta · 19/11/2026 10:00"],
      ["Concluir", "Reunião X · realizada"], ["Concluir", "Ligar Y · tentativa sem resultado"],
      ["Mover para", "Qualificação"], ["Atenção", "Falta reunião agendada."]]);
    expect(c.texto).toEqual({ rotulo: "Nota", valor: "Falei com o diretor." });
  });
  it("perder mostra o motivo", () => {
    const c = cartaoDaAcao("hsgrowth_perder", { card_id: 7, motivo: "Sem orçamento", _exibir: { card: "ACME" } });
    expect(c.verbo).toBe("Marcar como PERDIDO");
    expect(c.linhas).toEqual([["Motivo", "Sem orçamento"]]);
    expect(cartaoDaAcao("hsgrowth_ganhar", { card_id: 7, _exibir: { card: "ACME" } }).verbo).toBe("Marcar como GANHO");
    expect(cartaoDaAcao("hsgrowth_noshow", { card_id: 7, task_id: 2, _exibir: { card: "ACME", reuniao: "Demo" } }).verbo)
      .toBe("Cliente não compareceu");
  });
  it("cliente mostra antes e depois", () => {
    // O depois é o do payload (o que vai ao cadastro compartilhado); o antes, do `_exibir`.
    const c = cartaoDaAcao("hsgrowth_cliente", { card_id: 7, cliente: { id: 4, campos: { sector: "Mineração" } },
      contato: { id: 5, campos: { email: "a@b.com" } },
      _exibir: { card: "ACME", antes: { cliente: { sector: null }, contato: { email: "velho@b.com" } },
                 depois: { cliente: { sector: "FORJADO" } } } });
    expect(c.linhas).toEqual([["Cliente · Setor", "(vazio) → Mineração"], ["Contato · E-mail", "velho@b.com → a@b.com"]]);
  });
  it("lead novo mostra cliente, contato e campos", () => {
    const c = cartaoDaAcao("hsgrowth_criar_lead", { titulo: "Bafômetros", list_id: 61,
      cliente: { campos: { name: "ACME", sector: "Mineração" } }, contato: { campos: { name: "Ana", phone: "11999" } },
      campos_do_card: { value: 900 }, _exibir: { etapa: "Lead Novo", documento: "123", cliente: "ACME",
        cliente_existente: false, contato: "Ana" } });
    expect(c.verbo).toBe("Novo lead");
    expect(c.titulo).toBe("Bafômetros");
    expect(c.linhas).toContainEqual(["Cliente (novo)", "ACME"]);
    expect(c.linhas).toContainEqual(["Contato (novo)", "Ana"]);
    expect(c.linhas).toContainEqual(["Contato · Telefone", "11999"]);
    expect(c.linhas).toContainEqual(["Valor", "900"]);
  });
  it("data da tarefa sai em horário de Brasília", () => {
    expect(dataBrasilia("2026-11-19T13:00:00Z")).toBe("19/11/2026 10:00");
    expect(dataBrasilia("2026-11-19T02:30:00Z")).toBe("18/11/2026 23:30");
  });
  it("tarefa nova mostra o título do payload, sem _exibir", () => {
    // O executor cria com o `title` do payload; mostrar outra coisa aprovaria o que não vai.
    const c = cartaoDaAcao("hsgrowth_registrar", { card_id: 7,
      tarefas: [{ op: "criar", title: "Enviar proposta", task_type: "email" }] });
    expect(c.linhas).toEqual([["Nova tarefa", "E-mail · Enviar proposta"]]);
  });
  it("lead sem _exibir não inventa etapa nem cliente; cliente existente não lista campos", () => {
    const c = cartaoDaAcao("hsgrowth_criar_lead", { titulo: "L", list_id: 61,
      cliente: { campos: { name: "ACME", sector: "Mineração" } }, contato: { id: 5 }, campos_do_card: {} });
    expect(c.linhas).toContainEqual(["Etapa", "etapa 61"]);
    expect(c.linhas).toContainEqual(["Cliente (novo)", "ACME"]);
    const e = cartaoDaAcao("hsgrowth_criar_lead", { titulo: "L", list_id: 61,
      cliente: { id: 4, campos: { sector: "IGNORADO" } }, contato: { id: 5 }, campos_do_card: {} });
    expect(e.linhas.some(([k]) => k.includes("Setor"))).toBe(false);
  });
});
