# HS.OS — riscos e plano de emergência

> Escrito em 26/11/2026 (PK-10, item 02-37 da análise do remix do DN.OS),
> depois de o backup do gateway estar ligado e conferido — antes disso, o
> roteiro de "VPS perdida" descreveria uma restauração que não existia.
> Serve para duas perguntas: **o que proteger primeiro** e **o que fazer
> quando cair**. Estado conferido nas duas VPS em 26/11.
>
> ⚠️ Repositório público: aqui não entra senha, token nem chave. Credenciais
> de recuperação estão no **FortiPAM** — cada roteiro diz qual procurar.

## 1. Mapa — se X cair, o que acontece

| Peça | Se cair | Proteção hoje |
|---|---|---|
| **VPS da aplicação** (`62.72.11.28`, EasyPanel) — API, front, Postgres `hsos` e os bancos dos outros sistemas | O HS.OS inteiro para: login, chat, canais, agenda. Os agentes não recebem mais nada. | `pg_dump` diário **na mesma máquina** — ver R1 e R2. Snapshot da Hostinger: **conferir no hPanel**. |
| **Postgres `hsos`** (serviço `erick_hsos-banco`) | Igual à linha acima: o backend responde 500 em quase tudo. | Dump diário às 03:20 com prova de restauração na instalação, 14 dias. |
| **VPS do gateway** (`2.24.85.122`) — OpenClaw, `banco-mcp`, `mcp-ponte`, Caddy | Agentes mudos. O chat abre, a mensagem grava, a resposta não vem. | `restic` cifrado no R2 às 03:30, com bloqueio de 30 dias contra apagar (`vps-gateway/backup/`). Snapshot semanal da Hostinger. |
| **OpenClaw** (`openclaw-gateway`, unidade **de usuário** do systemd) | Agentes mudos; reiniciar mata toda resposta em andamento. | systemd religa. Reinício pela tela confere antes se há resposta em voo (`POST /gateway/manutencao/restart`). |
| **Túnel SSH** (`openclaw-tunnel`, roda na VPS da aplicação) | A API não alcança o gateway: a tela diz "Não foi possível falar com o servidor". | `Restart=always`. Sem ele não há scopes — o domínio público não serve de reserva (ver `DEPLOY.md`). |
| **`mcp-ponte`** (loopback `:18791`) | Os agentes perdem todas as ferramentas `hsos-*`: anexos, e-mail, relatórios, agenda. | systemd. Volta à API direta: `scripts/trocar-mcp-ponte.py --voltar`. |
| **`banco-mcp`** (loopback `:18790`) | Os agentes perdem a consulta aos bancos (DataCore, TaskHS…). | systemd. Volta às entradas `npx` do backup: `scripts/trocar-banco-mcp.py --voltar` (é o formato que dava OOM). |
| **DeepSeek** | **Todos** os agentes param: é o único provedor em uso, sem modelo reserva (decisão 04-7). Saldo pré-pago. | Nenhuma ainda — o alerta de saldo é o **PK-13**. |
| **Cloudflare R2** (`hsos-arquivos`) | Anexo, avatar e arquivo não abrem e não sobem. O chat em texto segue. | Gerenciado pela Cloudflare. |
| **Microsoft Entra** (SSO) | Administrador não entra: desde o PK-04, admin só entra pelo "Entrar com Microsoft". O colaborador ainda entra por senha. | Porta de emergência `LOGIN_SENHA_ADMIN_EMERGENCIA`. O client secret **vence** (24 meses). |
| **Sistemas que os agentes leem** (DataCore, TaskHS, HSGrowth, GestorHS…) | O agente daquele assunto responde sem dado ou com dado velho — o Midas, por exemplo, fica sem número. | Cada um com seu backup; fora deste documento. |
| **EasyPanel** | Não dá para fazer deploy; o que está no ar continua. | Código no GitHub. |

## 2. Os riscos, em ordem

### R1 — Coisa que quebra em silêncio (crítico — já custou caro)
O padrão mais caro deste sistema, e ele voltou em 26/11: **o backup do banco
estava falhando todo dia desde 08/09/2026** (o último dump bom é de 07/09).
Eram duas causas em fila: primeiro, o script escolhia o container por "tem
`postgres` no nome", e o primeiro da lista virou um `pgweb`. Depois, mesmo no
container certo, faltava permissão de leitura numa sequence criada por
migração. Cada falha deixava um arquivo de 0 byte, que na listagem parecia
backup. Foram **80 dias** sem cópia do banco, e nada avisou.

