# PK-10 — Backup da VPS do gateway e reinício seguro

**Data:** 24/11/2026 · **Pacote:** PK-10 (Onda 0) · **Itens:** 02-38, 07-28
(02-37, o plano de emergência, fica para depois do backup ligado — escrito
antes, descreveria uma restauração que não existe).

## Reinício seguro (07-28) — no ar com o deploy

`POST /gateway/manutencao/restart` confere antes se há resposta em andamento
(regra do `SQL_FECHAR` da varredura: sem `message_id`, sem
`coleta_encerrada_em`, < 15 min) e recusa dizendo quem; `?forcar=true` passa
por cima. A tela já mostra o `error` de `success: false`. Teste:
`test_reinicio_seguro.py`; consulta conferida contra o banco real.

## Backup (02-38) — instalado, falta a credencial

`vps-gateway/backup/`: `restic` cifrado para um bucket R2 próprio, diário às
03:30 BRT, com cópia consistente dos sqlite (API de backup do SQLite) e teste
de restauração estrito. Medido: 124 MB → 21 MB, 2 s, 80 MB de RAM.

Dois defeitos achados testando, ambos do tipo "passa em silêncio":
1. a conferência `cmd && echo ✅` não falhava o script;
2. com ela estrita, apareceu que **nenhum sqlite entrava** — o
   `--exclude '*.sqlite'` dos bancos vivos pegava também as cópias seguras.

O timer está ligado com `ConditionPathExists` na credencial: até o Erick
rodar o `configurar.sh`, pula sem erro. Passos da Cloudflare no README.

Fora daqui: cópia dos dumps do banco (VPS dos bancos) para fora da máquina —
mesmo bucket, outro prefixo, quando este estiver de pé.
