# Backup da VPS do gateway (PK-10)

Antes disto a VPS do gateway (`2.24.85.122`) **não tinha backup nenhum**:
perder a máquina apagava memória, workspace e config de 29 agentes. Agora:
snapshot diário, **cifrado** (`restic`), no R2, às 03:30 BRT.

| | |
|---|---|
| entra | `/root/.openclaw` (workspaces, transcrições `.jsonl`, `openclaw.json`, `state`), cópia consistente dos 8 sqlite, units do systemd, Caddyfile |
| fica de fora | trajetórias (1,1 GB de depuração), sessões apagadas, cache, logs, `node_modules`, `.bak*` |
| tamanho | 124 MB lidos → **~21 MB** no 1º snapshot; incremental ~2 MB/dia |
| custo | R2: 10 GB grátis/mês; isto fica em centenas de MB |
| tempo / RAM | ~2 s, ~80 MB (medido em 24/11) |

**Ligado em 24/11/2026, 15:27 BRT:** 1º snapshot no bucket `hsos-backup-gateway`,
`--testar` com 11 ✅. A proteção foi provada: a chave da VPS gravou
`gateway/config-teste-bloqueio` e, ao tentar apagá-lo, recebeu `409
ObjectLockedByBucketPolicy` (o objeto de 23 bytes fica lá até 24/12 — é o
próprio bloqueio; o restic não o lê). Credenciais e senha no FortiPAM.

## Para ligar (uma vez, Erick)

1. **Cloudflare → R2 → Create bucket**: `hsos-backup-gateway`.
2. No bucket, **Configurações → Regras de bloqueio do bucket**: 5 regras de
   30 dias, uma por prefixo — `gateway/data/`, `gateway/index/`,
   `gateway/snapshots/`, `gateway/keys/` e `gateway/config` (sem barra).
   **Nenhuma** sem prefixo nem em `gateway/locks/`: o restic apaga os próprios
   arquivos de trava a cada backup. É o bloqueio que impede quem invadir a VPS
   de apagar as cópias — o token do R2 não tem modo "escreve sem apagar".
   (Prefixo por regra confirmado na documentação da Cloudflare em 24/11;
   objeto bloqueado não pode ser apagado nem sobrescrito, nem por lifecycle.)
3. **R2 → Gerenciar tokens de API → token de CONTA**: *Leitura e gravação de
   objeto*, **só** esse bucket, TTL para sempre. Access Key e Secret vão para
   o FortiPAM (aparecem uma vez).
4. Gere uma senha forte para o restic e **guarde no FortiPAM** — sem ela, o
   backup não abre.
5. No Konsole: `bash ~/github/HS.OS/vps-gateway/backup/configurar.sh`. Ele
   cria o repositório, faz o 1º backup e roda o teste de restauração.

## Operar

```bash
ssh root@2.24.85.122 '/opt/backup-openclaw/backup-openclaw.sh --testar'   # restauração de teste
ssh root@2.24.85.122 'journalctl -u backup-openclaw -n 20 -o cat'         # última execução
```

`--testar` restaura `openclaw.json`, o workspace do Midas e os sqlite numa
pasta temporária e confere cada um; **sai com erro se qualquer um falhar** (a
primeira versão passava em silêncio com zero sqlite — e havia zero, por um
`--exclude` largo demais).

**Poda** (`restic forget --prune`) não roda da VPS, de propósito: a chave de
lá não deveria poder apagar. Uma vez por trimestre, da máquina do Erick, com
um token de administrador do bucket.

**Restaurar a máquina** (resumo, até o plano de emergência existir): VPS nova
→ instalar OpenClaw na mesma versão → `restic restore latest --target /` com a
senha do FortiPAM → devolver os sqlite do `/root/.backup-openclaw-estagio` aos
caminhos originais em `/root/.openclaw` → `systemctl --user start
openclaw-gateway`.
