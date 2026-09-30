# Conferência da conversa de 29/09/2026 — o CEO e a Nina

O Nicholson usou o sistema das 06h48 às 21h13: **89 mensagens** com a `nina`,
quase todas sobre faturamento e Phoebus, delegadas à `iris`. Conferida em
30/09/2026, reconstruindo os números do zero no DataCoreHS com a régua da skill
`faturamento` e só então comparando com o que ele recebeu. No mesmo dia, cada
defeito virou conserto, e os consertos foram conferidos por um usuário de teste
(`teste.ceo@healthsafetytech.com`) repetindo as perguntas dele pela API, no mesmo
caminho do navegador.

## O placar

| frente | resultado |
|---|---|
| Faturamento mês a mês 2026, vendas 2025 × 2026 | ✅ exatos |
| Serviços jan–set/2025 | ❌ R$ 1,49 mi às 07h09 (certo: R$ 1,60 mi), trocado às 12h54 sem aviso |
| **Phoebus jan–set 2025 × 2026** | ❌ **"caiu 41,5%" (193 → 113). Certo: 138 → 134, −2,9%** |
| Cenário "faltam 65 Phoebus" | ❌ montado sobre a base inflada |
| **CFOP descritos pela Iris** | ❌ **3102 chamado de venda (é importação), 6908 de venda (é comodato)** |
| Phoebus líquido de devolução (noite) | ❌ 748 un — abateu devolução cuja origem a régua já tinha tirado (certo: 757) |
| **Primeiro comprador de Phoebus** | ❌ **"BRF, 08/10/2020" — era remessa para demonstração. Certo: Expresso Figueiredo, 10/12/2020** |
| Maior comprador 2020–2026 | ✅ Concessionária das Linhas 8 e 9, 50 un |
| Funil, SDR, operação (Atlas e Flow) | não conferidos nesta rodada |
| Plataforma | ❌ 6 defeitos, 4 visíveis ao CEO — **todos corrigidos em 30/09** |

---

# Parte 1 — o que a plataforma fez de errado

## 1.1 O crédito da DeepSeek acabou às 21h06, com ele no meio da pergunta

Das 21h06 às 21h13 ele mandou seis mensagens ("sim", "refazer", "ola",
"refazer" e o pedido completo) e recebeu seis vezes *"The agent run failed before
producing a reply"*. O log do gateway dizia `402 Insufficient Balance`. Seguiu
assim até a manhã de 30/09 — os briefings de Operação e Faturamento falharam. O
Erick recarregou às ~08h.

**O que falta:** nada avisa quando o saldo do provedor zera. O sintoma na tela é
indistinguível de qualquer outra falha do agente.

## 1.2 A resposta da Iris não voltava para a Nina

Às 19h06 a Nina escreveu *"A resposta acima veio da Iris, mas preciso do conteúdo
das listas"*, depois *"Tenho as listas. Montando o painel."* — e o turno acabou.
Ele esperou **1h20** até escrever "aguardando".

A causa, confirmada na documentação do OpenClaw e reproduzida em 30/09: a `iris`
entregava o conteúdo pela ferramenta `message` e deixava só um resumo no texto
final, e **o `sessions_send` devolve apenas o texto final**. Havia ~960 usos de
`message` nas sessões arquivadas dela.

**Corrigido:** bloco `resposta-a-nina` no `AGENTS.md` de Iris, Atlas, Flow e
Bruce; regra "anúncio não encerra turno" no da Nina. Conferido pedindo uma lista
de 54 compradores: chegou inteira.

## 1.3 A mesma resposta duas vezes

Às 14h38 a mesma resposta de 2.254 caracteres apareceu duas vezes. O
`/recuperar` (chamado ao abrir a tela) pegou no gateway a resposta de um run
ainda em curso; 13 segundos depois o `/reply` do mesmo run gravou de novo. O
`/recuperar` conferia se o `/reply` já tinha gravado; o `/reply` não conferia.

**Corrigido** (`39627f1`): os dois gravam por `_gravar_resposta`. Nas 20+
perguntas de teste de 30/09, nenhuma duplicada.

## 1.4 A lista que ele pediu duas vezes e não recebeu

Na manhã de 30/09 ele pediu *"todas as empresas, inclusive as que compraram 1
unidade"*. A Iris apurou certo (137 empresas, 757 un) e, ao escrever a tabela,
**bateu no teto de saída de 8.192 tokens**: o gateway descartou o turno inteiro.
A Nina diagnosticou "contexto estourado, igual a 25/08" e pediu reset da sessão —
que não resolveria.

**Corrigido** com a ferramenta `compradores_produto` (`5a2d393`, `f296025`): a
lista sai do banco para uma planilha em Documentos e, se pedirem link, para uma
página montada no servidor. Conferido: 137 linhas somando 757 un e
R$ 15.733.671,84.

⚠️ **O teto de 8.192 continua sem causa.** A API da DeepSeek entrega mais, e
config e `models.json` dizem 32.768.

## 1.5 Flow e Bruce com janela de 65 mil desde agosto

