# PK-02 — Artefato vivo só lê dados para o dono

**Data:** 25/11/2026 · **Pacote:** PK-02 (Onda 0) · **Origem:** itens 02-3 e 08-2
da análise do remix (auditoria A6 + FD-06 do DN.OS).

## O defeito

O artefato vivo roda HTML de terceiros — pessoa ou agente — num iframe com
`sandbox="allow-scripts allow-forms allow-downloads"` (sem `allow-same-origin`:
o iframe não alcança o token). O único caminho para os dados é a ponte
`postMessage` do `LiveArtifactViewer`, e ela agia com **a sessão de quem vê**:

- `hsos_query` → `POST /artefatos/consultar` com o token do visitante. A
  allowlist inclui `conversations`, `channel_messages`, `drafts`,
  `notifications`, e o RLS resolvia como o visitante. Desde 17/08 qualquer
  logado abre artefato alheio pelo id; e no `/p/:slug` (modo público) a ponte
  nem conferia o `publicMode` — logado, mandava o token junto.
- `hsos_invoke` → `POST /integracoes/invocar`, idem (este já recusava no
  público, mas não conferia o dono).
- A ponte entregava ao HTML `id`, **e-mail**, papel e nome de quem vê.
- Sem CSP: o que o artefato lesse podia ir por `fetch` para qualquer `https:`.

**Cenário:** uma página gerada sob injeção (e-mail, anexo, card do CRM) no chat
de qualquer pessoa, aberta pelo CEO, lia as conversas do CEO e as enviava.

## Medido em 25/11

44 artefatos vivos: **1** usa `hsos.query` (o "Fluxo de Responsabilidade" da
Nina, aberto pelo dono), 0 usa integração, 0 publicado, 0 com
`fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`, 0 com `<form>`, 0 lendo
`hsos.user`. Nada do que está em uso depende do que vai fechar.

## O conserto

**No servidor (a trava):** `/artefatos/consultar` e `/integracoes/invocar`
passam a exigir `artefato_id` e só atendem se o artefato existe, não foi
apagado e `user_id` é quem chama (`dono_do_artefato`). Fora disso, 200 com
`{ok: false, code: "not_owner"}` — o padrão das duas rotas para erro esperado
vindo de dentro do navegador.

**No front (a mensagem certa):** `podeUsarDados` (`lib/artefato-dono.ts`): só
fora do modo público e quando quem vê é o dono. Fora disso a ponte responde
"Os dados deste painel só aparecem para quem o criou" sem chamar a API. O
objeto `hsos.user` só vai ao HTML para o dono, e **sem e-mail**.

**No iframe:** `<meta http-equiv="Content-Security-Policy" content="connect-src
'none'; form-action 'none'; base-uri 'none'">` antes de qualquer conteúdo
(`comCsp`, logo depois do `<!doctype>` quando há um). Os dados chegam por
`postMessage`, que o `connect-src` não bloqueia.

## O que fica de fora (registrado)

- Exfiltração por `img`/`script src` continua possível: restringir `img-src` e
  `script-src` quebraria gráfico de CDN. Com a trava do dono, o que um artefato
  lê é só do próprio dono.
- O dono que abre o próprio artefato ainda empresta a sessão a ele — é o
  desenho (o painel da Nina lê as conversas de quem o pediu).

## Produção

Só deploy. Conferir: abrir o artefato da Nina com o dono (dados aparecem) e
chamar `/artefatos/consultar` com o `artefato_id` dele e o token de outra
pessoa (recusa `not_owner`).
