# PK-47 — MCP de banco persistente na VPS do gateway

**Data:** 24/11/2026 · **Pacote:** PK-47 (Onda 0 do remix de novembro)
**Critério de aceite do Erick:** não atrapalhar como as coisas funcionam, não
piorar a eficiência atual, não gastar mais dinheiro.

## O problema, medido

Em 23/11, 13:34 BRT, o turno do `erick-bot` ficou minutos em "Iniciando…" e o
kernel da VPS do gateway matou processos por falta de memória — **30 OOMs desde
17/11**, sempre `npm exec @modelcontextprotocol/server-postgres`.

A tabela de processos que o kernel despejou no OOM:

| processo | quantos | RSS |
|---|---|---|
| `npm exec @model…` (o wrapper do `npx`) | 94 | 4,2 GB |
| `MainThread` (o `server-postgres` em si) | 92 | 3,0 GB |

Numa máquina de 7,8 GB, sem swap. Eram ~10 sessões com os 9 servidores cada.

### Por que tantos

Lido no código do OpenClaw 2026.7.1 (`agent-bundle-mcp-runtime`,
`attempt-tool-construction-plan`) e na referência de config:

1. **O runtime de MCP é por sessão.** Cada sessão abre a sua conexão com
   **todos** os servidores de `mcp.servers`.
2. **O `deny` do agente não impede a partida.** Quem decide criar o runtime é
   `shouldCreateBundleMcpRuntimeForAttempt`, que só olha o `toolsAllow` *da
   execução* — não o `tools.deny` do agente. O `deny` esconde a ferramenta
   depois que o processo já subiu.
3. **O runtime vive 10 minutos parado** (`mcp.sessionIdleTtlMs`, padrão).

Os 9 `banco-*` são stdio via `npx -y`. Os **23 Guardis não usam nenhum** —
todos negados — e cada sessão deles sobe os 9 mesmo assim. Só `nina`, `atlas`,
`flow`, `bruce` e `midas` usam, de 2 a 4 cada. Uma rajada (varredura das
07:35, briefings das 08:00, Guardis em uso) empilha sessões dentro da janela
de 10 minutos e a memória acaba.

Instalar o pacote globalmente tiraria o wrapper do `npx` (metade da memória) e
o atraso de partida, mas ainda seriam 9 processos por sessão.

## A decisão

**Um serviço MCP HTTP persistente, `banco-mcp`, na própria VPS do gateway,
ouvindo só em `127.0.0.1:18790`.** As 9 entradas `banco-*` deixam de ser
`command: npx` e viram `transport: streamable-http` apontando para ele.

- **Mesmos nomes de servidor** → a ferramenta continua `banco-X__query`.
  `deny`, `alsoAllow`, `AGENTS.md`, skills e `escopo-mcp.py` não mudam.
- **A URL do banco vai no cabeçalho `X-Banco-Url`** da própria entrada. O
  serviço é genérico e sem estado de config: não há segundo lugar guardando
  credencial, e a fonte continua sendo o `openclaw.json`, como hoje. Ganho de
  lado: a senha sai do `argv` (visível em `ps`, dívida registrada em
  `integracoes.py`) e o `config.get` passa a devolvê-la redigida.
- **Saída byte a byte igual à de hoje.** O serviço usa o mesmo `pg` (8.23.0) e
  o mesmo corpo de tool do `server-postgres` 0.6.2: `BEGIN TRANSACTION READ
  ONLY`, `client.query(sql)`, `JSON.stringify(rows, null, 2)`, `ROLLBACK`.
  Mesmo nome, descrição e schema da tool. Número, data e JSON saem iguais
  porque quem converte tipo é o mesmo driver, no mesmo fuso (UTC). A troca é
  conferida comparando a resposta dos dois servidores, banco por banco.
- **Uma diferença deliberada: consulta única.** A tool roda em
  `queryMode: "extended"`, que recusa vários comandos numa string. É o que
  fecha o furo conhecido do `server-postgres` (`COMMIT; <escrita>` sai da
  transação somente-leitura). Não quebra uso legítimo: com vários comandos o
  servidor antigo devolvia `rows` indefinido — já não funcionava.
  *Provado em 24/11 num Postgres de teste:* o antigo **criou a tabela** e
  devolveu ao agente um erro de validação — escrita feita, agente achando que
  falhou. **Em produção nunca foi explorável:** os 9 usuários são de leitura
  (não superusuário, `default_transaction_read_only=on`, zero tabela com
  INSERT/UPDATE/DELETE, sem `CREATE`), conferido no mesmo dia. A recusa nova é
  a segunda trava, não a única.
