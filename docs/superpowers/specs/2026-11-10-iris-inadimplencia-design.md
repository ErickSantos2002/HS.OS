# Iris → Inadimplência do DataCore — design (10/11/2026)

## Por quê

O Nicholson pergunta de recebíveis à `nina`, que delega à `iris`. A `iris` lê
`tiny.contas_receber` pelo `banco-datacorehs` e monta "vencido" ela mesma — e
avisa, com razão, que "vencido aqui não é inadimplência" (resposta de 03/11).
A régua de verdade — 30 dias de carência, faixas, status de cobrança, promessa,
contato, taxa de safra — mora em `DataCore/backend/app/core/inadimplencia.py`
e na tela de Inadimplência. Prometido ao Nicholson em 09/11.

**Sucesso:** perguntado "como está a inadimplência" ou "quem são os
inadimplentes", a `iris` responde com os MESMOS números da tela do DataCore, e
a lista sai como planilha em Documentos.

## Decidido com o Erick

- A `iris` entra no DataCore **como o Nicholson** (`np@healthsafetytech.com`,
  `admin` lá): token de agente com `sub` = e-mail dele, `act.sub = iris`. Vale
  também quando quem pergunta é a `nina` por delegação.
- Entrega: **números no texto + planilha** (Documentos, bucket privado), como
  `compradores_produto`. Link público só se pedirem, com validade.

## Anti-objetivos

- **Recalcular a régua do lado de cá.** Nada de copiar CARÊNCIA, faixas ou SQL
  de `inadimplencia.py` — duas réguas é o que fez o faturamento divergir.
- Escrever no DataCore (evento de cobrança, observação, anexo): leitura só.
- Lista nominal de clientes em link público sem validade.

## Parte 1 — DataCore (sessão daquele repo)

Mesmo desenho do TaskHS (`TaskHS/backend/app/core/agente.py`,
`dependencies.py`, v2.13.0):

- Aceitar o token de agente (EdDSA, `iss=hsos`, `aud="datacore"`, `exp` ≤ 600 s,
  chave pública em `HSOS_AGENTE_CHAVE_PUBLICA`, `GET
  hsosapi.healthsafetytech.com/agente/chave-publica`). `sub` = e-mail → usuário
  de `auth.usuarios` (comparação exata, minúsculas); sem usuário → 401. Aplica
  as permissões que ele já tem (`exigir_papeis`), nada a mais.
- Só nas **leituras** de `/inadimplencia`: `GET /resumo`, `/empresas`,
  `/empresas/{empresa}`, `/empresas/{empresa}/titulos`, `/indicadores`. Toda
  escrita (eventos, observação, anexos) **recusa** token de agente (403), como o
  `bloquear_token_de_agente` do TaskHS. Os outros routers seguem sem aceitar.
- A dependência global `PROTEGIDO` (main.py) precisa deixar o token passar
  nessas rotas.
- Testes: token válido lê `/resumo`; token com `aud` errado, vencido ou de
  e-mail sem usuário → 401; token em `POST /empresas/{e}/eventos` → 403.
- Changelog do DataCore. Env `HSOS_AGENTE_CHAVE_PUBLICA` no EasyPanel.

## Parte 2 — HS.OS

- `app/sistemas/datacore.py`: cliente com token `aud="datacore"`, base
  `DATACORE_API_URL` (padrão `https://tinyapi.healthsafetytech.com`), mesma
  auditoria em `agente_chamadas` e mesmas mensagens de erro do `taskhs.py`
  (extrair o comum, não copiar).
- Ferramenta **`inadimplencia`** no `hsos-relatorios`, só para a `iris`
  (`toolFilter`), dois modos:
  - `resumo` → `/resumo` + `/indicadores`: total a receber, vencido, em atraso
    (1–30), inadimplente (>30), % da carteira, faixas, empresas inadimplentes,
    promessas, sem contato, taxa do último mês fechado e média 12 meses.
  - `lista` → `/empresas` paginado (até 1.000 por página, todas as páginas) com
    os filtros que a tela aceita (`faixa`, `status`, `busca`,
    `incluir_atraso`); planilha xlsx em Documentos no nome do solicitante
    (`_dono_do_pedido`); o modelo recebe totais e as 10 maiores. Com
    `publicar_link` e `dias_de_validade`, a página no servidor como no
    `compradores_produto`.
  - Rodapé fixo no texto: "Números do DataCoreHS (tela Inadimplência), posição
    de hoje."
- Constante `EMAIL_DA_IRIS_NO_DATACORE = "np@healthsafetytech.com"` com o porquê.
- Publicar: `toolFilter.include` da `iris` no `hsos-relatorios` ganha
  `inadimplencia`; ponteiro curto no `AGENTS.md` da `iris` ("inadimplência e
  recebíveis vencidos → ferramenta `inadimplencia`; não calcule do banco") —
  medir o teto de 20.000 antes. Conferir **perguntando à `iris`**.

## Ordem

DataCore primeiro (sem ele a ferramenta só devolve 401), depois deploy do
backend do HS.OS, depois a publicação no gateway.
