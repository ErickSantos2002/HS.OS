# Canal em que só alguns escrevem — design

30/10/2026. Pedido do Erick: o grupo de avisos do WhatsApp (só o Nicholson e o
RH mandam mensagem) pode vir para o HS.OS a qualquer momento, e é bom já estar
pronto.

## Decisões (Erick, 30/10/2026 — "WhatsApp puro")

- Um canal (público ou privado, nunca DM) pode ser marcado **"só quem eu escolher
  envia mensagens"**. Quem escolhe é o **administrador** — o mesmo que já cria
  canal de grupo.
- **Administrador sempre escreve.** Os escolhidos escrevem. O resto lê, vê o
  histórico e as threads, e só.
- **Thread fechada:** quem não escreve no canal também não responde em thread.
- **Sem @agente** para quem não escreve: acionar agente é escrever no canal.

## Onde mora

- `channels.so_alguns_escrevem boolean` — o modo.
- `channel_members.pode_escrever boolean` — quem foi escolhido. Na linha do
  membro, de propósito: tirar a pessoa do canal tira a permissão junto, sem
  lista órfã para sincronizar.
- Função `pode_escrever_no_canal(canal, usuario)` (SECURITY DEFINER), usada pela
  policy de INSERT de `channel_messages` **e** pelo backend. A trava é o banco: a
  checagem do Python só existe para a recusa sair com nome ("Só Nicholson e
  Lidisay enviam…") em vez do erro de RLS.
- Mensagem de agente é gravada como `service_role` e não passa pela policy —
  quem o acionou já foi conferido em `POST /agentes/{id}/responder`.

## Rotas

- `POST /channels` e `PATCH /channels/{id}` aceitam `so_alguns_escrevem` e
  `escritores` (ids de pessoas). Só administrador liga, desliga ou muda a lista;
  escritor precisa ser membro humano do canal.
- `GET /channels` devolve `so_alguns_escrevem`; `GET /channels/{id}/members`
  devolve `pode_escrever`.
- `POST /channels/{id}/messages`, `POST /agentes/{id}/responder` e
  `POST /notificar` recusam 403 com os nomes de quem escreve.

## Tela

- Criar/Editar canal: interruptor + escolha de quem escreve entre os membros.
- Quem não escreve vê, no lugar da caixa de texto (canal e thread): "Só X e Y
  enviam mensagens neste canal." O menu "Responder em thread" some para ele.
