# PK-04 — Administrador só pelo SSO Microsoft e limite de tentativas no login

**Data:** 25/11/2026 · **Pacote:** PK-04 (Onda 0) · **Origem:** itens 02-24 e 02-11
da análise do remix. **Decisão do Erick (23/11):** admin entra só pelo SSO
Microsoft, com o MFA cobrado pelo Entra; `/auth/login` recusa `administrador`;
a senha do admin no FortiPAM fica só para emergência; limite de tentativas; sem
TOTP próprio.

## Hoje

- `POST /auth/login` não tem limite nem bloqueio; o repositório é público e é a
  única porta anônima com senha. O "bloqueio" da tela de login é um contador no
  React — some ao recarregar.
- Senha certa de `administrador` abre tudo o que o admin abre: credenciais de
  conector, publicação de banco para agente, gateway.
- E-mail inexistente responde **mais rápido** (pula o bcrypt): dá para
  enumerar contas pelo tempo.
- O `JOIN user_roles` do login não ordena: com duas linhas de papel, vale uma
  qualquer. O SSO já ordenava (`_CONTA` em `app/auth/sso.py`).
- SSO no ar (`/auth/sso/status` → `ativo: true`). Medido em 25/11: **um**
  administrador (o Erick), e-mail `@healthsafetytech.com`.

## O conserto

**Admin fora do login por senha.** Senha certa + papel `administrador` → 403
"Administrador entra pelo botão Entrar com Microsoft". A recusa vem **depois**
de conferir a senha: com senha errada a resposta é o 401 de sempre, então o 403
não revela quem é admin a quem não sabe a senha. O papel passa a ser o mais
forte, com a mesma ordenação do SSO.

**Emergência:** `LOGIN_SENHA_ADMIN_EMERGENCIA=true` no ambiente do backend
(EasyPanel) reabre a senha para o admin, com `logger.warning` a cada entrada.
Ligar exige acesso ao EasyPanel, que já é um segundo fator. Serve para o dia em
que o SSO cair (segredo do app vencido no Entra, tenant fora).

**Limite de tentativas no Postgres** (`login_tentativas`, migração 041) — no
banco porque o backend roda com dois workers. Só **falhas** contam, numa
janela de 15 min:

- 5 por **e-mail** → 429 até a janela andar. Bloqueia só a senha: quem tem
  conta Microsoft continua entrando pelo SSO, então trancar alguém de propósito
  não tranca de verdade.
- 30 por **IP** → 429 (vários e-mails de uma mesma origem). Alto o bastante
  para o escritório inteiro, que sai por um IP só.
- Acertar a senha apaga as falhas daquele e-mail.
- Guarda o **sha256** do e-mail e do IP, nunca o valor: o usuário `leitura`
  enxerga as tabelas.
- O IP vem do `X-Forwarded-For` (o uvicorn passa a aceitá-lo com
  `--forwarded-allow-ips '*'`); se ele for forjado, sobra o limite por e-mail.

**Tempo igual** para e-mail inexistente: confere a senha contra um hash falso.

**Front:** 429 e 403 mostram a mensagem do servidor e não alimentam o contador
local.

## Fora do HS.OS (passo do Erick)

O MFA é cobrado pelo Entra. Conferir no tenant que a conta do admin exige MFA
(Security Defaults ou acesso condicional). O HS.OS não enxerga isso.

## Produção

1. `~/aplicar-hsos-041.py` (eu rodo) **antes** do deploy: sem a tabela, todo login
   por senha dá 500.
2. Deploy.
3. Conferir: login por senha do admin → 403; 6 senhas erradas num e-mail de teste
   inexistente → a 6ª é 429; SSO do admin entra.
