# PK-08 — Credenciais de conector cifradas e segredo que não cacheia falha

**Data:** 25/11/2026 · **Pacote:** PK-08 (Onda 0) · **Origem:** itens 02-32 e
02-4 da análise do remix (`~/projetos/analise-dnos-2026-11/`), conferidos em 23/11.

## Os dois defeitos

**1. Senha de banco em texto puro (02-32).** `integrations.credentials` guarda,
nas 9 linhas de produção (todas `database`), 18 valores em claro: usuário e
senha de leitura de cada banco da empresa. Quem lê a tabela lê as senhas — e
leem: o dump diário e o usuário `leitura` do cadastro (conferido em 25/11: a
consulta de contagem desta spec rodou com ele).

**2. Leitura de segredo que falha vira "não existe" por 60 s (02-4).**
`ler_segredo` (`app/integracoes.py`) engole a exceção do banco, cai para o env e
grava o resultado no cache — inclusive `None`. Com o env vazio ou divergente da
tabela, um soluço do Postgres vira um minuto de 503/401 em toda rota
`exige_segredo` (os MCP dos agentes, as pontes da VPS). Endurecimento, não
incêndio: hoje o `GUARDRAILS_API_TOKEN` também está no env.

## O conserto

### Cifra por valor, não da coluna inteira

`app/credenciais.py`, com duas funções puras:

- `fechar(estrutura)` — cifra cada `value` da lista de pares (e cada valor
  string do formato objeto, o do MCP) com a Fernet que já existe
  (`app/email/cifra.py`, `EMAIL_CHAVE_CIFRA`). O valor vira `cifra:v1:<token>`.
- `abrir(bruto)` — aceita `str` JSON ou estrutura, decifra o que tem o prefixo
  e **devolve como está o que não tem** (o legado em claro).

**Por valor**, porque a listagem de conectores tira `credential_keys` dos
*nomes* das chaves em SQL (`_COLUNAS_CONECTOR`). Cifrar a coluna inteira
esconderia os nomes, a tela abriria o formulário em branco e salvar apagaria as
chaves — o defeito que aquela consulta foi escrita para matar.

**Prefixo explícito**, porque permite a ordem segura: o código novo lê os dois
formatos, então sobe antes da migração, e a migração só roda com ele no ar.

**A mesma chave do e-mail**, porque ela já está no env de produção (o e-mail
dos bots depende dela) e a ameaça é a mesma: quem tem a tabela não tem o env.
Uma chave própria seria um passo de produção a mais sem proteger nada a mais.

**Onde entra:** `abrir` em todo lugar que lê `credentials` com valor (os
normalizadores `_pares_de_credencial` e `_token_da_integracao`, e as leituras
diretas de `registrar_integracao`, `credenciais_do_agente`, `validar_token`,
`relatorios._dsn_*`); `fechar` nos quatro que gravam (`registrar_integracao`
INSERT e UPDATE, `criar_conector`, `editar_conector`). Sem chave, gravar
credencial falha com mensagem — não grava em claro em silêncio.

**Migração de dados:** `backend/scripts/cifrar-credenciais.py` — ensaio por
padrão (conta linhas e valores, nunca imprime valor); `--aplicar` cifra numa
transação, confere que **cada** valor relido decifra para o original antes do
commit, e no fim confirma que nenhum valor sobrou sem prefixo.

### Último valor bom

`ler_segredo` passa a separar "o banco respondeu" de "o banco falhou": na
falha, usa o **último valor bom** daquele segredo (se houver) e **não grava no
cache** — a próxima chamada tenta o banco de novo. Sem valor bom anterior, cai
no env como hoje, também sem cachear.

## O que NÃO resolve (fica registrado)

- A senha continua em claro no `openclaw.json` da VPS do gateway, no cabeçalho
  `X-Banco-Url` das 9 entradas `banco-*` (PK-47). Quem tem shell lá a lê — é o
  PK-06 (exec fora do root) que fecha essa porta.
- `sslmode=disable` nos bancos de IP público: assunto do lado dos bancos.
- `key_preview` continua com os 4 últimos caracteres — é máscara, de propósito.

## Produção, nesta ordem

1. Deploy (lê os dois formatos; grava cifrado).
2. `cifrar-credenciais.py` (ensaio, depois `--aplicar`), com o venv do backend
   e o perfil admin do cadastro.
3. Conferir o efeito: nenhum valor sem prefixo no banco, `testar-banco` de um
   conector responde, e o relatório do HSGrowth (`_dsn_hsgrowth`) gera.
