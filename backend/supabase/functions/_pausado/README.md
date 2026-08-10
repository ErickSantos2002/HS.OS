# Pausadas — não contam como pendência

Edge functions de funcionalidades que **saíram desta entrega sem serem
apagadas**. Ficam aqui para o placar da migração dizer a verdade: elas não são
trabalho por fazer, são trabalho que foi adiado por decisão de produto.

Se a funcionalidade voltar, a function volta para `functions/` e entra na fila
normal de portagem.

## Arena — pausada em 10/08/2026

`arena-convai-create`, `arena-convai-update`, `arena-convai-signed-url`,
`arena-generate`.

A Arena é uma sala de debate entre agentes, herdada do dn.os, onde servia de
demonstração comercial de plataforma de IA. Nunca foi usada na Health & Safety —
zero arenas, sessões e mensagens no banco desde o remix — e era a feature mais
cara do que restava: quatro functions só dela, todas dependentes da ElevenLabs,
que precisaria ser contratada para uma tela que ninguém abriu.

O front está em `frontend/src/_legado/arena/` e o backend continua com
`app/routers/arenas.py` e as tabelas. Ver `docs/EM-CONSTRUCAO.md`.