- **Sem `resources`.** O servidor antigo anunciava recursos de schema; o
  `toolFilter.include: ["query"]` já os escondia do agente. Não anunciar poupa
  duas listagens por sessão.

### Por que na VPS do gateway e em Node

- Fora do backend do HS.OS: ele mora em outra máquina; cada consulta ganharia
  um salto de rede, e o deploy do backend é manual e no fim do dia.
- Node e não Python: é o mesmo driver do servidor atual. Em Python (asyncpg)
  `numeric`, `date` e `timestamp` sairiam com outra cara — mudança de
  comportamento que as réguas das skills (`faturamento`) não esperam.

### Recursos e limites

- Um `pg.Pool` por URL, com os padrões do `pg` (máx. 10 conexões, ociosa fecha
  em 10 s) — o mesmo que **cada** processo tinha antes. As conexões abertas nos
  bancos caem, não sobem.
- `pool.on("error")` registrado: um banco que cai não derruba o serviço (o
  antigo, por ser um processo por sessão, não precisava).
- systemd: `DynamicUser`, `ProtectSystem=strict`, `NoNewPrivileges`,
  `MemoryMax=512M`, `Restart=always`. O serviço não lê nada do disco além do
  próprio código.
- Log no journald: banco (host/base, nunca a URL), duração, linhas, erro. Nunca
  o SQL inteiro nem a senha.
- `GET /saude` para conferência.

### Custo esperado

| | hoje | depois |
|---|---|---|
| processos por sessão | 18 | 0 |
| memória dos MCPs de banco | ~720 MB por sessão viva | ~70 MB fixos |
| partida de sessão | 9 `npx` com checagem no registro do npm | 9 POSTs locais |
| dinheiro | — | zero (mesma VPS) |

### Swap como rede

2 GB de swapfile com `vm.swappiness=10`. Não é o conserto — é o que impede que
um pico imprevisto vire OOM matando processo no meio de um turno.

## O que muda no backend

`_publicar_banco` (`backend/app/routers/integracoes.py`) é quem escreve as
entradas quando alguém publica um conector de banco pela tela. Sem mudá-lo, a
próxima publicação recria o `npx` daquele banco. Passa a escrever:

```json
{"transport": "streamable-http", "url": "http://127.0.0.1:18790/mcp",
 "headers": {"X-Banco-Url": "<url>"}, "toolFilter": {"include": ["query"]},
 "command": null, "args": null}
```

Os `null` removem os campos do formato antigo no merge patch. A montagem vira
função pura (`entrada_mcp_banco`) com teste.

Até o backend ir para produção, publicar banco pela tela recria o `npx` só
daquele banco — degradação localizada, não quebra.

## A troca, sem derrubar ninguém

1. Instalar e subir o serviço; conferir `/saude`.
2. **Comparar** em todos os 9 bancos, com o servidor antigo rodando ao lado:
   bateria de consultas com `numeric`, `bigint`, `date`, `timestamp`,
   `timestamptz`, `json`, `null`, linha real de tabela, erro de sintaxe e
   escrita recusada. Saída idêntica ou não segue.
3. Fazer o patch das 9 entradas num momento sem sessão de MCP viva (nenhum
   `npm exec` em `ps`), com backup do `openclaw.json` antes. O gateway aplica
   a quente e descarta os runtimes em cache — por isso o momento quieto.
4. `openclaw mcp probe` nos 9 com o cliente do próprio OpenClaw.
5. Conferir na vida real, sem gastar turno à toa: os briefings e o uso do dia
   passam pelo serviço (journal do `banco-mcp`), e `ps` não mostra mais
   `npm exec`.

**Volta atrás:** restaurar o backup do `openclaw.json` pelo `config.patch` (as
9 entradas antigas, guardadas), e parar o serviço. Não há dado a migrar.

## Fora daqui, registrado

- Cada sessão conecta também os **78 servidores HTTP `hsos-*`** — dos quais
  cada agente usa poucos. Não pesa memória na VPS, mas são 78 handshakes no
  backend por sessão. Vale um pacote próprio.
- Os bancos são acessados com `sslmode=disable` pela internet. Antigo, fora
  deste pacote.
- Fila de 6 turnos (PK-12) só depois deste estar conferido.
