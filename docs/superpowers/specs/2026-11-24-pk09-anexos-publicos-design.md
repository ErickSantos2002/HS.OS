# PK-09 — Anexos antigos do bucket público

**Data:** 24/11/2026 · **Pacote:** PK-09 (Onda 0) · **Item:** 02-9 · **Decisão
do Erick (23/11):** apagar do `agent-files` os anexos com mais de 30 dias.

## O que o inventário mostrou

Listagem do R2 (só leitura, por prefixo e idade): `agent-files` tem **20
objetos, todos em `avatars/`**; `wiki-uploads` tem **0**. A migração para o R2
(13/10) não trouxe os anexos do disco, e desde então anexo vai para o privado
`anexos`. **Não havia o que apagar.**

Varredura de todas as colunas de texto do `hsos` atrás de `agent-files/` fora
de `avatars/`: uma referência, em `conversations.media` — anexo que já não
existe no R2. Link quebrado de antes; nada a fazer por ele aqui.

## O que entrou no lugar

- `uploadFileToStorage` (`file-upload.ts`), que mandava arquivo ao
  `agent-files` público, saiu: nada o chamava (só um import no `ChannelChat`).
- A wiki continua no `wiki-uploads` público — arquivo da wiki aparece em
  `<img src>` —, mas o nome deixou de ser `<ms>-<6 de Math.random>` e virou
  uuid (`caminhoNaWiki`, com teste). É o mesmo defeito que o
  `caminho-de-anexo.ts` fechou no `agent-files` em setembro.
- `CONTINUAR-AQUI.md`: a seção de anexo público estava velha (citava
  `audio-messages` como público); ganhou o estado de hoje.

Fora daqui, de propósito: tornar o `wiki-uploads` privado com link assinado
(era o "M" do item original). A decisão de 23/11 não pediu, e hoje ele está
vazio.
