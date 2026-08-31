# Auditoria das respostas dos agentes — semana de 24 a 30/08/2026

Depois de varrer o código à procura de defeito, mudei de eixo: **os números que
os agentes deram ao CEO estão certos?** É onde um erro custa decisão errada, e
não tela vazia.

Método: reconstruir cada número do zero, das tabelas cruas, aplicando a régua
documentada nas skills — sem olhar o que o agente respondeu até ter o meu
resultado. Três bancos, três agentes.

## O resultado

**Todos os números verificáveis bateram, até o centavo.**

### Iris · faturamento (DataCoreHS, régua da skill `faturamento`)

| período | eu medi | a Iris disse |
|---|---|---|
| ago/2025 · vendas | R$ 547.860,10 · 51 notas | R$ 547.860,10 · 51 notas |
| ago/2025 · serviços | R$ 323.796,20 · 99 notas | R$ 323.796,20 · 99 notas |
| jan–jul/2026 · vendas | R$ 4.644.632,92 · 361 notas | R$ 4.644.632,92 |
| jan–jul/2026 · serviços | R$ 1.734.991,30 | R$ 1.734.991,30 |

⚠️ **A "divergência" entre Iris e Nina no mesmo dia não era erro.** Em 28/08 a
Iris disse vendas de R$ 776.442,30 às 14h11 e a Nina R$ 781.342,30 às 18h13. A
diferença é **exatamente uma nota de R$ 4.900** emitida entre as duas horas. As
duas estavam certas no momento em que falaram.

### Atlas · funil (HSGrowth, régua da skill `funil-vendas`)

| corte | eu medi | o Atlas disse |
|---|---|---|
| ganhos ago 01–24 | 52 negócios · R$ 748.558,10 | 52 · R$ 748.558 |
| ganhos ago 01–27 | 57 negócios · R$ 768.460,10 | 57 · R$ 768.460 |
| por vendedor (Adriana, Sandra, Gislayne) | 18/12/11, valores | idênticos |

⚠️ **O único desencontro era meu.** O Atlas disse "Eduardo Luna, 15 negócios,
R$ 436.027" e eu medi 16 e R$ 436.267 — porque comparei uma resposta dada em
**26/08 às 23h11** contra uma janela até 27/08. Até 26/08 inclusive são
exatamente 15 e R$ 436.027,00. O 16º negócio (ENGEFABRAS, R$ 240) fechou no dia
seguinte, depois da resposta.

**A lição de método vale mais que o resultado:** auditar resposta de agente exige
reproduzir **a janela de tempo dele**, não a de hoje. Sem isso, todo número
correto parece errado por uma unidade.

### Nina · despesas (DataCoreHS, via Iris)

| período | eu medi | a Nina disse |
|---|---|---|
| julho/2026 | R$ 608.129,69 · 118 contas · 108 pagas = R$ 550.722,64 | idêntico |
| junho/2026 | R$ 474.290,06 · 111 contas · todas pagas | idêntico |

O saldo em aberto que ela derivou — R$ 57.407,05 em 10 contas — também fecha.

## O que isto quer dizer, e o que não quer

Confirma, número a número, o que a retrospectiva da semana já dizia em prosa: **o
conteúdo entregue foi bom; o que falhou foi a plataforma em volta.** Nenhuma das
falhas de 24 a 30/08 — contexto estourando, mensagem duplicada, pergunta engolida
— corrompeu um número.

