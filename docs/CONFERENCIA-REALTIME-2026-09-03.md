# Conferência do tempo real, na pilha local — 03/09/2026

O conserto da cauda de entrega (`2d7f432`) foi provado por teste de unidade. Isto
aqui é o que teste de unidade não prova: a mensagem chegando na tela, num
navegador de verdade, com backend e banco de verdade.

## Como foi montado

Postgres 18 em container, banco `hsos` criado do zero com as migrações do
repositório (16 aplicáveis, zero erros — a `008` é do banco do TalentHS, ver
`backend/migrations/README.md`). Backend rodando **de fora** de `backend/`, com
`DATABASE_URL` apontando para o local: o `.env` do repositório aponta para
produção, e rodar de outro diretório garante que ele nem seja lido.

Duas contas inventadas (`ana@exemplo.com`, `bootstrap-first-admin`; `bruno@`,
criada por ela), dois canais públicos com as duas. A Ana no navegador
(Playwright); o Bruno é um script que grava pela API — é o que permite medir
"chegou sem recarregar" sem precisar de duas janelas.

⚠️ **O Chrome do usuário não alcança o loopback desta shell.** Navegar para
`localhost:8085` ou `:8002` dá página de erro enquanto o `curl` responde 200.
Por isso o teste é com Playwright, que roda no mesmo ambiente.

## O que foi medido

**1. A cascata de reconexões.** Protocolo idêntico nas duas versões: duas trocas
de canal e 60 segundos de espera, contando `WebSocket ... [accepted]` no log do
backend.

| | conexões abertas |
|---|---|
| com o conserto | **4** |
| sem o conserto | **113** |

Só de recarregar a página, a versão antiga abriu **34 conexões em 8 segundos**.

**2. Entrega, com o conserto.**

| situação | tempo até aparecer na tela |
|---|---|
| mensagem normal | **45 ms** |
| logo depois de trocar de canal | **31 ms** |

**3. Recuperação depois de queda** — backend derrubado por dois minutos, mensagem
gravada assim que ele volta, aba nunca recarregada.

| | tempo |
|---|---|
| código antigo | 33,5s |
| conserto, sem gatilho de visibilidade | 55,9s |
| conserto, com gatilho (`0879d60`) | **124 ms após voltar para a aba** |

**4. A segunda pessoa** — a lacuna que `CONFERENCIA-CHAT-PESSOAS.md` registrou em
02/09 como nunca observada.

Duas sessões no mesmo navegador, uma em cada **origem**: a Ana em
`127.0.0.1:8085` e o Bruno em `localhost:8085`. São origens diferentes para o
navegador, então cada uma tem o seu `localStorage` e o seu token — é o que
permite duas pessoas de verdade sem dois perfis de Chrome.

O Bruno gravou pela sessão dele; a mensagem apareceu na tela da Ana em **39 ms**,
**com a aba dela em segundo plano**. Aba escondida não impede entrega.

**5. A conexão aberta e morta** — o caso do vigia de silêncio, que até aqui só
tinha teste de unidade.

⚠️ **`SIGSTOP` no backend é a reprodução fiel, e matar o processo não é.** Matar
fecha o socket direito: o navegador recebe o `close` e o backoff resolve.
Congelar o processo deixa o TCP aberto e simplesmente para de mandar dados —
inclusive o ping. É a falha que deixa `readyState` em `OPEN` para sempre.

| | |
|---|---|
| socket novo criado pelo vigia | **~49s** depois do congelamento |
| sockets criados no episódio inteiro | **1** |
| entrega depois de descongelar | **16 ms** |

Os ~49s são coerentes com o limiar de 60s: o relógio começa no **último frame**,
e o último ping pode ter chegado até 25s antes do congelamento.

⚠️ **Este é o único dos cinco que não tem caso negativo.** Com o código antigo a
cascata cria sockets o tempo todo, então "apareceu um socket novo" não
distinguiria vigia de cascata. O que está provado é que o mecanismo dispara e
recupera; que a versão antiga ficava surda continua sendo leitura de código.

**6. As funções que ninguém tinha exercitado** — anexo, thread, reação, edição e
exclusão estavam na lista de "não conferido" desde 02/09.

| o que | resultado |
|---|---|
| reagir com emoji | funciona, e propaga para a outra pessoa |
| responder na conversa (thread) | funciona; a outra tela mostra "1 resposta · Nova" |
| editar | funcionava, **mas não pelo tempo real** — ver abaixo |
| apagar | **defeito**, encontrado aqui |

