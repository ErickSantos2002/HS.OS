# Anexos (R2) e resumo em áudio

> Saiu do `CLAUDE.md` em 23/11/2026 (o arquivo passou do teto de 150 mil caracteres
> de instruções do Claude Code). Texto movido sem edição. Leia antes de mexer na área.

### Anexos — R2, privados, e o agente lê por ferramenta

Desde 13/10/2026 todo arquivo mora no **Cloudflare R2** (`app/armazenamento.py`, único
módulo que fala com ele; bucket físico `hsos-arquivos`, o bucket lógico é o primeiro
segmento da chave) e o `UPLOADS_DIR` está aposentado. Ler é 302 para URL assinada
(1 h público, **5 min** privado/anexo); enviar é `PUT` assinado de 15 min direto do
navegador — a VPS não vê os bytes. Teto de 100 MB. Sem R2 configurado o backend sobe e
as rotas de arquivo respondem 503 dizendo o que falta. Migração do disco:
`backend/scripts/migrar-uploads-r2.py` (confere por chave e tamanho). URLs
`/storage/<bucket>/<caminho>` já gravadas continuam valendo.

Anexo de conversa vai para o bucket lógico **`anexos`** e vira linha em `public.anexos`
(`017`). Quem lê: membro do canal, ou a pessoa da conversa com o agente. **Sem atalho
para administrador.** A regra é `app/anexos.py`, pura e testada.

⚠️ **Ticket de upload é um JWT com `aud: "hsos-upload"`.** O `ler_token` do login recusa
ticket e o upload recusa token de login — sem isso um serve de passe para o outro.

⚠️ **`generated-documents` só o servidor grava** (o cliente recebe 403). `extrair-texto` e
`DELETE` em bucket privado conferem o dono; `anexos` não passa por `/storage/privado`
nem por `extrair-texto`: só pelas rotas de `routers/anexos.py`.

⚠️ **No `anexos`, o mime é do servidor, não do cliente.** `mime_normalizado` decide (no
fluxo genérico o assinado é o que o cliente mandou); em todo caso o `iniciar`
devolve o `mime` assinado e o cliente tem que usar **esse** no `PUT`, senão o R2 responde
403 `SignatureDoesNotMatch`. Abre inline só o que está na allowlist exata (imagens raster,
pdf, `text/plain`, alguns áudio/vídeo); o resto baixa como attachment — html/svg enviado
por usuário não executa no domínio. A URL vale 5 min: a tela pede uma nova **no clique**
(`urlAgora`), nunca guarda a do carregamento.

⚠️ **O agente recebe uma linha, não o conteúdo:** `[anexo: nome · tamanho · tipo · id=…]`.
No canal a linha só sai para id confirmado em `public.anexos` **daquele canal** — nunca
do JSON que o cliente mandou. Ele lê pelo `ler_anexo` do servidor **`hsos-anexos-<agente>`**:
uma entrada por agente no gateway, com o HMAC (`ANEXOS_MCP_SEGREDO`) do id dele na URL.
É o único MCP nosso em que a identidade do agente é **verificada**; os outros confiam no
argumento. Agente novo: rodar `scripts/publicar-anexos-mcp.py` — o mesmo patch declara
as entradas **e** regrava o `deny` de todo agente do `agents.list` (cada um nega as dos
outros), porque `alsoAllow` só acrescenta. Agente criado pela tela já nasce com o deny
de MCP (`aplicar_escopo_mcp`) e fica sem anexos até o script rodar, mas nunca enxerga a
entrada de outro — que seria agir com a identidade do outro.

⚠️ **`ler_anexo` e `enviar_arquivo` só valem durante o turno em curso** (decisão do
Erick, 13/10/2026). O gateway não repassa ao MCP a sessão nem a pessoa, então sem amarra
o agente lia qualquer anexo de conversa com ele e enviava a qualquer pessoa que um dia
falou com ele — um id de anexo de B que vazasse para a sessão de A (`MEMORY.md`, a
`main`, delegação da `nina`) abria o arquivo de B para A, **sempre**. Hoje anexo
`conversa_agente` exige que o `dono_conversa` tenha run aberto com aquele agente, e o
envio exige o mesmo do `para`: linha em `agent_runs` sem `message_id`, de menos de 30
min (`turno_em_curso` em `routers/mcp_anexos.py`, testada com conexão falsa). A
checagem vem antes do R2 e antes de montar o arquivo. Anexo de **canal** continua só
com a regra de membro — canal não usa `agent_runs`.

**O que sobra, e é o limite honesto de agora:** (1) duas pessoas falando com o mesmo
agente **ao mesmo tempo** — durante o turno de B, a sessão de A ainda lê o anexo de B se
tiver o id; (2) a janela de 30 min — run que nunca recebe `message_id` (aba fechada antes
do `/reply`, ou o run original de uma compactação, que aponta para o novo por
`redireciona_para`) conta como turno aberto até a janela vencer. Fechar de vez continua
exigindo o gateway passar a sessão ao MCP.

