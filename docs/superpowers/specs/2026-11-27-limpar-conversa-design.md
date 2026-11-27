# Limpar conversa — design curto (27/11/2026)

Pedido de quem usa as DMs: limpar a conversa inteira, em vez de apagar
mensagem por mensagem. Decisões do Erick (27/11): **só para quem limpou**
(como o WhatsApp — o outro lado continua com o histórico) e **em DMs e grupos**
(não na conversa pessoal nem com agente).

## Abordagens

- **Esconder tudo em `mensagens_ocultas` (escolhida).** É o "Apagar para mim"
  (022) em lote. A lista, as threads, os arquivos, as prévias e a busca já
  filtram essa tabela — nenhuma leitura precisa mudar, nem migração: a coluna
  `criado_em` (mesmo `now()` da transação) identifica o lote para o Desfazer.
- **Marco por membro (`channel_members.limpo_em`).** Uma linha só, mas cada
  leitura que hoje usa `_VISIVEL_PARA_MIM` teria que ganhar mais um filtro —
  e esquecer um é mensagem limpa reaparecendo. Rejeitada.

## Como funciona

- `POST /channels/{id}/limpar` → esconde para quem pede toda mensagem do canal
  (nível de cima **e** respostas de thread) que ela enxerga e ainda não
  escondeu; marca como lidas as notificações do canal dela. Recusa (404) canal
  que não seja `dm`/`public`/`private` ou em que não é membro humano. Devolve
  `{limpo_em, quantas}`.
- `POST /channels/{id}/limpar/desfazer {limpo_em}` → apaga as linhas daquele
  lote (mesmo `criado_em`, mesmo canal, dela — RLS da 022).
- Front: item **"Limpar conversa"** no menu ˅ / clique direito da lista
  (`MenuDaConversa`, prop `limpavel`) e na folha de segurar do celular
  (`TelaInicio`). Confirmação antes ("As mensagens somem só para você. {Nome}
  continua vendo."). Depois, aviso com **Desfazer**. Um evento de janela
  (`hsos:conversa-limpa`) faz a conversa aberta (`useChannelMessages`) esvaziar
  e recarregar e a lista do celular refazer as prévias.
- Changelog `novidade`.

## Não-objetivos

Apagar para os dois; limpar conversa com agente (já existe "Nova conversa");
limpar a conversa pessoal.