⚠️ **Isto NÃO audita o que os agentes opinaram.** As projeções ("no ritmo atual o
ano fecha em R$ 10,94 milhões"), os cenários de contratação e as recomendações
são julgamento sobre dado correto, e julgamento não se confere por consulta. O
que está verificado é a base: o realizado, as contagens e os totais.

⚠️ **E não audita o que se moveu.** Números de agosto mudam a cada nota emitida;
só os meses fechados (ago/2025, jan–jul/2026) e os cortes com data explícita são
comparáveis depois do fato.

## Como repetir

As três réguas estão em `backend/skills/faturamento/SKILL.md`,
`funil-vendas/SKILL.md` e no `bancos` do Erick (`import bancos`). O caminho é
sempre o mesmo: ler a régua, escrever a consulta do zero, medir, **e só então**
abrir a resposta do agente para comparar. Olhar a resposta antes contamina a
consulta.


---

# Segunda rodada: os briefings da manhã

66 documentos escritos por agente sem ninguém pedir, e ninguém nunca tinha
conferido. Auditei os cinco de 31/08.

## Faturamento · 31/08 ✅ exato

Vendas R$ 781.342,30 em 61 notas, serviços R$ 250.109,30 em 142, total
R$ 1.031.451,60 — os três batem com a minha medição do mesmo dia. A meta do
trimestre também: realizado R$ 2.154.542,54, meta R$ 3.166.666,68, atingimento
68,0%, falta R$ 1.012.124,14. Os quatro exatos.

E o `MESES_ANALISE` está em `7,8,9` — a config que produziu o erro de R$ 787 mil
em 21/08 está corrigida, e o briefing usou o trimestre certo.

## Operação · 31/08 ❌ **54% inflado, e a causa é uma linha**

O briefing reporta **261 cards parados em Correios**, com o board Serviço em
**167** (média 18,1 dias). Rodando a régua da própria skill `gargalos-taskhs`:
são **47**.

**Reproduzi o erro exato.** A SQL da skill traz `COALESCE(c.archived,false) =
false`; sem essa linha, o resultado é 166 cards com média 18,6 — o número do
briefing, à diferença de um card que se moveu nas seis horas entre a apuração
dele e a minha.

| board | briefing | com o filtro (certo) | sem o filtro |
|---|---|---|---|
| Serviço | 167 · 18,1 dias | **47 · 11,0** | 166 · 18,6 |
| Vendas | 76 | 75 | 75 |
| Módulo | 18 | 17 | 17 |

No TaskHS inteiro: **295 cards realmente parados, reportados como 454 — 54% a
mais.**

⚠️ **Por que passou despercebido:** só o board Serviço tem massa arquivada
suficiente para a diferença aparecer (378 cards no total, 59 ativos). Vendas e
Módulo ficam certos. Dois dos três números batem, e o terceiro parece apenas "o
gargalo maior" — que é exatamente o que o briefing recomenda atacar.

⚠️ **E não é de hoje.** Em 28/08 o Flow respondeu ao CEO "📮 Correios (Serviço),
162 cards, média 16,1 dias". Mesma régua incompleta, série consistente.

É a mesma forma do incidente de 14/08 no faturamento: somar sem a régua inflou
48% e foi entregue com cara de dado exato. Aqui foram 54%.

**Conserto aplicado:** a skill ganhou um aviso com os números medidos, no ponto
exato onde a linha é largada. ⚠️ **Falta publicar** — `bash
scripts/publicar-skills.sh --enviar` — que é escrita no gateway.

## GestorHS: não dá para auditar, e isso é o achado

O mesmo briefing diz "**193 ordens** em Pós-Vendas, média de **100 dias**". Não
existe régua escrita para "ordem parada" no GestorHS: a `gargalos-taskhs` declara
explicitamente que **não** cobre esse sistema ("eles têm fases e datas próprias"),
e nenhuma outra skill o faz.

Sem régua, a métrica depende da data que se escolhe, e a `ordens` tem seis:

| data usada | ordens com ela preenchida | média |
|---|---|---|
| `data_solicitacao` | **85 de 192** | 100,5 dias |
| `data_chegada` | 192 | 54,3 dias |
| `data_calibracao` | 185 | 51,2 dias |

O briefing bate com `data_solicitacao` — preenchida em **44%** das ordens. A média
de 100 dias descreve uma minoria e é apresentada como se cobrisse as 193.

**Não é erro do agente**, é ausência de régua: ele escolheu uma leitura defensável
entre várias. Enquanto não houver skill de GestorHS, esse número muda conforme
quem responde.

## Os outros três

`Vendedores`, `SDR` e `Serviços` saem do HSGrowth, cuja régua já foi auditada na
primeira rodada e bateu exata. Não os reauditei linha a linha.

## O que a rodada ensina

Os domínios **com régua escrita** verificam exato — faturamento e funil, ao
centavo. O domínio **com régua escrita e parcialmente aplicada** infla 54%. O
domínio **sem régua** não é auditável.

A régua não é documentação: é a diferença entre um número conferível e um palpite
bem formatado.