Os outros casos da mesma família: chat quebrado por duas semanas (18/09,
coluna que ninguém criou), push do alerta que nunca funcionou (26/08) e os
timeouts dos MCP na rajada da manhã (26/11). Todos foram achados por
investigação, nenhum por alarme. **Nenhum dos dois backups avisa quando falha.**

### R2 — Banco sem cópia fora da máquina (crítico)
Os dumps do `hsos` ficam em `/var/backups/hsos`, **na mesma VPS do banco**.
Protegem contra migração ruim, `DELETE` sem `WHERE` e bug. Perder a máquina
leva banco e dumps juntos. Ela também hospeda os bancos dos outros sistemas.

### R3 — Um provedor de LLM só (alto)
Todos os agentes usam `deepseek/deepseek-chat`, e não há reserva por decisão
(04-7). Saldo zerado ou instabilidade do provedor = empresa sem agentes, e hoje
a tela não diz por quê (PK-13).

### R4 — Uma pessoa só opera (alto)
VPS, gateway, EasyPanel, migração e deploy: o Erick, com o Claude. As
credenciais estão no FortiPAM, mas **ninguém mais tem o roteiro na cabeça**. Este
documento é o primeiro passo; o segundo é alguém além do Erick conseguir
seguir o §3 com o acesso do cofre.

### R5 — Deploy sobe código, não schema (médio)
Nada aplica migração sozinho. Código que espera coluna nova quebra **só na rota
que a usa**, e só quando alguém a usa (18/09). Regra: migração **antes** do
deploy, e conferida contra o banco, não contra a pasta.

### R6 — Gateway com pouca folga de memória (médio)
O processo do OpenClaw anda em 1,2–1,5 GiB com aviso de `memory pressure` a
cada 5 min. O OOM que matava processos parou em 23/11 (PK-47 + swap de 2 GB).
A fila de 6 execuções (PK-12) e qualquer servidor MCP novo pesam aqui.
**Medir antes de subir mais.**

### R7 — Fornecedor que muda sem avisar (médio)
O OpenClaw já trocou REST por WebSocket e removeu `/v1/chat/completions`. Ele
tem prazos internos que só se descobrem lendo o código (os 1,5 s do
`tools/list`). O firewall que vale é o do hPanel, não o da máquina. Atualizar o
OpenClaw é mudança de risco: só com backup do dia e janela.

## 3. Roteiros — o que fazer quando cair

Sempre **primeiro o status real**, não o texto da tela: F12 → Network. A frase
"Não foi possível falar com o servidor" cobre backend fora, gateway fora e
exceção na rota (ver `CLAUDE.md`).

### Agentes não respondem
1. `curl -s https://hsosapi.healthsafetytech.com/health` — a API está de pé e
   em que versão?
2. Na VPS do gateway: `XDG_RUNTIME_DIR=/run/user/0 systemctl --user status
   openclaw-gateway` e `systemctl status banco-mcp mcp-ponte`.
3. Na VPS da aplicação: `systemctl status openclaw-tunnel`. Caído → `systemctl
   restart openclaw-tunnel`.
4. Gateway travado: reiniciar **pela tela** (`/monitoring` → aba Gateway), que
   recusa se houver resposta em andamento e diz de quem. Pela máquina, só se a
   tela não alcançar: `XDG_RUNTIME_DIR=/run/user/0 systemctl --user restart
   openclaw-gateway`, sabendo que isso mata o que estiver em voo.
5. Tudo de pé e o agente mudo: o log do dia (`/tmp/openclaw/openclaw-AAAA-MM-DD.log`)
   procurando `billing`, `402`, `rate limit` — é o saldo do DeepSeek (abaixo).

### Saldo do DeepSeek zerado
Recarregar no painel da DeepSeek. A credencial da conta está no FortiPAM. Não
há reserva automática; trocar o modelo de todos os agentes à mão é último
recurso e exige reinício (ver `docs/claude/gateway-operacao.md`, `models.json`).

### Agentes sem ferramenta ("não tenho acesso a…")
1. Log do gateway: `failed to start server "<nome>"`. Se for `Request timed out`
   em massa, conferir se as entradas têm `requestTimeoutMs`
   (`scripts/prazo-catalogo-mcp.py`, que é só ensaio sem `--aplicar`).
2. `curl -s 127.0.0.1:18791/saude` na VPS do gateway. A ponte caída sem
   conserto rápido → `scripts/trocar-mcp-ponte.py --voltar`.