Investigando o teto, apareceu que cada agente tem uma cópia do catálogo de
modelos que o gateway não atualiza — só a da `nina`. A correção da janela de
31/08 (65.536 → 1.000.000) **nunca chegou ao `flow` nem ao `bruce`**. Alinhado em
30/09 (`~/alinhar-models-agentes.sh`) e registrado no `CLAUDE.md`.

## 1.6 A primeira pergunta depois de "Limpar" sumia

Achado no teste, não na conversa dele — mas ele limpa a conversa com frequência.
O piso de sequência da sessão antiga sobrevivia ao reset, e a primeira resposta
era descartada como velha: *"O agente terminou sem produzir texto"*.
**Corrigido** (`1d5a4f1`) e conferido em produção.

---

# Parte 2 — a auditoria dos números

## 2.1 O que bateu

| afirmação | ele recebeu | medido | |
|---|---|---|---|
| Faturamento jan–set/2026 | R$ 8.031.871,92 (até 28/09) | R$ 8.032.271,92 | ⚠️ R$ 400 de diferença entre duas respostas do mesmo dia |
| Vendas jan–set 2025 × 2026 | R$ 5.815.173,40 × R$ 5.787.552,90 | idem | ✅ |
| Phoebus 2025 (depois de corrigido) | 217 un · R$ 4.936.796,00 | idem | ✅ |
| Top 5 compradores de Phoebus 2025 | Nacional Gás 29, TIC Trens 16, Rumo M. Paulista 14, Apia 13, Rocha 10 | idem | ✅ |
| Maior comprador 2020–2026 | Linhas 8 e 9, 50 un | idem | ✅ |

## 2.2 O que não bateu

**Serviços 2025.** Às 07h09 ele leu que o crescimento vinha de serviços, *+50,4%*
(R$ 1,49 mi → R$ 2,24 mi). O certo é R$ 1.597.558,33, **+40,5%** — a própria Iris
entregou esse número às 12h54, sem dizer que o anterior estava errado.

**Phoebus jan–set.** O comparativo de aparelhos contou notas sem filtro de CFOP:
remessa para demonstração, retorno de conserto e importação entraram como venda.
Jan–set/2025 saiu com **193**; de venda são **138**. 2026 saiu com 113; são 134.
A leitura entregue foi *"os dois carros-chefe caíram, Phoebus −41,5%"*; a real é
**estável, −2,9%**. O cenário das 13h45 ("65 Phoebus para empatar") partiu desse
gap inflado.

**CFOP.** Às 20h40 a Iris listou os CFOPs do item com descrições inventadas:
`3102` como *"venda interestadual"* (é **compra do exterior — importação**),
`6908` como *"venda a não contribuinte"* (é **remessa em comodato**), e `2102`
(compra) entre as vendas. Com isso a **C4 Development, fornecedora no exterior,
apareceu como maior compradora de 2026**. Ele mandou tirar o 3102 e o resultado
melhorou — por decisão dele, não da régua.

**Devolução.** O pedido "abater as notas de devolução" virou `vendas − todas as
2202`. Das seis devoluções de Phoebus, só duas tinham a venda de origem ainda na
régua; as outras já estavam fora por marcador de recusa. Resultado entregue:
**748** un; certo: **757**.

**Primeiro comprador.** *"BRF S.A., nota 002828, 08/10/2020"*. A 002828 é CFOP
6912, remessa para demonstração. A primeira **venda** é a **002925, Expresso
Figueiredo, 10/12/2020, 4 unidades**. ⚠️ **Esta ainda precisa ser corrigida com
ele.**

## 2.3 O que foi mudado na régua

Tudo na skill `faturamento` (`0bba623` a `f5da488`) e no `AGENTS.md` da `iris`:

- contagem de produto usa a mesma régua de venda, com item pelo nome exato;
- CFOP se lê do `natureza_operacao` da nota, com a tabela do primeiro dígito;
- devolução só abate quando a origem citada nas `observacoes` ainda conta;
- âncora de produto nos três anos: Phoebus líquido **194 · 217 · 134**
  (2024 · 2025 · 2026 até 29/09) — uma âncora só aprovou o método errado;
- comparação com o ano anterior corta no mesmo dia;
- âncora de janeiro atualizada para R$ 402.592,52 (a 007677 ganhou "NF recusada").

Conferido com as perguntas dele reenviadas pelo usuário de teste: 10 de 10 certas
depois dos consertos, **com uma condição** — a `agent:iris:main` precisou ser
arquivada, porque carregava o método errado na memória e o repetia mesmo com a
skill corrigida.

---

# Parte 3 — o que não foi conferido

- **Flow:** 615 itens parados >72h (342 GestorHS + 214 TaskHS), piores casos.
- **Atlas:** funil por vendedor (154 abertos, R$ 3,26 mi), SDR (9 agendamentos em
  set., 144 no ano, 109 a proposta, 1 ganho), recorte por vendedor 2025 × 2026.
- **Iris:** aparelhos por modelo além do Phoebus e do iBlow 10 Pro; estoque.

O iBlow 10 Pro (374 × 394) e o estoque (315 Phoebus, 85 iBlow 10 Pro) foram
conferidos nas perguntas de teste de 30/09, não na conversa dele.