⚠️ **Planilha lê-se em thread, só a aba pedida, preguiçosa**, com teto nomeado ao agente:
200.000 linhas e 200 colunas para todo formato; no **xlsx**, 300 MB descompactados; no
**CSV**, 50 MB de arquivo e 1 MB por registro. Sem teto, um zip-bomb ou um CSV sem quebra
de linha trava o worker. `.doc`, `.odt` e `.rtf` não têm leitor: o agente recebe "peça
em .docx ou .pdf" em vez de bytes decodificados como texto.

⚠️ **O agente devolve arquivo escrevendo TEXTO.** `enviar_arquivo` recebe CSV ou Markdown
e o servidor monta xlsx/docx/pdf (em thread, depois de conferir o destino); célula xlsx
começando por `= + - @` vira texto, não fórmula. A entrega na tela vem do trigger de
`conversations`, **não** de `hub.publicar` — não acrescente um segundo caminho.

⚠️ **CORS errado no bucket não dá erro no backend** — o PUT morre no navegador. A tela
diz "rede ou CORS do bucket"; a política está em `docs/DEPLOY.md`.

⚠️ **`relatorio_ponto` mora no `hsos-anexos` e só o `bruce` a enxerga.** O
`tools/list` desse servidor depende do agente da URL (`_FERRAMENTAS_RESTRITAS`),
e `tools/call` de outro agente recebe "ferramenta desconhecida". A régua é a da
coordenadora de RH, em `app/relatorios/ponto.py` — **mudou na conversa com ela,
muda lá**, com teste. O xlsx dela vem com número de verdade; o do
`enviar_arquivo` continua todo texto.

⚠️ **Régua v2 (Grupo A, A1–A6) desde 28/10/2026** —
`docs/superpowers/specs/2026-10-28-regua-ponto-v2-design.md`. São **três** CSV:
marcações e **eventos obrigatórios**, banco opcional. Na homologação a ferramenta
aceitava dois, vieram três, e o `bruce` contou de cabeça — errado (21/2 em vez de
20/3). Mudou a régua, muda `VERSAO_REGUA`: o histórico mensal (bucket privado
`ponto-historico`, **sem rota de leitura**, só o servidor) só compara meses da
mesma versão. `CID` e `Justificativa` de evento nem são lidos; o resumo ao agente
não traz nome; a ferramenta **recusa entregar** planilha que não fecha.

⚠️ **v2.1 (`2026-10-28.1`): o Cálculo Diário do FLASH é o quarto CSV, opcional
mas recomendado** (`ids` de 2 a 4; seção "v2.1" no fim da mesma spec). Com ele o
calendário e as batidas são os do FLASH, e dia útil sem marcação com evento que
só o FLASH conhece sai do denominador — o export de Eventos de setembro não
trazia 5 dias de férias, e eles apareciam como "sem marcação". ⚠️ **O FLASH não
trata intervalo sozinho** (2 batidas = dia inteiro trabalhado): intervalo
pendente continua pendente, agora com a evidência dele. Diferença entre ele e os
outros arquivos é **aviso**, não fechamento. `CPF`/`PIS`/`CNPJ`/`Admissão` nem
são lidos. Histórico apurado com e sem ele não se compara.

### Resumo em áudio nas respostas — pedido do CEO, 13/10/2026

Toda resposta de agente ganha, segundos depois, um áudio **embaixo do texto**:
o agente falando um resumo. Resposta de até 300 caracteres é falada inteira;
acima disso o **DeepSeek** (`DEEPSEEK_API_KEY`, chave própria do backend) resume
em 2 a 4 frases. A voz é do **edge-tts** (`app/voz.py`), e o áudio vira anexo
privado ligado à mensagem por `UPDATE` (`app/voz_entrega.py`) — o trigger de
tempo real leva à tela. Disparo em segundo plano, **depois** do commit da
resposta: o texto nunca espera o áudio.

⚠️ **edge-tts é uso não oficial do serviço da Microsoft — risco aceito pelo
Erick.** Se for bloqueado, as respostas saem sem áudio e o log diz `etapa voz`;
nada mais quebra. A alternativa local avaliada foi o Piper (4 vozes pt-BR, todas
masculinas, mais robóticas).

⚠️ **A voz do agente é `agent_profiles.tts_voice_id`, mas só se começar com
`pt-BR-`** — a coluna veio do ElevenLabs e pode ter id opaco; aí vale o Antonio.
`nina` Francisca, `iris` Thalita (dormindo quando o `midas` assumir), `midas` e os outros Antonio (migração `019`).

Preferência por pessoa: `profiles.resumo_em_audio`, ligada por padrão, em
Configurações → Perfil. Conversa direta: desligada, nada é gerado. Canal: gera
um por resposta e quem desligou só não vê o player.

⚠️ **`ler_segredo` lê `os.environ`, não o `.env`.** Em produção a chave chega
pelo EasyPanel como variável de ambiente; testando por script local, carregue o
`.env` (`load_dotenv`) antes, senão o DeepSeek aparece como "chave ausente".
