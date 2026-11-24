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

Instalado e testado na VPS em 24/11 contra um repositório local: backup,
restauração e `PRAGMA integrity_check` dos 8 sqlite. **Falta só a credencial.**

## Para ligar (uma vez, Erick)

1. **Cloudflare → R2 → Create bucket**: `hsos-backup-gateway`.
2. No bucket, **Settings → Bucket lock rules**: retenção de 30 dias para os
   prefixos `gateway/data/`, `gateway/index/`, `gateway/snapshots/` e
   `gateway/keys/` — **não** em `gateway/locks/` (o restic apaga os próprios
   arquivos de trava a cada backup). É isso que impede quem invadir a VPS de
   apagar as cópias: o token do R2 não tem modo "escreve sem apagar", o
   bloqueio do bucket faz esse papel. *Conferir no painel se a regra aceita
   prefixo; se não aceitar, retenção no bucket inteiro e o restic roda com
   `--no-lock` — me chame antes.*
3. **R2 → Manage API tokens → Create**: *Object Read & Write*, **só** esse
   bucket. Guarde Access Key e Secret.
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
