# EscritorioHS — mapa próprio da HS — design

**Data:** 2026-10-15 · **Escopo:** pasta nova `escritoriohs/mapa/` (planta,
gerador, prévia, testes, tilesets do kit oficial) e a troca do
`START_ROOM_URL` no EasyPanel. **Nada muda no HS.OS** e nada muda na
infraestrutura do sub-projeto A.

## Objetivo

O mapa que veio pronto (`office`, do map-starter-kit oficial) é pequeno — 31×21
blocos — e não tem os espaços que a HS precisa. O Erick desenhou no Excalidraw
como quer o escritório (`~/Downloads/Sem título-2026-10-15-1250.png`, 15/10):
um mapa **com a cara da HS**, com uma sala por pessoa, os setores agrupados de
um jeito que faz sentido, e os espaços comuns — sem copiar a planta do prédio
físico.

**Sucesso =** a pessoa entra pela recepção com o logo da HS, acha a própria
salinha pela placa ("Comercial 03"), fecha a porta quando está em reunião, e
encontra os colegas no café, nas salas de reunião ou batendo na porta deles.

## Decisões tomadas (15/10/2026)

| decisão | escolha | por quê |
|---|---|---|
| pronto × personalizado | personalizado | mapas abertos do WA são de eventos/hackerspaces e não melhoram o `office` |
| disposição | a planta do Erick (Excalidraw), faixa de cima = opção **B** | ele desenhou mesa por mesa; B = recepção larga com lounge, café grande |
| placas | fixas, "Setor NN" agora; nome da pessoa depois, conforme o Erick indicar | os 2 comerciais novos escolhem a sala |
| como construir | **gerador por código** a partir da planta | reproduzível, versionado, prévia antes de subir |
| cubículo | **sala privada com porta**, trancável | quem está em reunião fecha e ninguém entra |

## A planta

Quadrado. Os blocos "Locomover" do desenho são corredores.

**Faixa de cima (opção B), da esquerda para a direita:** Café / descanso
(grande) · **Recepção + lounge** (larga, ponto de entrada, logo da HS, mural)
· Reunião 02 (~6 lugares) · Área silenciosa.

**Corpo, por colunas:**
- **Esquerda:** corredor; Reunião 01 (mesa no centro); salas de Financeiro 01,
  Financeiro 02 e RH; passagem curva; Suporte 01, Suporte 02, vaga Suporte;
  corredor; TI 01–03; corredor; Lab 01, Lab 02, vaga Lab.
- **Centro-esquerda:** corredor vertical; Qualidade 01 e 02 no pé.
- **Centro:** corredor central largo (a espinha); Expedição 01 e 02 no pé.
- **Direita:** Comercial 01–12 em quatro fileiras de três, com corredor entre
  as fileiras; Diretoria entre as fileiras 2 e 3.

São **30 salas individuais** (Financeiro 2, RH 1, Suporte 2 + vaga, TI 3,
Lab 2 + vaga, Qualidade 2, Expedição 2, Comercial 12), mais Diretoria, 2
salas de reunião, recepção, café e silenciosa. Marketing ocupa uma das salas
do Comercial; Consultoria não tem sala.

## Como cada espaço se comporta

| espaço | área no `.wam` | efeito |
|---|---|---|
| Recepção | `start` | todo mundo nasce aqui |
| Reunião 01 e 02 | `livekitRoomProperty` | quem entra cai na mesma chamada, sem depender de proximidade, inclusive acima de 4 |
| Silenciosa | `silent` | ninguém abre conversa por proximidade |
| Café / lounge | — | proximidade normal |
| Diretoria | sala com porta + `lockableAreaPropertyData` | conversa lá dentro não se mistura com o corredor; dá para fechar |
| **Sala individual** | paredes + porta + `lockableAreaPropertyData` + `personalAreaPropertyData` (sem dono) | **fecha a porta = ocupado, ninguém entra**; dono vem no sub-projeto B |
| Corredores | — | passagem |

⚠️ **As salas de reunião do `office` atual usam `jitsiRoom` e não funcionam
aqui** — não há Jitsi. O formato certo para LiveKit é a área
`livekitRoomProperty` no `.wam` (`libs/map-editor/src/types.ts` do WA).

⚠️ **Quem pode trancar** não está confirmado: `lockableAreaPropertyData` aceita
`allowedTags` opcional e guarda o estado em variável. A primeira tarefa do
plano é uma sondagem com uma sala só: quem está dentro tranca, quem chega de
fora é barrado, e alguém que já estava no mapa também. Se não se comportar
assim, a decisão volta ao Erick antes de gerar as 30.

**Proximidade:** o raio da bolha é ~2 blocos; as paredes da sala isolam quem
está dentro de quem passa no corredor.

## O gerador

```
escritoriohs/mapa/
  planta.json      cômodos, salas e corredores em blocos: posição, tamanho,
                   tipo, placa, lado da porta
  gerar.py         planta.json → saida/hs.tmj (desenho) + saida/hs.wam (áreas)
  previa.py        saida/hs.tmj → PNG com os blocos reais, para aprovação
  tilesets/        blocos do map-starter-kit (WA_*), com a licença deles,
                   + o logo da HS como bloco próprio
  testes/          pytest do gerador
```

- **Escala:** 1 bloco = 32 px. Sala individual ~7×7 blocos com parede, porta,
  mesa, cadeira, computador, cadeira de visita e placa. Mapa ~85×80 blocos.
- **Determinístico:** a mesma planta gera os mesmos bytes.
- **O gerador é a fonte da verdade.** Edição feita no editor do navegador some
  no próximo envio; decoração que valer a pena manter entra no gerador.
- **Envio:** pelo `upload-wa-map`, como no sub-projeto A, mas com diretório
  próprio (não `/`, que apaga os outros `.wam`). O `office` fica no ar até a
  aprovação; a troca é o `START_ROOM_URL` no EasyPanel, e voltar é a mesma
  variável.
- **Placas:** texto em `planta.json` (`"placa": "Comercial 03"`). Trocar pelo
  nome da pessoa = editar uma linha e reenviar.

## Testes (pytest, sem rede)

1. Nenhum cômodo se sobrepõe a outro; tudo cabe no mapa.
2. **Toda sala é alcançável a pé a partir da recepção** — busca em largura
   sobre a camada de colisão, passando pelas portas. Sala sem porta ou porta
   virada para a parede reprova.
3. Toda porta dá para corredor ou espaço comum, nunca para dentro de outra sala.
4. Toda placa está dentro da sua sala; não há duas salas com a mesma placa.
5. Cada sala individual tem exatamente uma área trancável e uma pessoal, do
   tamanho do interior dela.
6. Gerar duas vezes dá bytes idênticos.
7. Os 30 nomes de sala batem com a lista desta spec (nenhuma esquecida).

## Fora deste escopo

Nome das pessoas nas placas (vem aos poucos, pelo Erick), dono das áreas
pessoais e status na porta (sub-projeto B), agentes no mapa (sub-projeto C),
decoração fina além do básico.

## Critérios de aceite

1. Prévia em PNG aprovada pelo Erick antes de qualquer envio.
2. Mapa no ar com `START_ROOM_URL` apontando para ele; o `office` continua
   acessível pelo link direto.
3. O Erick entra pela recepção, anda até "Comercial 03" e entra.
4. Duas pessoas: uma tranca a própria sala; a outra não consegue entrar.
5. Três pessoas na Reunião 01 estão na mesma chamada sem estarem lado a lado.
6. Na silenciosa, duas pessoas lado a lado não abrem conversa.
