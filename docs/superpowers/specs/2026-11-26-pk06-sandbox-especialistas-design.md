# PK-06 — `exec` da nina e do atlas fora do root

**Data:** 26/11/2026 · **Pacote:** PK-06 (Onda 0) · O Bruce fica para depois
da conversa com a Lidisay: o ponto do Flash passa pelo `exec` dele (43 usos em
30 dias, levantamento de 25/11).

## O problema

Hoje o `exec` da nina e do atlas roda **como root, no host** do gateway. Um
turno enganado (texto de anexo, página lida, mensagem de canal) alcança o
`openclaw.json` (token do gateway e as URLs dos 9 bancos com senha), os
workspaces dos 29 agentes, o systemd e a chave do backup. O PK-07 pôs regras
no prompt; isto é a parede.

## A escolha: sandbox Docker, não SSH

Lido em `docs/gateway/sandboxing.md` do OpenClaw instalado (2026.7.1-2):

- **SSH é "remote-canonical"**: copia o workspace uma vez e **nunca sincroniza
  de volta**. O que a nina gravasse ficaria fora do que o gateway injeta no
  contexto, e o que o backend grava nos sete arquivos (`hsos:empresa`,
  `hsos:roster`, regras-base) não chegaria ao `read` dela. Quebra a regra dos
  sete em silêncio.
- **Docker** monta o próprio workspace (`workspaceAccess: "rw"` →
  `/workspace`): o arquivo do host continua o oficial.

Custo: instalar Docker na VPS que já teve OOM. Medido em 26/11: 6,1 GB
disponíveis de 7,9 GB; o daemon pesa ~100 MB e o contêiner ocioso
(`sleep infinity`) quase nada. Teto por contêiner: `memory: "512m"`,
`pidsLimit: 128`.

## Configuração (por agente, só nina e atlas)

```json5
sandbox: {
  mode: "all", backend: "docker", scope: "agent", workspaceAccess: "rw",
  docker: {
    image: "openclaw-sandbox:bookworm-slim", network: "none",
    readOnlyRoot: true, tmpfs: ["/tmp", "/var/tmp", "/run"],
    user: "0:0", capDrop: ["ALL"], memory: "512m", pidsLimit: 128,
  },
},
tools: { …o que já existe…, sandbox: { tools: { alsoAllow: [...] } } }
```

- **`user: "0:0"`**: o workspace é `root:root` com diretórios `700`; um usuário
  1000 não leria nada. Root DENTRO do contêiner, sem capability nenhuma, sem
  rede, raiz só-leitura e com uma única pasta do host montada, é o que separa
  o agente do resto da máquina. Mapear uid (`userns-remap`) seria a próxima
  camada; fica anotado.
- **`network: "none"`**: os 2 `curl` da nina em 30 dias param de funcionar. Se
  fizerem falta, a ferramenta certa é uma MCP, não rede no contêiner.
- **⚠️ A política de ferramentas da sandbox é uma SEGUNDA lista de permitidas**
  (`sandbox-vs-tool-policy-vs-elevated.md`): o padrão só deixa `exec`, arquivos
  e `sessions_*`. Sem `alsoAllow`, a nina perderia `create_goal`, `update_plan`,
  `memory_get`, `subagents`, `skill_workshop`… e **todas as MCP** (`bundle-mcp`).
  O `alsoAllow` é o inventário de hoje do `tools.effective` mais `bundle-mcp`:
  nada a mais, nada a menos.
- `scope: "agent"`: um contêiner por agente, como é hoje (o `/tmp` já é
  compartilhado entre as sessões dele no host).
- `tools.elevated` (a válvula que roda `exec` fora da sandbox) vem desligado
  por padrão e não está na config. A conferência exige que continue assim.

## Ordem de produção

1. **Erick, no Konsole** (root na VPS): `vps-gateway/sandbox/instalar.sh` —
   Docker sem mexer em iptables (`"iptables": false`, `"bridge": "none"`: os
   contêineres não têm rede), imagem `openclaw-sandbox:bookworm-slim` da doc,
   e um contêiner de teste que tem que falhar ao alcançar a rede e o `/root`.
2. **Claude**: `scripts/sandbox-especialistas.py` (ensaio, depois `--aplicar`,
   payload mostrado antes). Confere relendo a config **e** pelo
   `tools.effective`, que tem que bater com o inventário de antes.
3. **Conferência perguntando** (combinar antes — é `chat.send`): à nina, uma
   pergunta que use uma MCP e um `exec` de `ls /root`. Certo: a MCP responde e
   o `/root` aparece vazio/inacessível.

**Voltar:** `scripts/sandbox-especialistas.py --voltar` (tira `sandbox` e
`tools.sandbox` dos dois). O Docker pode ficar instalado.
