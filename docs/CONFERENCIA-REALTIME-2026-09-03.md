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

- **Duas pessoas de verdade, duas janelas.** O Bruno é um script; a entrega para
  uma segunda tela aberta continua sem observação, que é a mesma lacuna que
  `CONFERENCIA-CHAT-PESSOAS.md` registrou em 02/09.
- **A conexão meio-aberta**, que é o caso do vigia de silêncio. Derrubar o
  processo do backend fecha o socket direito; o que o vigia pega é o TCP que some
  sem FIN, e isso não se reproduz matando o servidor. Continua provado só em
  teste de unidade.
- **Produção.** Nada aqui rodou lá. O observador ligado no `/ws` de produção
  ficou 57 minutos sem uma queda, o que é consistente com a cascata ser
  disparada por troca de tópico — coisa que um observador não faz.

## Notas relacionadas

- [`CONFERENCIA-CHAT-PESSOAS.md`](CONFERENCIA-CHAT-PESSOAS.md) — a medição de
  02/09 que apontou a cauda
- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado e próximos passos
