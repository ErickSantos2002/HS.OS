# Aviso de pedido de ausência no Guardi do RH — design

Data: 26/11/2026 · pedido do Erick, para a Lidisay (RH)

## Por quê

A Lidisay controla os pedidos de ausência no TalentHS, mas são sistemas demais
para ela ficar olhando cada um. Hoje um pedido pode esperar dias porque ninguém
abriu a tela (há um pendente desde 26/11 08:01). O que ela quer: **ser avisada
na conversa com o Guardi dela (`lidisay-bot`, Alfred-Guardi) e aprovar ou
recusar ali mesmo, pelo cartão.**

## Objetivos

- Pedido de ausência **pendente** novo no TalentHS → em até ~2 min aparece na
  conversa da Lidisay com o Guardi: um recado com quem, tipo, datas, dias e
  motivo, e dois cartões, **Aprovar** e **Recusar**.
- O clique executa no TalentHS como ela, pelo caminho que já existe
  (`talenths_aprovar_ausencia` / `talenths_recusar_ausencia`).
- Nada se perde se o HS.OS ou o TalentHS caírem: o pedido continua pendente lá
  e é avisado quando voltar.

## Não-objetivos

- Mexer no TalentHS (nenhum webhook, nenhum deploy lá).
- Avisar quem pediu sobre a decisão (o TalentHS já mostra na tela dele).
- Pedidos auto-aprovados (tipo sem `requires_approval`) — não há o que decidir.
- Outros fluxos de aprovação do RH (ajuste de ponto etc.) — mesmo molde, depois.

## Anti-objetivos

- Avisar duas vezes o mesmo pedido (são 2 workers).
- Gastar turno de LLM por aviso.
- Cartão que aprova algo diferente do que o recado mostrou.

## Abordagens consideradas

| | troca | escolha |
|---|---|---|
| **A. HS.OS confere a cada 2 min** (`/absences/team/pending` como o RH) | atraso de até 2 min; zero mudança no TalentHS; autocura | ✅ escolhida |
| B. Webhook do TalentHS | instantâneo, mas exige sessão e deploy lá, e aviso perdido se a chamada falhar — precisaria do A de rede de segurança | ✗ |
| **X. Servidor monta o recado e os cartões** (`talenths_preparo.preparar` + `acoes.criar_pendente`) | determinístico, sem token; recusa com motivo é conversando com o Guardi | ✅ escolhida |
| Y. Turno do Guardi preparando os cartões | conversado, mas custa um turno por aviso e depende do agente chamar a ferramenta | ✗ |

Escolha do Erick em 26/11/2026: **A + X**.

## Desenho

**Etapa nova na `passada` do `disparador_lembretes`**, igual à varredura
(`_avisos_ausencia`, isolada: exceção não sobe, tabela ausente só avisa uma vez
no log). Porta única preservada — nenhum laço paralelo, nenhum `chat.send`.

1. **Quem recebe:** `app_settings` chave `avisos_ausencia` =
   `{ligado: bool, destinatarios: [user_id do HS.OS]}`. Ausente = desligado.
   Para cada destinatário: o Guardi dele (`agent_profiles.dono_id`), que precisa
   ter `talenths` em `sistemas_ligados`; senão pula e registra no log.
2. **Ritmo:** no máximo uma leitura a cada 120 s por worker (relógio em memória).
3. **Leitura:** `talenths.chamar(email, bot, "/absences/team/pending", dono=…)`
   — só GET, como o destinatário.
4. **Deduplicação:** tabela nova `avisos_ausencia` (migração `044`):
   `(destinatario_id, pedido_id)` chave primária, `avisado_em`,
   `ultimo_aviso_em`. Para cada pedido pendente sem linha: `INSERT … ON CONFLICT
   DO NOTHING RETURNING` — **quem inserir é quem avisa**, na mesma transação do
   recado e dos cartões. O outro worker não vê retorno e segue.
5. **Recado + cartões**, na mesma transação:
   - mensagem do agente: `📅 Pedido de ausência — Fulano (Depto): Férias,
     02/12 a 06/12 (5 dias). Motivo: …` (campos saneados, teto de tamanho);
   - dois cartões via `preparar(ctx, bot, {acao: "aprovar_ausencia", ids:[id]})`
     e `{acao: "recusar_ausencia", ids:[id]}` → `criar_pendente`. O `preparar`
     relê o pedido e confere `pending`; o executor confere de novo no clique.
