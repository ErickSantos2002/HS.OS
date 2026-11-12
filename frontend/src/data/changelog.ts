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
