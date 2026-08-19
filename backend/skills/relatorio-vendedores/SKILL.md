---
name: relatorio-vendedores
description: >-
  Como gerar a planilha de vendedores do HSGrowth — esforço, cards travados e
  negócios ganhos, uma aba por vendedor. Use quando pedirem "a planilha de
  vendedores", "o relatório do comercial", "como está cada vendedor" ou qualquer
  coisa que peça o quadro por pessoa do funil em arquivo.
emoji: 📊
always: false
---

# Planilha de vendedores

⚠️ **Não monte esse relatório na mão.** Existe a ferramenta
`relatorio_vendedores`, e ela roda **a mesma régua** que o Erick usa desde julho
— a que o Nicholson já viu e aprovou. Refazer a conta por consulta minha daria um
número parecido e diferente, e as duas versões passariam a circular juntas.

## Como chamar

```
relatorio_vendedores { dias: 30, solicitante: "<id da pessoa>" }
```

- **`dias`** é a janela. **30 é o padrão e é o que se usa** — só mude se pedirem
  explicitamente ("da semana" → 7).
- **`solicitante`** é o id que está na minha própria chave de sessão, no pedaço
  `hsos-<id>`, sem o prefixo. É o que faz a planilha ficar **no nome de quem
  pediu**. Sem ele, o arquivo cai no nome do administrador e a pessoa não acha.

## Onde o arquivo vai parar

Em **Documentos**, dentro do HS.OS, no nome de quem pediu. **Não é link público
e não dá para mandar a URL por fora** — a planilha traz card a card com nome de
cliente, valor e link do CRM.

Ao responder, diga onde está: *"a planilha está em Documentos"*. Não prometa
anexo, não ofereça e-mail e não invente endereço de download.

## O que a planilha contém

Uma aba **Resumo** e uma aba por vendedor. A régua, que é o que dá valor a ela:

| | o que é |
|---|---|
| **Atividades** | tarefas concluídas no período, separadas em Ligação, Follow-up, Tarefa e Reunião |
| **Negócios ganhos** | cards fechados no período, em quantidade e valor |
| 🔴 **Parados** | card aberto **sem nenhum toque nos últimos 7 dias** |
| 🔵 **Em andamento** | card aberto que teve algum toque nos 7 dias |

⚠️ **"Toque" tem definição própria** e não é só mover o card: conta atividade
(incluindo movimentação), anotação no card, ou tarefa concluída. A criação do
card é o piso — **card novo nunca nasce parado**.

⚠️ **Parados e Em andamento são um retrato de AGORA, não da janela.** Se
perguntarem "quantos ficaram parados no mês passado", a planilha não responde
isso, e dizer que responde seria inventar.

⚠️ **Não existe corte de idade.** Havia um de 60 dias e ele escondia justamente
os cards mais abandonados, que caíam em "em andamento" como se estivessem
saudáveis. A idade virou coluna, para distinguir "novo e travado" de card que já
devia ter ido para perdido.

O **Erick Santos fica de fora** da lista: ele aparece como vendedor no CRM por
causa dos testes, não porque venda.

## Ao entregar

- Diga **os números do resumo** que a ferramenta devolve — quantos vendedores e
  quantos cards parados no total. É o que a pessoa quer saber antes de abrir.
- Diga **a janela** que você usou.
- Se pedirem interpretação, ela sai da planilha, não de consulta nova.
