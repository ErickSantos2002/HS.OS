/**
 * Histórico de versões do HS.OS, em linguagem de quem USA o sistema.
 *
 * ⚠️ **Toda mudança no sistema termina com uma entrada aqui** (regra no
 * `CLAUDE.md`). Versão nova vai **no topo** — é o topo que vira a versão do
 * rodapé e que faz o "O que há de novo?" abrir sozinho para todo mundo. Uma
 * entrada no fim da lista não aparece para ninguém (teste em
 * `src/test/novidades.test.ts`).
 *
 * Semver: correção → patch (2.2.x); novidade ou melhoria → minor (2.x.0);
 * mudança que muda o jeito de usar o sistema → major.
 *
 * As versões até 2.1.0 foram montadas em 10/11/2026 a partir do histórico do
 * git, por marcos — o sistema nasceu em 04/08/2026 sem changelog.
 */

export type TipoMudanca = "novidade" | "melhoria" | "correcao";

export interface Mudanca {
  kind: TipoMudanca;
  text: string;
}

export interface ChangelogVersion {
  version: string;
  /** ISO `AAAA-MM-DD`. */
  date: string;
  changes: Mudanca[];
}

export const CHANGELOG: ChangelogVersion[] = [
  {
    version: "2.28.0",
    date: "2026-11-27",
    changes: [
      {
        kind: "correcao",
        text: "O assistente pessoal não lista mais, entre as suas tarefas do CRM, as de negócios já ganhos ou perdidos — só as de cards em aberto.",
      },
      {
        kind: "novidade",
        text: "Limpar conversa: no menu da conversa (a setinha ao lado do nome, ou segurando no celular), apague de uma vez todas as mensagens de uma conversa ou grupo — só para você; quem está do outro lado continua vendo. Dá para desfazer logo em seguida.",
      },
      {
        kind: "novidade",
        text: "Encaminhar mensagem, como no WhatsApp: na seta da mensagem (ou segurando a bolha no celular), escolha até 10 colegas ou grupos de uma vez — os anexos vão junto e abrem para quem recebe, com o selo \"Encaminhada\". Dá para encaminhar também as respostas dos agentes.",
      },
      {
        kind: "novidade",
        text: "Encaminhar para o seu assistente pessoal abre a conversa com ele já com a mensagem e os anexos no campo: é só dizer o que você quer com aquilo e enviar.",
      },
    ],
  },
  {
    version: "2.27.0",
    date: "2026-11-26",
    changes: [
      {
        kind: "novidade",
        text: "Quando o RH aprova ou recusa seu pedido de ausência no TalentHS, seu assistente pessoal avisa na hora — com o motivo, quando o pedido for recusado.",
      },
    ],
  },
  {
    version: "2.26.0",
    date: "2026-11-26",
    changes: [
      {
        kind: "melhoria",
        text: "O assistente pessoal passa a enxergar as etiquetas dos cards do TaskHS: mostra as etiquetas de cada card e consegue contar os cards de uma etiqueta num quadro, com há quanto tempo cada um está parado.",
      },
    ],
  },
  {
    version: "2.25.1",
    date: "2026-11-26",
    changes: [
      {
        kind: "correcao",
        text: "Ao pedir uma ausência pelo assistente pessoal, ele passa a perguntar o motivo (o TalentHS exige pelo menos 20 caracteres) antes de montar o cartão — antes o cartão saía sem motivo e dava erro ao confirmar.",
      },
    ],
  },
  {
    version: "2.25.0",
    date: "2026-11-26",
    changes: [
      {
        kind: "melhoria",
        text: "O aviso de pedido de ausência agora vem num cartão só, com os botões Recusar e Aprovar — antes eram dois cartões, cada um com Cancelar e Confirmar.",
      },
    ],
  },
  {
    version: "2.24.1",
    date: "2026-11-26",
    changes: [
      {
        kind: "correcao",
        text: "O aviso de pedido de ausência para o RH passa a chegar de fato — na primeira versão o TalentHS recusava a consulta dos pedidos e nada era avisado.",
      },
    ],
  },
  {
    version: "2.24.0",
    date: "2026-11-26",
    changes: [
      {
        kind: "novidade",
        text: "Pedido de ausência feito no TalentHS agora chega para o RH na conversa com o assistente pessoal, com os botões Aprovar e Recusar ali mesmo — sem precisar abrir o TalentHS para descobrir que tem pedido esperando.",
      },
    ],
  },
  {
    version: "2.23.1",
    date: "2026-11-26",
    changes: [
      {
        kind: "correcao",
        text: "O seu assistente pessoal passa a saber com certeza quem está falando com ele: o e-mail e os sistemas não ficam mais bloqueados quando um administrador conversa com ele ao mesmo tempo, e continuam fechados para qualquer outra pessoa.",
      },
    ],
  },
  {
    version: "2.23.0",
    date: "2026-11-26",
    changes: [
      {
        kind: "novidade",
        text: "Administradores passam a ser avisados no chat e no sininho quando a cópia de segurança diária do sistema ou dos agentes falha ou deixa de acontecer.",
      },
    ],
  },
  {
    version: "2.22.5",
    date: "2026-11-26",
    changes: [
      {
        kind: "correcao",
        text: "Nos horários de pico da manhã, alguns agentes ficavam até um minuto sem acesso a anexos, e-mail ou bancos de dados e respondiam como se a ferramenta não existisse. Agora eles esperam a ferramenta carregar.",
      },
    ],
  },
  {
    version: "2.22.4",
    date: "2026-11-25",
    changes: [
      {
        kind: "correcao",
        text: "Mais proteção no login: depois de 5 senhas erradas seguidas, o login por senha daquele e-mail espera 15 minutos (o \"Entrar com Microsoft\" continua funcionando). Contas de administrador entram só pelo \"Entrar com Microsoft\".",
      },
    ],
  },
  {
    version: "2.22.3",
    date: "2026-11-25",
    changes: [
      {
        kind: "correcao",
        text: "Painéis ao vivo só mostram dados para quem os criou. Abrir o painel de outra pessoa mostra o desenho, mas não lê as suas conversas nem usa as suas integrações — e o painel não consegue mais enviar nada para fora do HS.OS.",
      },
    ],
  },
  {
    version: "2.22.2",
    date: "2026-11-24",
    changes: [
      {
        kind: "correcao",
        text: "Os agentes não ficam mais minutos em \"Iniciando…\" nos horários de pico (começo da manhã e da tarde). O servidor dos agentes ficava sem memória quando muita gente conversava ao mesmo tempo, e isso foi resolvido.",
      },
      {
        kind: "correcao",
        text: "Arquivos da Base de Conhecimento ficaram mais seguros: SVG e XML agora são baixados em vez de abertos numa aba, links de arquivo que poderiam executar código são recusados, e a prévia de HTML só abre arquivos do próprio sistema.",
      },
    ],
  },
  {
    version: "2.22.1",
    date: "2026-11-23",
    changes: [
      {
        kind: "correcao",
        text: "A situação financeira das 8h do Midas confere os alertas do dia toda manhã, em vez de repetir um alerta de dias anteriores. Ele não lembra mais a conversa da véspera, mas o histórico continua na tela.",
      },
    ],
  },
  {
    version: "2.22.0",
    date: "2026-11-23",
    changes: [
      {
        kind: "melhoria",
        text: "Conversa silenciada não entra mais no número das abas Pessoas, Agentes e Canais, no computador e no celular. Ela continua mostrando as próprias não lidas na lista.",
      },
    ],
  },
  {
    version: "2.21.1",
    date: "2026-11-23",
    changes: [
      {
        kind: "correcao",
        text: "O resumo de pendências do seu Guardi não diz mais que \"não conseguiu ler o GestorHS\": as OS de lá não têm responsável, então ele deixou de contar \"suas OS\" no resumo. Continua consultando o GestorHS sempre que você pedir.",
      },
      {
        kind: "correcao",
        text: "Quem usa o HSGrowth de Serviços passa a ver no resumo as próprias atividades pendentes e cards parados, em vez de \"não consegui ler o HSGrowth\".",
      },
    ],
  },
  {
    version: "2.21.0",
    date: "2026-11-19",
    changes: [
      {
        kind: "novidade",
        text: "O Midas responde quanto a empresa precisa faturar por mês para empatar, quanto da receita depende dos maiores clientes, o prazo médio de recebimento, o estoque parado e a dívida por ano.",
      },
      {
        kind: "melhoria",
        text: "O resumo das 8h avisa quando uma locação faturada todo mês ainda não foi emitida, e separa o cliente que costuma pagar atrasado do atraso fora do padrão.",
      },
    ],
  },
  {
    version: "2.20.0",
    date: "2026-11-19",
    changes: [
      {
        kind: "novidade",
        text: "O Midas mostra o que dá dinheiro: receita, custo e margem por linha (aparelho, consumível, acessório, calibração, plataforma, locação) e por produto.",
      },
      {
        kind: "novidade",
        text: "Todo mês, no primeiro dia útil a partir do dia 25, o resumo das 8h traz o fechamento do mês anterior: o resultado comparado com o mês anterior e com o mesmo mês do ano passado, e as maiores variações.",
      },
    ],
  },
  {
    version: "2.19.0",
    date: "2026-11-19",
    changes: [
      {
        kind: "novidade",
        text: "O Midas responde o resultado do mês: lucro ou prejuízo já descontado o custo da mercadoria, margem e quanto sobrou depois de pagar o banco, dizendo quando o mês ainda não fechou.",
      },
      {
        kind: "novidade",
        text: "O Midas projeta o caixa das próximas 13 semanas e diz quanto é preciso ter em conta para não ficar no vermelho, e em que semana está o aperto.",
      },
      {
        kind: "novidade",
        text: "O resumo financeiro das 8h abre com o que pede atenção: aperto de caixa, cliente que passou a ser inadimplente, importação grande lançada e mês que fechou em prejuízo.",
      },
    ],
  },
  {
    version: "2.18.1",
    date: "2026-11-19",
    changes: [
      {
        kind: "correcao",
        text: "O Guardi passa a enxergar no HSGrowth todos os cards em que você é SDR, não só os em que é o responsável, e conta os cards de cada etapa do funil sem cortar a lista no meio.",
      },
    ],
  },
  {
    version: "2.18.0",
    date: "2026-11-19",
    changes: [
      {
        kind: "melhoria",
        text: "O Midas manda a situação financeira da empresa todo dia útil às 8h, direto na conversa: o que entra e sai na semana, vencidos novos e o faturamento do trimestre contra a meta. Na segunda, também o calendário do Financeiro.",
      },
    ],
  },
  {
    version: "2.17.0",
    date: "2026-11-18",
    changes: [
      {
        kind: "novidade",
        text: "Midas, o assistente financeiro do Nicholson, substitui a Iris: faturamento, contas a receber e a pagar, custos e calendário do Financeiro, com um resumo semanal toda segunda-feira.",
      },
      {
        kind: "melhoria",
        text: "As listas de inadimplência e de compradores não geram mais link público — ficam em Documentos, privadas.",
      },
    ],
  },
  {
    version: "2.16.0",
    date: "2026-11-18",
    changes: [
      {
        kind: "novidade",
        text: "Agora dá para marcar uma conversa como não lida pela lista — segure a conversa no celular, ou use o ⋮ / clique direito no computador. Ela fica com uma bolinha sem número até você abrir de novo, para lembrar de voltar nela.",
      },
      {
        kind: "melhoria",
        text: "O \"Marcar como não lida\" saiu do menu de cada mensagem: ele sumia sozinho com a conversa aberta. Use o da lista de conversas.",
      },
    ],
  },
  {
    version: "2.15.2",
    date: "2026-11-18",
    changes: [
      {
        kind: "correcao",
        text: "O resumo de pendências do seu Guardi não diz mais que um sistema \"falhou\" quando ele simplesmente não está ligado para você (como o CRM para quem não é de vendas, ou o e-mail ainda não conectado). O quadro da equipe deixa de mostrar esses falsos alarmes.",
      },
    ],
  },
  {
    version: "2.15.1",
    date: "2026-11-16",
    changes: [
      {
        kind: "correcao",
        text: "Mensagem que seu Guardi ou outro agente manda sem você estar na tela (como o cardápio do dia) agora aparece como não lida quando você abre o sistema.",
      },
      {
        kind: "correcao",
        text: "A conferência da tarde não repete mais o cardápio quando a varredura da manhã foi refeita: ela compara com a última conferência do dia.",
      },
    ],
  },
  {
    version: "2.15.0",
    date: "2026-11-16",
    changes: [
      {
        kind: "novidade",
        text: "À tarde seu Guardi confere de novo as suas pendências e só te avisa se apareceu algo novo desde a manhã.",
      },
    ],
  },
  {
    version: "2.14.2",
    date: "2026-11-16",
    changes: [
      {
        kind: "correcao",
        text: "O quadro da equipe que a Nina monta traz todas as pessoas e não trata como problema um sistema que simplesmente não está ligado ao Guardi.",
      },
      {
        kind: "correcao",
        text: "O resumo do seu Guardi passa a cobrir todos os sistemas ligados a ele — se algum não puder ser lido, ele diz qual.",
      },
    ],
  },
  {
    version: "2.14.1",
    date: "2026-11-16",
    changes: [
      {
        kind: "correcao",
        text: "O resumo do seu Guardi fala só do que é seu (não do sistema inteiro) e termina com uma única sugestão do que ele pode preparar.",
      },
    ],
  },
  {
    version: "2.14.0",
    date: "2026-11-16",
    changes: [
      {
        kind: "novidade",
        text: "Seu Guardi agora te manda de manhã o que você tem pendente (TaskHS, CRM, GestorHS e e-mail) e, à tarde, só avisa se surgiu algo novo.",
      },
      {
        kind: "novidade",
        text: "A Nina passou a reunir as pendências da equipe e pode pedir a um Guardi que confira de novo — você vê na sua conversa quando isso acontece.",
      },
    ],
  },
  {
    version: "2.13.0",
    date: "2026-11-13",
    changes: [
      {
        kind: "melhoria",
        text: "O lembrete agora toca como alarme: repete enquanto estiver esperando sua resposta, mesmo com o HS.OS em segundo plano, e o nome da aba pisca \"⏰ LEMBRETE\". Para calar sem dispensar, use \"Silenciar alarme\".",
      },
    ],
  },
  {
    version: "2.12.0",
    date: "2026-11-13",
    changes: [
      {
        kind: "melhoria",
        text: "Lembrete agora chama atenção de verdade: a notificação fica na tela até você escolher \"Adiar 10 min\" ou \"Feito\" (dá para clicar ali mesmo, sem abrir o HS.OS), e com o HS.OS aberto aparece uma janela no centro, com som. Se você não responder em 5 minutos, ele avisa de novo — uma vez só. Na Agenda, cada lembrete mostra o que você fez: \"Feito às 14:05\", \"Adiado para 14:10\".",
      },
      {
        kind: "melhoria",
        text: "A tela \"Capacidade\" do Guardi ficou organizada por assunto: em vez de uma lista longa e técnica, cada sistema mostra blocos coloridos como Férias e ausências, Ponto ou Metas e PDI, cada um dizendo em poucas palavras o que o Guardi vê, o que ele faz por você e uma frase para experimentar. Passos internos, que só o Guardi usa, saíram da tela.",
      },
    ],
  },
  {
    version: "2.11.0",
    date: "2026-11-13",
    changes: [
      {
        kind: "novidade",
        text: "Botão \"Capacidade\" na conversa com o seu Guardi (no celular, no ⋮): mostra os sistemas que ele alcança e, em cada um, o que ele consegue consultar e fazer com o SEU login — com exemplos do que dizer. Sistema que ainda não informa isso aparece avisando, sem prometer nada.",
      },
      {
        kind: "novidade",
        text: "O Guardi agora consulta o TalentHS como você: férias e ausências, ponto, metas, PDI, avaliação, feedbacks, cursos e trilhas, benefícios, comunicados e aniversários. Ele vê só o que o seu login lá vê — e o RH, o que o RH vê.",
      },
      {
        kind: "novidade",
        text: "O Guardi agora faz coisas no TalentHS por você: pedir ou cancelar uma ausência, pedir ajuste de ponto, lançar a batida esquecida, responder feedback, entrar ou sair de workshop. Para o RH, também aprovar ausências e ponto (várias de uma vez), escrever comunicado, pôr evento no calendário, montar PDI, lançar o realizado da meta e registrar curso. Nada acontece sem você confirmar no cartão — e, se algo mudou no TalentHS desde então, ele não grava e avisa.",
      },
      {
        kind: "correcao",
        text: "O Guardi passa a falar os horários de cards, e-mails e tarefas no horário de Brasília — antes vinham três horas adiantados.",
      },
      {
        kind: "correcao",
        text: "O Guardi agora sabe quando você confirma ou descarta um cartão dele, e para de perguntar de novo sobre o que você já decidiu.",
      },
      {
        kind: "melhoria",
        text: "O Guardi ficou mais parceiro: depois de responder, oferece o próximo passo que ele mesmo pode dar, reconhece o que você concluiu e, quando algo trava, ajuda a achar o menor passo de hoje. Pergunta rápida continua com resposta rápida.",
      },
      {
        kind: "melhoria",
        text: "O Guardi agora encontra os cards parados do TaskHS pela mesma régua do Dashboard: mais de 72 h úteis desde a criação, ou travados há mais de 24 h úteis na mesma lista, por setor. Basta perguntar \"quais cards estão atrasados?\" — vale para quem é administrador ou coordenador no TaskHS.",
      },
      {
        kind: "melhoria",
        text: "No app do celular, Pessoas, Agentes e Canais mostram quantas mensagens não lidas há em cada um — dá para ver sem trocar de aba.",
      },
      {
        kind: "novidade",
        text: "GIFs no celular: o botão GIF ao lado do clipe, nos canais e nas conversas com pessoas.",
      },
      {
        kind: "melhoria",
        text: "O app do celular agora mostra a foto das pessoas na lista de conversas e nas silenciadas, como no computador. Foto que não carrega volta para a inicial.",
      },
    ],
  },
  {
    version: "2.10.1",
    date: "2026-11-13",
    changes: [
      {
        kind: "correcao",
        text: "Digitar nas conversas ficou leve de novo: em conversas longas as letras demoravam a aparecer.",
      },
      {
        kind: "correcao",
        text: "No celular, digitar nas conversas também ficou leve.",
      },
    ],
  },
  {
    version: "2.10.0",
    date: "2026-11-12",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi de Serviços agora trabalha no CRM: consulta os quadros de Serviços e Cobrança e prepara o registro do contato, a mudança de etapa e o anexo da proposta para você confirmar.",
      },
    ],
  },
  {
    version: "2.9.0",
    date: "2026-11-12",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi dos vendedores agora trabalha no CRM: consulta o funil e prepara lead, notas, tarefas e mudança de etapa para você confirmar.",
      },
    ],
  },
  {
    version: "2.8.0",
    date: "2026-11-12",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi agora monta e altera propostas no GestorHS: você conta o que o cliente pediu, ele preenche pelo padrão da casa e avisa o que ficou diferente ou faltando — sempre com a sua confirmação.",
      },
    ],
  },
  {
    version: "2.7.0",
    date: "2026-11-12",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi agora ajuda o laboratório: você fala os números da calibração e ele prepara o certificado para você conferir e confirmar — a média ele calcula sozinho.",
      },
    ],
  },
  {
    version: "2.6.0",
    date: "2026-11-12",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi agora ajuda a Expedição no GestorHS: recebe os aparelhos de uma caixa (abrindo as OS de uma vez), avança e fecha caixa com o rastreio, e cadastra aparelho novo — sempre com a sua confirmação.",
      },
    ],
  },
  {
    version: "2.5.1",
    date: "2026-11-11",
    changes: [
      {
        kind: "melhoria",
        text: "Pediu ao Guardi o certificado ou a proposta de uma OS? Ele agora entrega o link direto do PDF, o mesmo que vai para o TaskHS.",
      },
    ],
  },
  {
    version: "2.5.0",
    date: "2026-11-11",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi agora consulta o GestorHS: aparelhos de um cliente, OS aberta, em que caixa está, certificados e propostas — com a mesma permissão que você tem lá.",
      },
    ],
  },
  {
    version: "2.4.1",
    date: "2026-11-11",
    changes: [
      {
        kind: "correcao",
        text: "Dá para tirar reação de novo: clicar na sua reação agora a remove, no computador e no celular. Antes ela sumia e voltava em seguida.",
      },
      {
        kind: "correcao",
        text: "Documento escrito por agente mostra o nome do agente como autor em mais casos, em vez do identificador interno.",
      },
    ],
  },
  {
    version: "2.4.0",
    date: "2026-11-11",
    changes: [
      {
        kind: "novidade",
        text: "O Guardi agora consulta o DocsHS: documentos, leituras e treinamentos, com o seu acesso de lá. Ele procura por código ou título, diz a revisão vigente e o vencimento e manda o link para abrir. Só leitura: confirmar leitura e responder treinamento continuam com você.",
      },
    ],
  },
  {
    version: "2.3.1",
    date: "2026-11-11",
    changes: [
      {
        kind: "correcao",
        text: "Guardi no DataCoreHS: o estoque inteiro agora é lido, página a página. Antes ele parava por volta do 45º produto.",
      },
    ],
  },
  {
    version: "2.3.0",
    date: "2026-11-11",
    changes: [
      {
        kind: "novidade",
        text: "Guardi no DataCoreHS: pergunte sobre clientes, estoque, vendas, notas, notas de entrada, contas e inadimplência. Ele vê exatamente o que o seu login no DataCore permite.",
      },
      {
        kind: "melhoria",
        text: "Iris: inadimplência com os mesmos números da tela do DataCoreHS (até 30 dias é atraso, depois inadimplência), e a lista de inadimplentes em planilha nos Documentos.",
      },
    ],
  },
  {
    version: "2.2.0",
    date: "2026-11-10",
    changes: [
      {
        kind: "novidade",
        text: "\"O que há de novo?\": clique na versão, no rodapé do menu, para ver o que mudou no HS.OS. Quando sai versão nova, a janela abre sozinha uma vez.",
      },
      {
        kind: "novidade",
        text: "Responder uma mensagem, como no WhatsApp: pela seta da mensagem, escolha \"Responder\". A mensagem citada aparece em cima da sua resposta; no computador, clicar nela leva até a original.",
      },
      {
        kind: "novidade",
        text: "Conversa com você mesmo, fixa no topo das conversas: anote, guarde links e arquivos, como no Teams. Só você vê.",
      },
      {
        kind: "correcao",
        text: "Segurança: os agentes deixaram de ter acesso às conversas entre pessoas.",
      },
      {
        kind: "correcao",
        text: "Mensagem editada ou apagada aparece atualizada na hora para todos, sem precisar sair e voltar na conversa.",
      },
      {
        kind: "correcao",
        text: "Guardi: a primeira mensagem da conversa não leva mais as instruções de painéis HTML, que ele confundia com uma tentativa de mudar o comportamento dele.",
      },
      {
        kind: "correcao",
        text: "Conversa com agente: saiu a escolha de modelo, que não funcionava (a resposta vinha sempre do DeepSeek, mesmo com outro escolhido). O cabeçalho mostra o modelo em uso: DeepSeek.",
      },
      {
        kind: "melhoria",
        text: "Guardi no TaskHS: quando não há tarefa aberta, ele diz quantas estão em listas marcadas como \"de concluído\" no quadro, em vez de achar que a busca falhou.",
      },
      {
        kind: "melhoria",
        text: "O \"Responder em thread\" saiu para dar lugar ao Responder. As threads que já existiam continuam abrindo pelo \"respostas\" embaixo da mensagem.",
      },
    ],
  },
  {
    version: "2.1.0",
    date: "2026-11-09",
    changes: [
      {
        kind: "novidade",
        text: "Agenda e lembretes: peça ao seu Guardi \"me lembra amanhã às 9h\" e ele avisa na hora, inclusive em lembretes que se repetem. Tudo aparece na nova página Agenda.",
      },
      {
        kind: "novidade",
        text: "Os bots pessoais agora se chamam Guardi.",
      },
      {
        kind: "melhoria",
        text: "Guardi no TaskHS: põe e tira pessoas de uma tarefa e acrescenta itens a um checklist que já existe — sempre pedindo sua confirmação.",
      },
      {
        kind: "melhoria",
        text: "Guardi lê imagens e anexos que você manda na conversa e marca e-mails como lidos.",
      },
      {
        kind: "melhoria",
        text: "Calendário do Outlook disponível para o Guardi sem precisar reconectar o e-mail.",
      },
    ],
  },
  {
    version: "2.0.0",
    date: "2026-11-06",
    changes: [
      {
        kind: "novidade",
        text: "Cada colaborador ganha o seu agente pessoal, que conhece o time da empresa e guarda o que você pedir para lembrar.",
      },
      {
        kind: "novidade",
        text: "\"Meu bot\" no Perfil: escolha o nome e a foto do seu agente.",
      },
      {
        kind: "novidade",
        text: "Em piloto: o agente pessoal lê e prepara e-mails no Outlook e cria e atualiza tarefas no TaskHS. Nada sai sem você aprovar no cartão.",
      },
      {
        kind: "novidade",
        text: "Assinatura de e-mail com imagens, já preenchida com o padrão da empresa e editável no Perfil.",
      },
    ],
  },
  {
    version: "1.9.0",
    date: "2026-11-03",
    changes: [
      {
        kind: "novidade",
        text: "HS.OS no celular: instale como aplicativo, com tela própria para conversas e canais.",
      },
      {
        kind: "novidade",
        text: "Notificações no celular mesmo com o app fechado, com resposta rápida pela notificação. Menções com @Nome e @todos.",
      },
      {
        kind: "novidade",
        text: "A resposta do agente chega mesmo que você feche o app depois de perguntar.",
      },
      {
        kind: "melhoria",
        text: "Silenciar um canal: sem som e sem notificação, mas as não lidas continuam contando.",
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-10-30",
    changes: [
      {
        kind: "novidade",
        text: "Canal de avisos e \"Apagar para mim\" nas mensagens.",
      },
      {
        kind: "novidade",
        text: "Relatório de ponto do Bruce com a régua do RH, incluindo o Cálculo Diário do FLASH.",
      },
      {
        kind: "melhoria",
        text: "Lateral das conversas no estilo do WhatsApp, mensagens seguidas agrupadas e Esc fecha a conversa.",
      },
      {
        kind: "melhoria",
        text: "Foto de perfil com ajuste de corte, salva na hora e atualizada nas mensagens.",
      },
      {
        kind: "melhoria",
        text: "War Room na TV mostra quem está no HS.OS e mantém a tela acesa.",
      },
      {
        kind: "correcao",
        text: "Conta desativada não entra mais e sai dos canais e das conversas diretas.",
      },
    ],
  },
  {
    version: "1.7.0",
    date: "2026-10-16",
    changes: [
      {
        kind: "novidade",
        text: "Vistos por mensagem, como no WhatsApp: ✓ enviada, ✓✓ entregue, ✓✓ azul lida.",
      },
      {
        kind: "novidade",
        text: "Conversas anteriores com o agente: volte a uma conversa encerrada para consultar ou citar um trecho.",
      },
      {
        kind: "novidade",
        text: "Arquivos da conversa com o agente reunidos num painel.",
      },
      {
        kind: "novidade",
        text: "EscritorioHS: o escritório virtual da empresa, ligado ao HS.OS.",
      },
      {
        kind: "melhoria",
        text: "War Room em tela cheia para a TV, organizada por setor.",
      },
    ],
  },
  {
    version: "1.6.0",
    date: "2026-10-13",
    changes: [
      {
        kind: "novidade",
        text: "Entrar com a conta Microsoft da empresa.",
      },
      {
        kind: "novidade",
        text: "Resumo em áudio: o agente fala um resumo embaixo de cada resposta. Dá para desligar no Perfil.",
      },
      {
        kind: "novidade",
        text: "Grave um áudio e mande direto ao agente.",
      },
      {
        kind: "novidade",
        text: "O agente lê os anexos que você manda e devolve planilha, Word ou PDF na conversa.",
      },
      {
        kind: "melhoria",
        text: "Anexos privados, de até 100 MB: só quem participa da conversa abre.",
      },
      {
        kind: "melhoria",
        text: "Mensagens no estilo do WhatsApp: seta de opções e reações ao lado da bolha.",
      },
    ],
  },
  {
    version: "1.5.0",
    date: "2026-10-01",
    changes: [
      {
        kind: "novidade",
        text: "Lista de compradores de um produto, com planilha e link, montada pela Iris sem erro de soma.",
      },
      {
        kind: "melhoria",
        text: "Faturamento dos agentes passa a usar a mesma régua do painel do DataCoreHS.",
      },
      {
        kind: "correcao",
        text: "O chat com os agentes, que tinha parado de responder, voltou. Erros do servidor mostram uma referência curta em vez de \"não foi possível falar com o servidor\".",
      },
      {
        kind: "correcao",
        text: "A resposta do agente não sai mais colada com a anterior nem cortada no meio.",
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-03",
    changes: [
      {
        kind: "novidade",
        text: "Conversas diretas entre pessoas e canais com agentes.",
      },
      {
        kind: "novidade",
        text: "War Room de volta: o mapa ao vivo de quem está conversando com quem.",
      },
      {
        kind: "correcao",
        text: "As mensagens novas chegam na hora ao voltar para a aba, sem precisar recarregar.",
      },
      {
        kind: "correcao",
        text: "\"Parar\" interrompe o agente de verdade, não só a tela.",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-08-21",
    changes: [
      {
        kind: "novidade",
        text: "Agendamentos criados no painel do agente passam a rodar de verdade.",
      },
      {
        kind: "novidade",
        text: "Briefings da manhã em dias úteis: Operação, Faturamento, Vendedores, SDR e Serviços.",
      },
      {
        kind: "novidade",
        text: "Base de conhecimento: o agente guarda e relê documentos.",
      },
      {
        kind: "correcao",
        text: "Conversas longas não travam mais o agente por excesso de contexto.",
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-08-14",
    changes: [
      {
        kind: "novidade",
        text: "Bancos de dados como conectores: cada agente enxerga só o banco do seu assunto.",
      },
      {
        kind: "novidade",
        text: "Os agentes conversam entre si: a Nina distribui a pergunta para o especialista.",
      },
      {
        kind: "melhoria",
        text: "Mapa da frota de agentes aberto a todos, para consulta.",
      },
      {
        kind: "melhoria",
        text: "Senhas definidas pelo administrador, em conjunto com o FortiPAM.",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-08-10",
    changes: [
      {
        kind: "melhoria",
        text: "O HS.OS passa a rodar inteiro nos servidores da Health & Safety: conversas, canais, tarefas, arquivos e automações.",
      },
      {
        kind: "melhoria",
        text: "Atualização em tempo real das telas pelo nosso próprio servidor.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-08-05",
    changes: [
      {
        kind: "novidade",
        text: "Nasce o HS.OS: a central dos agentes de IA da Health & Safety, com login próprio e conversa com os agentes.",
      },
    ],
  },
];

export const VERSAO_ATUAL: string = CHANGELOG[0].version;