⚠️ **Editar e apagar não usavam o tempo real.** O backend publica quatro tipos
no tópico do canal; o front tinha um assinante e ele começava com
`if (tipo !== "mensagem") return`. `mensagem-editada` e `mensagem-removida`
chegavam e eram descartados em silêncio. O que corrigia a tela era a rede de
segurança de 60s do próprio hook, escrita no comentário como "plano B" — e ela
era o plano A desde sempre para esses dois.

O pior é o apagar, e não pelo tempo: a pessoa clica, confirma, e **a mensagem
continua na tela com o texto original**. O backend já respondeu 204 e gravou
`deleted_at`. O reflexo de quem está na frente é clicar de novo.

    edição      10,6 s  →  24 ms
    exclusão    até 60 s (a aba de quem apagou levou mais de dez minutos)  →  30 ms

⚠️ **E isto quase passou por "funciona".** A edição pareceu instantânea na
primeira observação porque eu tinha **trocado de aba** para conferir — e trocar
de aba dispara o `resync` do hook. O teste que serve é medir com um
`MutationObserver` na aba que fica parada, sem tocar nela. Conferir mexendo é
como a régua do `MESES_ANALISE`: passa e não prova nada.

Corrigido em `6540e86`. Anexo e áudio continuam sem conferir.

**7. Anexo e áudio** — o que faltava da lista de 02/09.

Anexo funciona de ponta a ponta: enviado pela tela (inclusive **sem texto**, que
é o caso do conserto de ontem), gravado em disco sob `UPLOADS_DIR`, servido com
o `Content-Type` certo, e o nome de exibição vem do registro, não da URL. Áudio
foi exercitado pelo caminho possível sem microfone — upload no bucket e mensagem
com `audio_url`: o player monta e, com arquivo inválido, diz "Não foi possível
reproduzir este áudio" em vez de falhar calado. **A gravação em si não foi
conferida.**

⚠️ **E aqui apareceu o achado de segurança do dia.** Num canal **privado**, com
uma terceira conta que não é membro:

| | |
|---|---|
| `GET /channels/<id>/messages` como não-membro | `200 []` — correto, não vaza |
| `GET /channels/<id>/arquivos` como não-membro | `200 []` — correto |
| o **arquivo**, sem token nenhum | **200, conteúdo inteiro** |

Ver a seção de segurança de [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md): o bucket é
público por dois motivos que continuam válidos, o caminho adivinhável foi
consertado (`25714e1`, `c657a6e`) e a URL permanente é decisão em aberto.

⚠️ **Quase virou um achado falso, pela segunda vez no dia.** O primeiro `200`
me pareceu vazamento até eu olhar o **corpo** e ver `[]` — e o canal do primeiro
teste ainda por cima era `public`, onde ler é o comportamento certo. Código de
status não é resposta; corpo é.

## ⚠️ O que a medição derrubou do que eu tinha escrito

O commit `2d7f432` afirma que sem ressincronizar "a tela fica com o estado de
antes e ninguém percebe". **Não foi o que aconteceu.** No caso negativo a
mensagem apareceu também, e mais rápido: 33,5s contra 55,9s.

A explicação é constrangedora e vale mais que a afirmação errada: o código antigo
se recuperava antes **porque a cascata o fazia reconectar sem parar**. Era o
defeito trabalhando a favor, ao custo de 113 conexões por minuto. E ao matá-lo eu
troquei um problema visível por um invisível — a aba passou a esperar o backoff
inteiro.

Ou seja: a ressincronização continua certa pelo princípio (não há replay de
evento perdido), mas **não é a única coisa que recupera a tela**, e este teste
não separa o efeito dela do de um refetch por outro caminho. Afirmar que era ela
teria sido conclusão sem medida — exatamente o que este repositório já catalogou
três vezes.

## O que NÃO foi conferido

- **Mais de duas pessoas, e navegador que não seja o Chromium do Playwright.**
  Nada foi visto em Firefox nem em celular.
- **O caso negativo do vigia de silêncio** — ver o ⚠️ da seção 5.
- **A gravação de áudio** (precisa de microfone) e o **GIF**. O resto do chat foi medido (seções 6 e 7).
- **Produção.** Nada aqui rodou lá. O observador ligado no `/ws` de produção
  ficou 57 minutos sem uma queda, o que é consistente com a cascata ser
  disparada por troca de tópico — coisa que um observador não faz.

## Notas relacionadas

- [`CONFERENCIA-CHAT-PESSOAS.md`](CONFERENCIA-CHAT-PESSOAS.md) — a medição de
  02/09 que apontou a cauda
- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado e próximos passos