### Deploy ruim
1. O push não faz deploy; o deploy é manual no EasyPanel. Para voltar:
   `git revert` do commit ruim → `git push` → deploy de novo. O banco não muda
   com deploy.
2. Conferir pelo `/health` que a `versao` no ar é a esperada.

### Migração esquecida ou ruim
1. Esquecida: sintoma é 500 com `column/relation ... does not exist` no log da
   API. Aplicar com `~/aplicar-hsos-NNN.py` (o Claude roda; ele lê o perfil
   admin sozinho) e conferir com a consulta que falhava.
2. Ruim: a volta é uma migração nova que desfaz. Dado perdido só volta do dump
   (abaixo) — e **perde tudo desde as 03:20 do dia**.

### Banco corrompido ou dado apagado
Na VPS da aplicação, com o dump do dia certo:

```bash
CID=$(docker ps -q --filter label=com.docker.swarm.service.name=erick_hsos-banco)
ls -la /var/backups/hsos/            # dump de 0 byte NÃO é backup
docker exec -i $CID sh -c 'pg_restore -U $POSTGRES_USER -d hsos --clean --if-exists' \
  < /var/backups/hsos/hsos-<data>.dump
```

Prefira restaurar antes num banco descartável e copiar só o que se perdeu —
`scripts/instalar-backup.sh` mostra como (seção 5).

### VPS do gateway perdida
Os passos estão em `vps-gateway/backup/README.md` → "Restaurar a máquina". Em
resumo: VPS nova → OpenClaw **na mesma versão** (`openclaw --version`; em 26/11,
`2026.7.1-2`) → `restic restore latest --target /` com a senha do restic e a
chave R2 do FortiPAM → devolver os sqlite do estágio → subir o gateway →
reinstalar `banco-mcp`, `mcp-ponte` e o próprio backup (`vps-gateway/*/instalar.sh`)
→ apontar o túnel para o IP novo (`scripts/tunel-openclaw.sh`) e liberar as
portas no hPanel. O pior caso é perder **um dia** de memória dos agentes. Em
alternativa, o snapshot semanal da Hostinger perde até uma semana.

### VPS da aplicação perdida
**Hoje não há plano completo** — é o R2. O que existe: o snapshot da Hostinger
(a conferir) e o código no GitHub. Com os dumps fora da máquina (§4, item 2), o
roteiro passa a ser: VPS nova → EasyPanel → serviços pelo `DEPLOY.md` →
Postgres novo → `pg_restore` do último dump → túnel → DNS.

### Administrador não consegue entrar
1. "Entrar com Microsoft" falhando com `erro_sso=falha_microsoft` e 401 na
   troca do code: o **client secret venceu** — gerar outro no Entra e trocar
   `MS_CLIENT_SECRET` no EasyPanel.
2. Entra fora do ar: `LOGIN_SENHA_ADMIN_EMERGENCIA=true` no EasyPanel →
   deploy → entrar com a senha de emergência do FortiPAM → **desligar de novo**
   assim que o SSO voltar.

### Erick indisponível
Quem tem acesso ao FortiPAM segue este documento. O mínimo para manter de pé:
acesso SSH às duas VPS, conta do EasyPanel, painel da DeepSeek e hPanel. Sem
alguém treinado nisso, a resposta honesta é "os agentes param até ele voltar"
— por isso o R4 está em alto.

## 4. O que fazer, em ordem

1. **Alarme quando backup falha** (R1). Os dois timers (`hsos-backup` e
   `backup-openclaw`) avisando o administrador pelo sininho em caso de falha,
   e uma conferência diária de "o último backup tem menos de 26 h e mais de
   50 KB". Um backup que falha calado é o que acabou de acontecer.
2. **Dumps do banco para fora da máquina** (R2): mesmo bucket do gateway, outro
   prefixo, com o mesmo bloqueio de 30 dias, e teste de restauração.
3. **PK-13 — saldo e motivo na tela** (R3): o agente que falha por saldo diz
   isso, e o administrador é avisado antes de zerar.
4. **Confirmar o snapshot da Hostinger da VPS da aplicação** no hPanel.
5. **Uma segunda pessoa** que tenha lido o §3 e testado um roteiro com o
   acesso do cofre (R4).
6. **Restaurar de verdade uma vez por trimestre**, das duas camadas — o
   `--testar` do gateway e um `pg_restore` num banco descartável do dump mais
   recente. Junto com a poda trimestral do `restic`.
