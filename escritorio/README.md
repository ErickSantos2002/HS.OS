# Escritório virtual (WorkAdventure)

Spec: `docs/superpowers/specs/2026-10-15-escritorio-virtual-design.md`.
Plano: `docs/superpowers/plans/2026-10-15-escritorio-virtual-a.md`.

## Validações de 15/10/2026

| pergunta | resposta | como foi medido |
|---|---|---|
| UDP 50000–50100, 3478, 49160–49200 chegam de fora? | **sim, depois de abrir no firewall da Hostinger** | `tcpdump -ni eth0` na VPS, pacotes da rede da HS e da VPS do OpenClaw |
| TCP 7881 e 3478 chegam de fora? | sim (regras `Any` no firewall da Hostinger) | idem |
| Domínio do EasyPanel → serviço Compose? | sim | `curl https://escritorio.healthsafetytech.com/` devolveu `borda-ok` |
| Container do Compose → host? | sim, por `172.18.0.1` **e** por `host-gateway` | `curl` em `/host/` e `/gw/` devolveram `host-ok` |

⚠️ **O firewall que importa é o do painel da Hostinger, não o da máquina.** Na
VPS o `ufw` está inativo e o `INPUT` é `ACCEPT`; quem bloqueava o UDP era o
firewall do hPanel (VPS → Segurança → Firewall), que termina em `Drop Any`.
O `tcpdump` não via o pacote chegar na `eth0` — é assim que se distingue.

⚠️ **Testar porta a partir do escritório engana.** O firewall da Hostinger
libera **todo o TCP** para quatro IPs, e o do escritório (`187.21.12.34`) é um
deles: o TCP 7881 "passou" no primeiro teste só por isso. Para quem está em
casa ou no 4G ele estava fechado. Conferir porta sempre de um IP fora dessa
lista, ou pela regra no painel.

Regras de entrada abertas para o escritório (fonte `Any`), acima do `Drop`:

| protocolo | porta | para quê |
|---|---|---|
| UDP | 50000:50100 | mídia do LiveKit |
| UDP | 3478 | Coturn |
| TCP | 3478 | Coturn, recuo |
| UDP | 49160:49200 | relay do Coturn |
| TCP | 7881 | LiveKit, recuo |

⚠️ **`createComposeService` do MCP do EasyPanel com `source` e `domains` na
mesma chamada falha** (`ENOENT … docker-compose.override.yml`) e deixa o serviço
criado pela metade, com o domínio já reservado. O que funciona: criar, depois
`updateComposeSourceInline` (ou `updateComposeSourceGit`) e
`deployComposeService` — os dois exigem `execute_destructive`.