6. **Pedido do próprio destinatário** (e-mail igual ao dele): não avisa — ele
   não aprova o próprio pedido pelo Guardi.

## Decisões minhas (revisáveis)

- **Primeira ativação avisa o que já está pendente** (inclusive o de 26/11):
  é justamente o que ela não viu.
- **Cartão vence em 24 h** (`VALIDADE` das ações). Se vencer e o pedido seguir
  pendente, **um novo aviso por dia** (compare-and-set em `ultimo_aviso_em`; até o pedido sair
  de `pending`). Sem isso, pedido esquecido some de novo.
- **Clicar Recusar depois de Aprovar** (ou vice-versa) falha com a mensagem que
  já existe ("já não está pendente: está aprovado") — não cancelo o cartão
  irmão, para não mexer no executor genérico.
- **Sem horário de silêncio**: pedidos são raros (3 no banco inteiro).
- **Pedido editado** enquanto pendente: o `_marca` do cartão segura (executor
  compara datas); o aviso não se repete.
- **Ligar** com um script `scripts/avisos-ausencia.py --ligar <email> --aplicar`
  (ensaio sem `--aplicar`), no molde do `varredura-agora.py`.

## Restrições

- Migração aplicada **antes** do deploy (regra do repo); script admin com o
  venv do cadastro, conferindo o efeito.
- Changelog obrigatório (minor: novidade).
- Suíte do backend verde; testes no estilo do repo (docstring com o custo).

## Para o construtor

Formato exato do recado, nome dos helpers, onde mora a lógica pura (sugestão:
`app/avisos_ausencia.py` com a decisão pura testada e a etapa fina no
disparador). Push: as 3 mensagens saem com `tag: agente:<bot>` e o service
worker as junta numa notificação só — conferido em `push_regras.py`.

## Revisão 26/11/2026 — um cartão só, com Recusar e Aprovar

O Erick viu os dois cartões (cada um com Cancelar/Confirmar: quatro botões para uma
decisão) e pediu um só. **Escolhido:** continuam as DUAS ações preparadas, ligadas
por `acoes_pendentes.par_id` (`045`), mostradas numa mensagem só com os botões
**Recusar** e **Aprovar**. Confirmar uma cancela a outra na mesma transação, com as
duas linhas travadas em ordem de id (sem deadlock com dois cliques). Rejeitado:
uma ação "decidir" que recebe a escolha no clique — quebraria a regra de que o clique
executa só o payload gravado, sem argumento novo.

- `acoes.criar_par(...)` grava as duas pendências e UMA mensagem com
  `media: [{type: "acao_aprovacao", id, rotulo, par: {id, rotulo}}]`.
- `/acoes/{id}/confirmar` com par: a outra já decidida → 409 ("a outra opção já foi
  escolhida"); sucesso → a outra vira `cancelada`. Falha do executor → só a escolhida
  vira `erro`.
- `CartaoAcao` com `par`: um cabeçalho, os campos da principal, e os dois botões;
  decidido, mostra qual foi.

## Revisão 26/11/2026 (tarde) — a resposta volta para quem pediu

Duas ausências foram recusadas com motivo e as pessoas só souberam porque a Lidisay
mandou olharem o TalentHS. Pedido do Erick: quando o RH aprova ou recusa, quem pediu
recebe na hora, pelo próprio Guardi — o espelho do aviso que a Lidisay recebe.

- **Mesma etapa, mesma leitura:** o `/absences/team` que a etapa já lê como o RH traz
  todos os pedidos com `status`, `review_note`, `reviewer_name`, `reviewed_at`. Nenhuma
  chamada nova. Pega a decisão tomada pelo cartão do HS.OS ou direto no TalentHS.
- **Só decisões depois de ligar:** `avisos_ausencia.decisoes_desde` (ISO). Decisão com
  `reviewed_at` anterior não sai — ligar não pode disparar o histórico para a empresa.
  Ausente = esta parte desligada. Aprovação automática (`auto_approved`) não avisa.
- **Para quem:** o Guardi do dono cujo e-mail é o `user_email` do pedido. Sem Guardi
  no HS.OS, não avisa. Recado sem cartão, com push: "✅ Sua ausência foi aprovada —
  …" / "❌ Sua ausência foi recusada — … Motivo da recusa: …".
- **Um aviso por pedido:** `avisos_decisao_ausencia` (`046`), PK `pedido_id` —
  dois workers e dois RH lendo a mesma lista não dobram.
