# War Room na TV — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development
> (recomendado) ou superpowers:executing-plans. Passos com `- [ ]`.

**Objetivo:** a War Room vira painel de TV pública: nenhum conteúdo de mensagem
no feed nem na tela, DMs entre pessoas viram linhas, pessoas num anel por
setor sem sobreposição, status e presença no nó.

**Arquitetura:** duas frentes independentes, ligadas só pelo contrato do
`/warroom/feed` (abaixo). **Backend** (Tasks 1–2, branch `warroom-tv-back`):
regras puras em `app/warroom.py`, consultas em `app/routers/warroom.py` que
**não selecionam `content`**. **Frontend** (Tasks 3–4, branch
`warroom-tv-front`): `lib/warroom-feed.ts` (fronteira), `lib/warroom-layout.ts`
(posições, função pura) e `pages/WarRoomPage.tsx` (desenho).

**Stack:** FastAPI + asyncpg, pytest; React + Vite + TypeScript, Vitest (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-16-warroom-tv-design.md` — ler antes.

## Restrições globais

- Código, comentários e testes em **português**, no estilo do repo: docstring
  de teste conta o que o defeito custou.
- **Nenhum campo do feed deriva de `conversations.content` ou
  `channel_messages.content`.** As consultas não selecionam essas colunas.
- Status na TV: `Em reunião`→`reuniao`, `Foco / DND`→`foco`, `Almoço`→`almoco`,
  `Ausente`/`Doente`/`Férias / Folga`/`Viajando`→`ausente`; qualquer outro → `null`.
- Pessoa do time: e-mail termina em `@healthsafetytech.com` **e** não começa por `teste`.
- Título de documento só aparece se casar `^(Operação|Faturamento|Vendedores|SDR|Serviços) · \d{2}/\d{2}$`.
- DM vivo: canal `type='dm'` com 2 membros humanos do time e mensagem nos últimos 10 min.
- Janela de agrupamento do Fluxo: 10 min. Fluxo: até 14 itens, só de hoje (00:00 America/Recife).
- Quadro do layout: 1600 × 900.
- Backend: `cd backend && ./.venv/bin/python -m pytest tests -q` tem que passar inteiro.
- Frontend: `cd frontend && npx vitest run && npm run lint && npm run build` têm que passar.
- Fim de branch: merge local na `main` é feito pelo coordenador, não pelo agente.

## O contrato (as duas frentes dependem dele)

```ts
interface Feed {
  ts: string; diasNoAr: number | null;
  setores: { nome: string; pessoas: string[] }[];
  pessoas: { id: string; nome: string; setor: string; noEscritorio: boolean;
             status: "reuniao" | "foco" | "almoco" | "ausente" | null }[];
  agentes: { id: string; nome: string; papel: string; estado: "ocioso" | "pensando" | "longo";
             desde: string | null; contexto: number | null; parceiroId: string | null }[];
  conversasTime: { a: string; b: string; ultima: string }[];
  eventos: { ts: string; tipo: "entrega" | "agente" | "time"; texto: string }[];
  numeros: { entregas: number; atendidas: number; pessoasAtivas: number; conversasTime: number };
}
```

## Foco da revisão

1. **Conteúdo voltando por outro caminho** — alguém reintroduz `content` numa
   consulta "só para o rótulo". Trancado pelo teste de SQL da Task 2.
2. **`Doente` na TV** — status de saúde exposto. Trancado em Task 1.
3. **Nomes iguais** — dois "Lucas" viram dois nós com o mesmo rótulo. Task 1
   (`nomes_curtos`).
4. **Muita gente** — com 40 pessoas os rótulos voltam a se atropelar. Task 3
   (teste com 40).
5. **Front novo com back velho** (deploy não atômico) — campo ausente derruba a
   TV. Task 3 (`normalizar` com payload antigo).

---

### Task 1: regras puras do feed (`app/warroom.py`)

**Arquivos:**
- Modificar: `backend/app/warroom.py`
- Modificar: `backend/tests/test_warroom.py`

**Interfaces:**
- Mantém: `confere_token`, `pode_ver`, `_encurtar`, `estado_do_agente` (sem mudança).
- Produz (usado pela Task 2):
  - `SETORES`, `OUTROS`, `setor_de(departamento: str | None) -> str`
  - `status_publico(label: str | None) -> str | None`
  - `e_do_time(email: str | None) -> bool`
  - `nomes_curtos(perfis: list[dict]) -> dict[str, str]` (perfis com `id`, `full_name`)
  - `montar_pessoas(perfis: list[dict], presentes: set[str]) -> tuple[list[dict], list[dict]]`
    (perfis com `id`, `email`, `full_name`, `departamento`, `custom_status`;
    devolve `(pessoas, setores)`)
  - `montar_agentes(perfis, contexto, ultimas, agora, do_time: set[str]) -> list[dict]`
    (`ultimas`: `{agent_id: {role, created_at, user_id}}`)
  - `membros_do_time(linhas: list[dict], do_time: set[str]) -> dict[str, tuple[str, str]]`
    (linhas com `channel_id`, `membros: list[str]`)
  - `dms_vivos(membros, mensagens, agora) -> list[dict]` (mensagens com `channel_id`, `created_at`)
  - `texto_entrega(agente: str, titulo: str | None) -> str`
  - `montar_eventos(publicados, msgs_agente, msgs_dm, membros, nomes, nomes_agente, limite=14) -> list[dict]`
  - `montar_numeros(entregas: int, msgs_agente, msgs_dm, membros, do_time) -> dict`
- Remove: `montar_eventos` antigo (com `content`), `montar_numeros` antigo
  (tokens/custo/cacheTaxa), `_LIMITE_TEXTO`, `_LIMITE_TAREFA`, os campos
  `tarefa`, `filhos`, `parceiro`, `parceiroAgente` de `montar_agentes`.

- [ ] **Passo 1: reescrever os testes que mudam de contrato**

Em `backend/tests/test_warroom.py`, **apagar**: `test_agente_conversando_ganha_parceiro`,
`test_agente_ocioso_nao_tem_parceiro`, `test_a_pergunta_aberta_vira_a_tarefa_na_tela`,
`test_sem_conversa_a_tarefa_e_nula_e_a_tela_mostra_o_papel`,
`test_sub_agentes_ficam_vazios_por_falta_de_fonte`, `test_briefing_publicado_e_uma_entrega`,
`test_eventos_vem_do_mais_novo_para_o_mais_velho`, `test_taxa_de_cache_sem_fonte_fica_nula`,
`test_numeros_contam_entregas_e_conversas`, `test_tarefa_longa_e_encurtada`,
`test_tarefa_perde_a_quebra_de_linha` e o bloco de comentário "A tarefa também
precisa caber". Nas chamadas restantes de `montar_agentes`, acrescentar o
argumento `set()` no fim (ex.: `w.montar_agentes([PERFIL], [], {}, AGORA, set())`).
Trocar `_msg` para não ter mais texto:

```python
def _msg(role, minutos, user_id="u-nich"):
    return {"role": role, "created_at": AGORA - timedelta(minutes=minutos), "user_id": user_id}
```

Acrescentar no fim do arquivo:

```python
import json

# ── TV pública: nada de conteúdo (16/10/2026) ────────────────────────────────
# A War Room foi para a TV da empresa, que visitante vê, e o link é a
# credencial. Até aqui o Fluxo mostrava "Nicholson: phoebus vendido em abril
# qual empresa" e o rótulo do agente era a pergunta em aberto — e o JSON do
# feed carregava esse texto para quem tivesse o link.

SENTINELA = "PERGUNTA-SECRETA-DO-CEO"
NOMES = {"u-nich": "Nicholson", "u-erick": "Erick", "u-welton": "Welton"}
DO_TIME = set(NOMES)


def test_nenhuma_funcao_deixa_o_conteudo_passar():
    """Mesmo que uma linha chegue com `content`, nada dele sai."""
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user",
             "created_at": AGORA, "content": SENTINELA}]
    dms = [{"channel_id": "c1", "created_at": AGORA, "author_id": "u-erick", "content": SENTINELA}]
    membros = {"c1": ("u-erick", "u-welton")}
    saida = {
        "agentes": w.montar_agentes([PERFIL], [], {"iris": {**msgs[0], "agent_id": "iris"}},
                                    AGORA, DO_TIME),
        "eventos": w.montar_eventos([], msgs, dms, membros, NOMES, {"nina": "Nina"}),
        "dms": w.dms_vivos(membros, dms, AGORA),
    }
    assert SENTINELA not in json.dumps(saida, default=str)


def test_agente_nao_tem_mais_tarefa():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA, DO_TIME)[0]
    assert "tarefa" not in a and "parceiro" not in a and "filhos" not in a


def test_agente_conversando_aponta_o_id_da_pessoa():
    """`parceiroId` é a ponta da curva — id, não nome: nome curto pode repetir."""
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2)}, AGORA, DO_TIME)[0]
    assert a["parceiroId"] == "u-nich"


def test_agente_ocioso_nao_aponta_ninguem():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("agent", 1)}, AGORA, DO_TIME)[0]
    assert a["parceiroId"] is None


def test_conversa_com_conta_de_fora_do_time_nao_desenha_linha():
    a = w.montar_agentes([PERFIL], [], {"iris": _msg("user", 2, "u-teste")}, AGORA, DO_TIME)[0]
    assert a["estado"] == "pensando" and a["parceiroId"] is None


# ── Status: só o que pode ir para a parede ───────────────────────────────────

def test_status_dos_presets():
    assert w.status_publico("Em reunião") == "reuniao"
    assert w.status_publico("Foco / DND") == "foco"
    assert w.status_publico("Almoço") == "almoco"
    assert w.status_publico("Ausente") == "ausente"


def test_doente_nunca_aparece_vira_ausente():
    """`Doente` é dado de saúde, numa TV que visitante vê."""
    for label in ("Doente", "Férias / Folga", "Viajando"):
        assert w.status_publico(label) == "ausente"


def test_texto_livre_e_home_office_nao_vao_para_a_tv():
    """`custom_status` aceita 200 caracteres de texto livre."""
    assert w.status_publico("resolvendo o caso do cliente X") is None
    assert w.status_publico("Home office") is None
    assert w.status_publico(None) is None


# ── Quem é do time, e como se chama na parede ────────────────────────────────

def test_so_o_dominio_da_empresa_e_sem_conta_de_teste():
    assert w.e_do_time("ti@healthsafetytech.com")
    assert not w.e_do_time("teste.ceo@healthsafetytech.com")
    assert not w.e_do_time("contato@ketlinscalco.com.br")
    assert not w.e_do_time(None)


def test_nome_curto_e_o_primeiro_nome():
    assert w.nomes_curtos([{"id": "1", "full_name": "Erick Santos"}]) == {"1": "Erick"}


def test_primeiro_nome_repetido_ganha_o_sobrenome():
    """Dois "Lucas" na parede seriam dois nós com o mesmo rótulo."""
    n = w.nomes_curtos([{"id": "1", "full_name": "Lucas Avezedo da Silva"},
                        {"id": "2", "full_name": "Lucas Pereira"}])
    assert n == {"1": "Lucas Silva", "2": "Lucas Pereira"}


def test_setor_pela_tabela_e_comercial_pelo_prefixo():
    assert w.setor_de("COMERCIAL-SDR") == "Comercial"
    assert w.setor_de("MARKETING") == "Comercial"
    assert w.setor_de("Expedição") == "Operação"
    assert w.setor_de("RECURSOS HUMANOS") == "Administrativo"
    assert w.setor_de("Consultoria") == "Outros"
    assert w.setor_de(None) == "Outros"


def test_montar_pessoas_ordena_por_setor_e_marca_presenca():
    perfis = [
        {"id": "a", "email": "ti@healthsafetytech.com", "full_name": "Erick Santos",
         "departamento": "TI", "custom_status": "Em reunião"},
        {"id": "b", "email": "np@healthsafetytech.com", "full_name": "Nicholson Pimentel",
         "departamento": "DIRETORIA", "custom_status": None},
        {"id": "c", "email": "teste.ceo@healthsafetytech.com", "full_name": "Teste CEO",
         "departamento": None, "custom_status": None},
    ]
    pessoas, setores = w.montar_pessoas(perfis, {"np@healthsafetytech.com"})
    assert [p["id"] for p in pessoas] == ["b", "a"]
    assert pessoas[0] == {"id": "b", "nome": "Nicholson", "setor": "Diretoria",
                          "noEscritorio": True, "status": None}
    assert pessoas[1]["status"] == "reuniao" and pessoas[1]["noEscritorio"] is False
    assert setores == [{"nome": "Diretoria", "pessoas": ["b"]}, {"nome": "TI", "pessoas": ["a"]}]


# ── Conversa entre pessoas: só que existe ────────────────────────────────────

def test_dm_so_conta_com_dois_humanos_do_time():
    linhas = [{"channel_id": "c1", "membros": ["u-erick", "u-welton"]},
              {"channel_id": "c2", "membros": ["u-erick", "u-teste"]},
              {"channel_id": "c3", "membros": ["u-erick"]}]
    assert w.membros_do_time(linhas, DO_TIME) == {"c1": ("u-erick", "u-welton")}


def test_dm_com_mensagem_recente_vira_linha():
    membros = {"c1": ("u-erick", "u-welton")}
    msgs = [{"channel_id": "c1", "created_at": AGORA - timedelta(minutes=3)}]
    assert w.dms_vivos(membros, msgs, AGORA) == [
        {"a": "u-erick", "b": "u-welton", "ultima": (AGORA - timedelta(minutes=3)).isoformat()}]


def test_dm_parado_ha_mais_de_dez_minutos_some():
    membros = {"c1": ("u-erick", "u-welton")}
    msgs = [{"channel_id": "c1", "created_at": AGORA - timedelta(minutes=11)}]
    assert w.dms_vivos(membros, msgs, AGORA) == []


# ── Fluxo: fatos, nunca texto ────────────────────────────────────────────────

def test_briefing_mostra_o_titulo():
    assert w.texto_entrega("Atlas", "Serviços · 16/10") == "Atlas publicou Serviços · 16/10"


def test_documento_qualquer_nao_mostra_o_titulo():
    """A `nina` já publicou lista nominal de clientes perdidos."""
    assert w.texto_entrega("Nina", "Clientes que a Sandra perdeu") == "Nina publicou um documento"


def test_vinte_mensagens_seguidas_sao_uma_linha_no_fluxo():
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user",
             "created_at": AGORA - timedelta(minutes=i)} for i in range(20)]
    ev = w.montar_eventos([], msgs, [], {}, NOMES, {"nina": "Nina"})
    assert ev == [{"ts": AGORA.isoformat(), "tipo": "agente", "texto": "Nicholson conversou com Nina"}]


def test_pausa_maior_que_a_janela_abre_outra_linha():
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user", "created_at": AGORA},
            {"user_id": "u-nich", "agent_id": "nina", "role": "user",
             "created_at": AGORA - timedelta(minutes=30)}]
    assert len(w.montar_eventos([], msgs, [], {}, NOMES, {"nina": "Nina"})) == 2


def test_dm_no_fluxo_diz_so_quem():
    dms = [{"channel_id": "c1", "created_at": AGORA}]
    ev = w.montar_eventos([], [], dms, {"c1": ("u-welton", "u-erick")}, NOMES, {})
    assert ev[0]["texto"] == "Erick e Welton conversaram" and ev[0]["tipo"] == "time"


def test_fluxo_do_mais_novo_para_o_mais_velho_e_com_limite():
    pub = [{"agent_id": "atlas", "title": "SDR · 16/10", "created_at": AGORA - timedelta(hours=3)}]
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user", "created_at": AGORA}]
    ev = w.montar_eventos(pub, msgs, [], {}, NOMES, {"nina": "Nina", "atlas": "Atlas"})
    assert [e["tipo"] for e in ev] == ["agente", "entrega"]
    muitos = [{"agent_id": "atlas", "title": "SDR · 16/10", "created_at": AGORA - timedelta(minutes=i)}
              for i in range(30)]
    assert len(w.montar_eventos(muitos, [], [], {}, NOMES, {})) == 14


def test_numeros_do_dia():
    msgs = [{"user_id": "u-nich", "agent_id": "nina", "role": "user"},
            {"user_id": "u-nich", "agent_id": "nina", "role": "agent"},
            {"user_id": "u-nich", "agent_id": "iris", "role": "agent"},
            {"user_id": "u-teste", "agent_id": "nina", "role": "user"}]
    dms = [{"channel_id": "c1", "author_id": "u-erick"}, {"channel_id": "c1", "author_id": "u-welton"}]
    n = w.montar_numeros(5, msgs, dms, {"c1": ("u-erick", "u-welton")}, DO_TIME)
    assert n == {"entregas": 5, "atendidas": 2, "pessoasAtivas": 3, "conversasTime": 1}
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_warroom.py -q`
Esperado: FALHA (funções novas não existem; `montar_agentes` com 5 argumentos).

- [ ] **Passo 3: implementar em `backend/app/warroom.py`**

Manter o cabeçalho do módulo, acrescentando ao fim dele o parágrafo:

```
⚠️ **TV pública desde 16/10/2026: nada de conteúdo.** O feed é montado só de
nomes, ids, horários, contagens e frases fixas — as consultas do router nem
selecionam `content`. Ver `docs/superpowers/specs/2026-10-16-warroom-tv-design.md`.
```

Trocar os imports e as constantes de texto:

```python
import hmac
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

FUSO = ZoneInfo("America/Recife")

# Rótulo de nó lido a quatro metros. `specialty` costuma ser uma frase inteira.
_LIMITE_PAPEL = 40

# Pergunta sem resposta além disto é demora que a parede precisa destacar.
# É o `LONGO_MIN_PADRAO` da edge original, mantido.
_LONGO = timedelta(minutes=8)

# Depois disso a conversa não é mais "agora": o nó apaga e a curva some.
_ESQUECE = timedelta(hours=2)

# Conversa entre pessoas acesa, e janela de agrupamento do Fluxo.
_JANELA = timedelta(minutes=10)

_DOMINIO = "@healthsafetytech.com"

SETORES = (
    ("Diretoria", ("DIRETORIA",)),
    ("Comercial", ("COMERCIAL-VENDAS", "COMERCIAL-SERVIÇOS", "COMERCIAL-SDR", "MARKETING")),
    ("Operação", ("EXPEDIÇÃO", "LABORATÓRIO", "QUALIDADE")),
    ("Suporte", ("SUPORTE TÉCNICO AO CLIENTE",)),
    ("TI", ("TI",)),
    ("Administrativo", ("FINANCEIRO", "RECURSOS HUMANOS")),
)
OUTROS = "Outros"
_ORDEM = [nome for nome, _ in SETORES] + [OUTROS]
_SETOR_DE = {dep: nome for nome, deps in SETORES for dep in deps}

# Labels de `frontend/src/lib/user-status.ts`, copiados LITERALMENTE (mesma
# régua de `app/escritorio/status_wa.py`). ⚠️ `Doente` é dado de saúde: vira
# `ausente`, nunca aparece como é. O resto — `Home office` e texto livre —
# não vai para a TV.
_STATUS = {
    "Em reunião": "reuniao", "Foco / DND": "foco", "Almoço": "almoco",
    "Ausente": "ausente", "Doente": "ausente", "Férias / Folga": "ausente",
    "Viajando": "ausente",
}

# Briefing tem título fixo; documento qualquer pode ter título sensível.
_BRIEFING = re.compile(r"^(Operação|Faturamento|Vendedores|SDR|Serviços) · \d{2}/\d{2}$")
```

Manter `confere_token`, `pode_ver`, `_encurtar` e `estado_do_agente` como
estão. Substituir `montar_agentes`, `montar_eventos` e `montar_numeros` por:

```python
def setor_de(departamento: str | None) -> str:
    d = (departamento or "").strip().upper()
    if d in _SETOR_DE:
        return _SETOR_DE[d]
    return "Comercial" if d.startswith("COMERCIAL") else OUTROS


def status_publico(label: str | None) -> str | None:
    """Só os presets saem; texto livre de 200 caracteres não vai para a parede."""
    return _STATUS.get((label or "").strip())


def e_do_time(email: str | None) -> bool:
    """Domínio da empresa e sem conta de teste (`teste.ceo@`). A consultora
    externa tem login no HS.OS e não é do time."""
    e = (email or "").strip().lower()
    return e.endswith(_DOMINIO) and not e.startswith("teste")


def nomes_curtos(perfis: list[dict]) -> dict[str, str]:
    """Primeiro nome; quem divide o primeiro nome com alguém ganha o último
    sobrenome — dois nós com o mesmo rótulo não se distinguem de longe."""
    partes = {p["id"]: (p.get("full_name") or "").split() for p in perfis}
    contagem = Counter(ps[0].casefold() for ps in partes.values() if ps)
    nomes = {}
    for pid, ps in partes.items():
        if not ps:
            nomes[pid] = "—"
        elif contagem[ps[0].casefold()] > 1 and len(ps) > 1:
            nomes[pid] = f"{ps[0]} {ps[-1]}"
        else:
            nomes[pid] = ps[0]
    return nomes


def montar_pessoas(perfis: list[dict], presentes: set[str]) -> tuple[list[dict], list[dict]]:
    """Os hexágonos e os setores, na ordem do anel. `presentes`: e-mails em
    minúsculas de quem está no escritório virtual agora."""
    do_time = [p for p in perfis if e_do_time(p.get("email"))]
    curtos = nomes_curtos(do_time)
    pessoas = [{
        "id": p["id"],
        "nome": curtos[p["id"]],
        "setor": setor_de(p.get("departamento")),
        "noEscritorio": (p.get("email") or "").strip().lower() in presentes,
        "status": status_publico(p.get("custom_status")),
    } for p in do_time]
    pessoas.sort(key=lambda x: (_ORDEM.index(x["setor"]), x["nome"].casefold()))
    setores = [{"nome": s, "pessoas": [x["id"] for x in pessoas if x["setor"] == s]}
               for s in _ORDEM]
    return pessoas, [s for s in setores if s["pessoas"]]


def montar_agentes(perfis: list, contexto: list, ultimas: dict,
                   agora: datetime, do_time: set[str]) -> list[dict]:
    """Os nós de agente. ⚠️ Sem `tarefa`: até 16/10/2026 o rótulo embaixo do
    nó era a pergunta em aberto, lida de longe por quem passasse pela TV."""
    por_agente = {c.get("agent_id"): c for c in contexto if c.get("agent_id")}
    nos = []
    for p in perfis:
        agente = p.get("agent_id")
        if not agente:
            continue
        ultima = ultimas.get(agente) or {}
        estado = estado_do_agente(ultima or None, agora)
        ativo = estado != "ocioso"
        c = por_agente.get(agente) or {}
        janela = int(c.get("context_tokens") or 0)
        quem = ultima.get("user_id")
        nos.append({
            "id": agente,
            "nome": p.get("name") or agente,
            # ⚠️ `role` está vazio nos cinco agentes (medido em 01/09); quem
            # carrega o papel é `specialty`.
            "papel": _encurtar((p.get("role") or p.get("specialty") or "").strip(),
                               _LIMITE_PAPEL),
            "estado": estado,
            "desde": ultima["created_at"].isoformat() if ativo else None,
            # Fração; sem janela conhecida é `None` — `0` seria lido "contexto limpo".
            "contexto": (round(int(c.get("total_tokens") or 0) / janela, 4)
                         if janela > 0 else None),
            "parceiroId": quem if ativo and quem in do_time else None,
        })
    return nos


def membros_do_time(linhas: list[dict], do_time: set[str]) -> dict[str, tuple[str, str]]:
    """DM com exatamente dois humanos, os dois do time."""
    out = {}
    for linha in linhas:
        membros = sorted(set(linha.get("membros") or []))
        if len(membros) == 2 and all(m in do_time for m in membros):
            out[linha["channel_id"]] = (membros[0], membros[1])
    return out


def dms_vivos(membros: dict, mensagens: list[dict], agora: datetime) -> list[dict]:
    """As linhas ciano: DM com mensagem nos últimos 10 min. Só quem — nunca o quê."""
    ultima: dict[str, datetime] = {}
    for m in mensagens:
        c = m.get("channel_id")
        if c in membros and (c not in ultima or m["created_at"] > ultima[c]):
            ultima[c] = m["created_at"]
    vivos = [{"a": membros[c][0], "b": membros[c][1], "ultima": t.isoformat()}
             for c, t in ultima.items() if agora - t <= _JANELA]
    return sorted(vivos, key=lambda d: d["ultima"], reverse=True)


def texto_entrega(agente: str, titulo: str | None) -> str:
    t = (titulo or "").strip()
    return f"{agente} publicou {t}" if _BRIEFING.match(t) else f"{agente} publicou um documento"


def _fins_de_janela(tempos: list[datetime]) -> list[datetime]:
    """Agrupa mensagens seguidas: pausa maior que a janela abre outra conversa.
    Devolve o horário da última mensagem de cada uma."""
    fins, anterior = [], None
    for t in sorted(tempos):
        if anterior is not None and t - anterior > _JANELA:
            fins.append(anterior)
        anterior = t
    if anterior is not None:
        fins.append(anterior)
    return fins


def montar_eventos(publicados: list, msgs_agente: list, msgs_dm: list, membros: dict,
                   nomes: dict, nomes_agente: dict, limite: int = 14) -> list[dict]:
    """O Fluxo: frases fixas montadas de nomes. `msgs_agente` são só as de
    `role = 'user'`; `nomes` são os nomes curtos de quem é do time."""
    eventos = []
    for d in publicados:
        agente = nomes_agente.get(d.get("agent_id"), d.get("agent_id") or "Agente")
        eventos.append((d["created_at"], "entrega", texto_entrega(agente, d.get("title"))))
    por_par = defaultdict(list)
    for m in msgs_agente:
        if m.get("user_id") in nomes:
            por_par[(m["user_id"], m.get("agent_id"))].append(m["created_at"])
    for (pessoa, agente), tempos in por_par.items():
        for fim in _fins_de_janela(tempos):
            eventos.append((fim, "agente",
                            f"{nomes[pessoa]} conversou com {nomes_agente.get(agente, agente)}"))
    por_dm = defaultdict(list)
    for m in msgs_dm:
        if m.get("channel_id") in membros:
            por_dm[m["channel_id"]].append(m["created_at"])
    for canal, tempos in por_dm.items():
        a, b = sorted((nomes.get(x, "—") for x in membros[canal]), key=str.casefold)
        for fim in _fins_de_janela(tempos):
            eventos.append((fim, "time", f"{a} e {b} conversaram"))
    eventos.sort(key=lambda e: e[0], reverse=True)
    return [{"ts": t.isoformat(), "tipo": tipo, "texto": texto}
            for t, tipo, texto in eventos[:limite]]


def montar_numeros(entregas: int, msgs_agente: list, msgs_dm: list,
                   membros: dict, do_time: set[str]) -> dict:
    """O rodapé. Saíram tokens e custo: métrica de operação, não de vitrine."""
    atendidas = {(m.get("user_id"), m.get("agent_id")) for m in msgs_agente
                 if m.get("role") == "agent" and m.get("user_id") in do_time}
    ativos = {m.get("user_id") for m in msgs_agente if m.get("role") == "user"}
    ativos |= {m.get("author_id") for m in msgs_dm if m.get("channel_id") in membros}
    return {
        "entregas": int(entregas),
        "atendidas": len(atendidas),
        "pessoasAtivas": len(ativos & do_time),
        "conversasTime": len({m["channel_id"] for m in msgs_dm if m.get("channel_id") in membros}),
    }
```

- [ ] **Passo 4: rodar e ver passar**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_warroom.py -q`
Esperado: tudo passa. (A suíte inteira ainda falha no router até a Task 2 —
normal se algum teste importar o router; conferir.)

- [ ] **Passo 5: commit**

```bash
git add backend/app/warroom.py backend/tests/test_warroom.py
git commit -m "feat(warroom): regras puras da TV pública — sem conteúdo, DMs, setores e status"
```

---

### Task 2: o router (`app/routers/warroom.py`)

**Arquivos:**
- Modificar: `backend/app/routers/warroom.py`
- Criar: `backend/tests/test_warroom_rota.py`
- Modificar: `docs/EM-CONSTRUCAO.md` (seção War room)

**Interfaces:**
- Consome: tudo que a Task 1 produz.
- Produz: `GET /warroom/feed` no contrato do topo do plano.

- [ ] **Passo 1: teste da rota com banco falso**

Criar `backend/tests/test_warroom_rota.py`:

```python
"""A rota do painel de TV não pode nem PERGUNTAR pelo conteúdo.

Em 16/10/2026 a War Room foi para a TV da empresa e o Fluxo mostrava a
pergunta do CEO a um agente. Tirar o texto da montagem não basta: basta uma
consulta voltar a selecionar `content` "só para o rótulo" e ele reaparece. Este
teste lê o SQL que a rota manda e recusa a coluna.
"""
import asyncio
import re

import pytest

from app.routers import warroom as rota


class _Conn:
    def __init__(self, sqls):
        self.sqls = sqls

    async def fetch(self, sql, *a):
        self.sqls.append(sql)
        return []

    async def fetchrow(self, sql, *a):
        self.sqls.append(sql)
        return None

    async def fetchval(self, sql, *a):
        self.sqls.append(sql)
        return None


class _Sessao:
    def __init__(self, sqls):
        self.sqls = sqls

    async def __aenter__(self):
        return _Conn(self.sqls)

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def sqls(monkeypatch):
    lista = []
    monkeypatch.setattr(rota, "sessao", lambda **k: _Sessao(lista))

    async def segredo(nome):
        return "tok"

    monkeypatch.setattr(rota, "ler_segredo", segredo)
    return lista


def test_nenhuma_consulta_seleciona_content(sqls):
    asyncio.run(rota.feed(t="tok", usuario=None))
    assert sqls, "a rota não consultou nada?"
    for sql in sqls:
        assert not re.search(r"\bcontent\b", sql, re.I), sql


def test_resposta_no_contrato_novo_mesmo_com_banco_vazio(sqls):
    r = asyncio.run(rota.feed(t="tok", usuario=None))
    assert set(r) == {"ts", "diasNoAr", "setores", "pessoas", "agentes",
                      "conversasTime", "eventos", "numeros"}
    assert r["numeros"] == {"entregas": 0, "atendidas": 0, "pessoasAtivas": 0, "conversasTime": 0}


def test_sem_token_e_sem_sessao_recusa(sqls):
    with pytest.raises(Exception) as e:
        asyncio.run(rota.feed(t="errado", usuario=None))
    assert getattr(e.value, "status_code", None) == 401
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `cd backend && ./.venv/bin/python -m pytest tests/test_warroom_rota.py -q`
Esperado: FALHA (a rota atual seleciona `content` e devolve o contrato velho).

- [ ] **Passo 3: reescrever o corpo de `feed`**

Em `backend/app/routers/warroom.py`, acrescentar ao docstring do módulo:

```
⚠️ **Nenhuma consulta aqui seleciona `content`** (TV pública, 16/10/2026).
`tests/test_warroom_rota.py` lê o SQL e recusa a coluna.
```

Acrescentar o import `from app.escritorio import presenca as escritorio_presenca`
e trocar o corpo de `feed`, depois da checagem de `pode_ver`, por:

```python
    agora = datetime.now(timezone.utc)
    hoje = datetime.now(warroom.FUSO).replace(hour=0, minute=0, second=0, microsecond=0)

    estado = escritorio_presenca.presenca  # lido a cada chamada (o teste o troca)
    presentes = {p["email"] for p in estado.pessoas()} if estado.conectado else set()

    async with sessao(role="service_role") as conn:
        perfis_pessoa = await conn.fetch(
            "SELECT id::text AS id, email, full_name, departamento, custom_status "
            "FROM public.profiles")
        perfis = await conn.fetch(
            "SELECT agent_id, name, role, specialty FROM public.agent_profiles "
            "ORDER BY sort_order, name")
        contexto = await conn.fetch(
            "SELECT DISTINCT ON (agent_id) agent_id, total_tokens, context_tokens "
            "FROM public.agent_context_state ORDER BY agent_id, updated_at DESC")
        # Só papel, hora e quem — o texto não sai do banco.
        ultimas = await conn.fetch(
            """SELECT DISTINCT ON (agent_id) agent_id, role, created_at, user_id::text AS user_id
                 FROM public.conversations ORDER BY agent_id, created_at DESC""")
        publicados = await conn.fetch(
            "SELECT agent_id, title, created_at FROM public.wiki_documents "
            "WHERE created_at >= $1 ORDER BY created_at DESC", hoje)
        msgs_agente = await conn.fetch(
            "SELECT user_id::text AS user_id, agent_id, role, created_at "
            "FROM public.conversations WHERE created_at >= $1", hoje)
        dm_membros = await conn.fetch(
            """SELECT cm.channel_id::text AS channel_id, array_agg(cm.user_id) AS membros
                 FROM public.channel_members cm
                 JOIN public.channels c ON c.id = cm.channel_id
                WHERE c.type = 'dm' AND cm.member_type = 'human' AND cm.user_id IS NOT NULL
                GROUP BY cm.channel_id""")
        msgs_dm = await conn.fetch(
            """SELECT m.channel_id::text AS channel_id, m.author_id, m.created_at
                 FROM public.channel_messages m
                 JOIN public.channels c ON c.id = m.channel_id
                WHERE c.type = 'dm' AND m.deleted_at IS NULL AND m.created_at >= $1""", hoje)
        primeiro = await conn.fetchval("SELECT min(ts) FROM public.usage_events")

    pessoas, setores = warroom.montar_pessoas([dict(r) for r in perfis_pessoa], presentes)
    do_time = {p["id"] for p in pessoas}
    nomes = {p["id"]: p["nome"] for p in pessoas}
    nomes_agente = {r["agent_id"]: (r["name"] or r["agent_id"]) for r in perfis}
    membros = warroom.membros_do_time([dict(r) for r in dm_membros], do_time)
    msgs_agente_l = [dict(r) for r in msgs_agente]
    msgs_dm_l = [dict(r) for r in msgs_dm]

    return {
        "ts": agora.isoformat(),
        "diasNoAr": (agora - primeiro).days if primeiro else None,
        "setores": setores,
        "pessoas": pessoas,
        "agentes": warroom.montar_agentes(
            [dict(r) for r in perfis], [dict(r) for r in contexto],
            {r["agent_id"]: dict(r) for r in ultimas if r["agent_id"]}, agora, do_time),
        "conversasTime": warroom.dms_vivos(membros, msgs_dm_l, agora),
        "eventos": warroom.montar_eventos(
            [dict(r) for r in publicados],
            [m for m in msgs_agente_l if m["role"] == "user"],
            msgs_dm_l, membros, nomes, nomes_agente),
        "numeros": warroom.montar_numeros(len(publicados), msgs_agente_l, msgs_dm_l,
                                          membros, do_time),
    }
```

- [ ] **Passo 4: rodar a suíte inteira**

Run: `cd backend && ./.venv/bin/python -m pytest tests -q`
Esperado: tudo passa.

- [ ] **Passo 5: conferir o SQL contra o banco de produção (só leitura)**

As consultas novas tocam `channel_members`, `channels.type` (enum
`channel_type`) e `profiles.departamento`. Rodar cada uma com o cadastro de
bancos para pegar erro de tipo antes do deploy:

```bash
cd ~/projetos/bancos && ./.venv/bin/python -c "
import bancos
for sql in [
  \"SELECT cm.channel_id::text, array_agg(cm.user_id) FROM public.channel_members cm JOIN public.channels c ON c.id = cm.channel_id WHERE c.type = 'dm' AND cm.member_type = 'human' AND cm.user_id IS NOT NULL GROUP BY cm.channel_id\",
  \"SELECT m.channel_id::text, m.author_id, m.created_at FROM public.channel_messages m JOIN public.channels c ON c.id = m.channel_id WHERE c.type = 'dm' AND m.deleted_at IS NULL AND m.created_at >= now() - interval '1 day'\",
  \"SELECT id::text, email, full_name, departamento, custom_status FROM public.profiles\",
  \"SELECT agent_id, name, role, specialty FROM public.agent_profiles ORDER BY sort_order, name\",
]:
    print(len(bancos.consultar('hsos', sql)), 'linhas ok')
"
```

Esperado: quatro linhas `N linhas ok`, sem exceção.

- [ ] **Passo 6: documentar em `docs/EM-CONSTRUCAO.md`**

Na seção "✅ War room — de volta em 01/09/2026", acrescentar ao fim:

```markdown
⚠️ **Desde 16/10/2026 é TV pública: nenhum conteúdo.** Pedido do Nicholson para
a TV da empresa. O Fluxo mostrava a pergunta do CEO a um agente e o rótulo do
nó era a pergunta em aberto — e o JSON carregava o texto para quem tivesse o
link. Hoje as consultas não selecionam `content` (`test_warroom_rota.py` lê o
SQL), o Fluxo é de frases fixas, título de documento só aparece se for de
briefing, e o status `Doente` vira `ausente`. Entraram as DMs (linha ciano
entre as duas pessoas, 10 min), a presença do escritório virtual e o status.
Spec: `docs/superpowers/specs/2026-10-16-warroom-tv-design.md`.
```

- [ ] **Passo 7: commit**

```bash
git add backend/app/routers/warroom.py backend/tests/test_warroom_rota.py docs/EM-CONSTRUCAO.md
git commit -m "feat(warroom): feed da TV sem consultar conteúdo; DMs, presença e status"
```

---

### Task 3: fronteira e layout (`lib/warroom-feed.ts`, `lib/warroom-layout.ts`)

**Arquivos:**
- Modificar: `frontend/src/lib/warroom-feed.ts`
- Criar: `frontend/src/lib/warroom-feed.test.ts`
- Criar: `frontend/src/lib/warroom-layout.ts`
- Criar: `frontend/src/lib/warroom-layout.test.ts`

**Interfaces:**
- Consome: o contrato do topo do plano.
- Produz (usado pela Task 4):
  - `warroom-feed.ts`: tipos `Feed`, `Pessoa`, `Agente`, `ConversaTime`,
    `Evento`, `Numeros`, `Estado`, `StatusPessoa`; `normalizar(bruto: unknown): Feed`.
  - `warroom-layout.ts`: `QUADRO`, `R_PESSOA`, `R_AGENTE`,
    `larguraRotulo(nome, escala)`, `calcularLayout(entrada): SaidaLayout`,
    tipos `PontoXY`, `EntradaLayout`, `SaidaLayout`, `RotuloSetor`.

- [ ] **Passo 1: testes da fronteira**

Criar `frontend/src/lib/warroom-feed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizar } from "./warroom-feed";

describe("normalizar — a TV nunca cai por forma de resposta", () => {
  it("payload vazio vira feed vazio desenhável", () => {
    const f = normalizar(null);
    expect(f.pessoas).toEqual([]);
    expect(f.setores).toEqual([]);
    expect(f.conversasTime).toEqual([]);
    expect(f.numeros).toEqual({ entregas: 0, atendidas: 0, pessoasAtivas: 0, conversasTime: 0 });
  });

  it("backend antigo (sem setores, com tarefa) não derruba e não mostra tarefa", () => {
    // Deploy não atômico: o front novo pode falar com o back velho por minutos.
    const f = normalizar({
      pessoas: [{ id: "p1", nome: "Erick Santos" }],
      agentes: [{ id: "nina", nome: "Nina", estado: "pensando", tarefa: "segredo", parceiro: "Erick" }],
      numeros: { entregas: 2, conversas: 9, tokens: 1, custo: 1 },
    });
    expect(f.setores).toEqual([{ nome: "Time", pessoas: ["p1"] }]);
    expect(f.pessoas[0]).toMatchObject({ id: "p1", setor: "Time", noEscritorio: false, status: null });
    expect(JSON.stringify(f)).not.toContain("segredo");
    expect(f.agentes[0].parceiroId).toBeNull();
    expect(f.numeros.entregas).toBe(2);
  });

  it("status desconhecido vira null, nunca texto", () => {
    const f = normalizar({ pessoas: [{ id: "p", nome: "X", setor: "TI", status: "doente" }] });
    expect(f.pessoas[0].status).toBeNull();
  });

  it("conversa entre pessoas sem as duas pontas é descartada", () => {
    const f = normalizar({ conversasTime: [{ a: "p1", b: "" }, { a: "p1", b: "p2", ultima: "x" }] });
    expect(f.conversasTime).toEqual([{ a: "p1", b: "p2", ultima: "x" }]);
  });
});
```

- [ ] **Passo 2: reescrever `frontend/src/lib/warroom-feed.ts`**

Manter o comentário de cabeçalho e acrescentar a ele:

```
 * ⚠️ **TV pública desde 16/10/2026.** O contrato não tem mais `tarefa`: o
 * rótulo do agente era a pergunta em aberto. Se um backend antigo ainda mandar
 * `tarefa`, ela é descartada aqui — não chega a nenhum componente.
```

E substituir tipos e funções por:

```ts
export type Estado = "ocioso" | "pensando" | "longo";
export type StatusPessoa = "reuniao" | "foco" | "almoco" | "ausente";

export interface Pessoa {
  id: string; nome: string; setor: string;
  noEscritorio: boolean; status: StatusPessoa | null;
}
export interface Agente {
  id: string; nome: string; papel: string; estado: Estado;
  desde: string | null; contexto: number | null; parceiroId: string | null;
}
export interface ConversaTime { a: string; b: string; ultima: string }
export interface Evento { ts: string; tipo: "entrega" | "agente" | "time"; texto: string }
export interface Numeros { entregas: number; atendidas: number; pessoasAtivas: number; conversasTime: number }
export interface Feed {
  ts: string; diasNoAr: number | null;
  setores: { nome: string; pessoas: string[] }[];
  pessoas: Pessoa[]; agentes: Agente[]; conversasTime: ConversaTime[];
  eventos: Evento[]; numeros: Numeros;
}

const ESTADOS: Estado[] = ["ocioso", "pensando", "longo"];
const STATUS: StatusPessoa[] = ["reuniao", "foco", "almoco", "ausente"];
const TIPOS: Evento["tipo"][] = ["entrega", "agente", "time"];

const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objetos = (v: unknown) =>
  lista(v).filter((o): o is Record<string, unknown> => !!o && typeof o === "object");
const texto = (v: unknown): string => (typeof v === "string" ? v : "");
/** Número ou `null`. Não converte ausência em zero — ver o cabeçalho. */
const numeroOuNulo = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const numero = (v: unknown): number => numeroOuNulo(v) ?? 0;

export function normalizar(bruto: unknown): Feed {
  const f = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const n = (f.numeros && typeof f.numeros === "object" ? f.numeros : {}) as Record<string, unknown>;

  const pessoas: Pessoa[] = objetos(f.pessoas)
    .map((p) => ({
      id: texto(p.id),
      nome: texto(p.nome),
      setor: texto(p.setor) || "Time",
      noEscritorio: p.noEscritorio === true,
      status: STATUS.includes(texto(p.status) as StatusPessoa) ? (texto(p.status) as StatusPessoa) : null,
    }))
    .filter((p) => p.id);
  const ids = new Set(pessoas.map((p) => p.id));

  let setores = objetos(f.setores)
    .map((s) => ({ nome: texto(s.nome), pessoas: lista(s.pessoas).map(texto).filter((id) => ids.has(id)) }))
    .filter((s) => s.nome && s.pessoas.length);
  // Backend antigo não manda setores: um anel só, para a TV continuar de pé.
  if (!setores.length && pessoas.length) {
    const porSetor = new Map<string, string[]>();
    for (const p of pessoas) porSetor.set(p.setor, [...(porSetor.get(p.setor) ?? []), p.id]);
    setores = [...porSetor].map(([nome, ps]) => ({ nome, pessoas: ps }));
  }

  return {
    ts: texto(f.ts) || new Date().toISOString(),
    diasNoAr: numeroOuNulo(f.diasNoAr),
    setores,
    pessoas,
    agentes: objetos(f.agentes)
      .map((a): Agente => {
        const estado = texto(a.estado) as Estado;
        const parceiroId = texto(a.parceiroId);
        return {
          id: texto(a.id),
          nome: texto(a.nome) || texto(a.id),
          papel: texto(a.papel),
          estado: ESTADOS.includes(estado) ? estado : "ocioso",
          desde: texto(a.desde) || null,
          contexto: numeroOuNulo(a.contexto),
          parceiroId: ids.has(parceiroId) ? parceiroId : null,
        };
      })
      .filter((a) => a.id),
    conversasTime: objetos(f.conversasTime)
      .map((c) => ({ a: texto(c.a), b: texto(c.b), ultima: texto(c.ultima) }))
      .filter((c) => c.a && c.b),
    eventos: objetos(f.eventos).map((e) => ({
      ts: texto(e.ts),
      tipo: TIPOS.includes(texto(e.tipo) as Evento["tipo"]) ? (texto(e.tipo) as Evento["tipo"]) : "agente",
      texto: texto(e.texto),
    })),
    numeros: {
      entregas: numero(n.entregas),
      atendidas: numero(n.atendidas),
      pessoasAtivas: numero(n.pessoasAtivas),
      conversasTime: numero(n.conversasTime),
    },
  };
}
```

- [ ] **Passo 3: testes do layout**

Criar `frontend/src/lib/warroom-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { QUADRO, R_PESSOA, calcularLayout, larguraRotulo, type EntradaLayout } from "./warroom-layout";

/** O time real em 16/10/2026: 28 pessoas, 7 setores — o caso da foto. */
const REAL: [string, string[]][] = [
  ["Diretoria", ["Nicholson"]],
  ["Comercial", ["Adriana", "André", "Cláudia", "Eduardo", "Ellen", "Gislayne", "Karolaine",
    "Lara", "Leticia", "Miguel", "Sandra"]],
  ["Operação", ["Gustavo", "Hyago", "Leandro", "Lucas", "Paulo", "Rafael", "Walbert"]],
  ["Suporte", ["Gabriel", "Suelen"]],
  ["TI", ["Erick", "Rickelme", "Welton"]],
  ["Administrativo", ["Djalma", "Lidisay"]],
];
const AGENTES = ["nina", "iris", "atlas", "flow", "bruce"];

function entrada(setores: [string, string[]][]): EntradaLayout {
  const nomes: Record<string, string> = {};
  return {
    setores: setores.map(([nome, ps]) => ({
      nome, pessoas: ps.map((p, i) => { const id = `${nome}-${i}`; nomes[id] = p; return id; }),
    })),
    agentes: AGENTES,
    nomes,
  };
}

/** 40 pessoas: o time crescendo não pode trazer a bagunça de volta. */
const QUARENTA: [string, string[]][] = REAL.map(([s, ps]) => [s, [...ps]]);
for (let i = 0; QUARENTA.flatMap(([, p]) => p).length < 40; i++) QUARENTA[1][1].push(`Pessoa${i}`);

type Caixa = { x0: number; y0: number; x1: number; y1: number };
const cruza = (a: Caixa, b: Caixa) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function caixas(e: EntradaLayout) {
  const s = calcularLayout(e);
  const r = R_PESSOA * s.escala;
  const out: { id: string; no: Caixa; rotulo: Caixa }[] = [];
  for (const [id, p] of Object.entries(s.pessoas)) {
    const w = larguraRotulo(e.nomes[id], s.escala);
    out.push({
      id,
      no: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r },
      rotulo: { x0: p.x - w / 2, y0: p.y + r + 2, x1: p.x + w / 2, y1: p.y + r + 2 + 30 * s.escala },
    });
  }
  return { s, out };
}

describe.each([["28 pessoas reais", REAL], ["40 pessoas", QUARENTA]])("layout com %s", (_, setores) => {
  const e = entrada(setores);

  it("todo mundo tem lugar", () => {
    const s = calcularLayout(e);
    expect(Object.keys(s.pessoas)).toHaveLength(setores.flatMap(([, p]) => p).length);
    expect(Object.keys(s.agentes)).toEqual(AGENTES);
  });

  it("nenhum rótulo de nome encosta em outro nem em outro nó — o defeito da foto de 16/10", () => {
    const { out } = caixas(e);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        expect(cruza(out[i].rotulo, out[j].rotulo), `${out[i].id} × ${out[j].id}`).toBe(false);
        expect(cruza(out[i].rotulo, out[j].no), `${out[i].id} × nó ${out[j].id}`).toBe(false);
        expect(cruza(out[i].no, out[j].rotulo), `nó ${out[i].id} × ${out[j].id}`).toBe(false);
      }
  });

  it("tudo dentro do quadro, rótulos de setor inclusive", () => {
    const { s, out } = caixas(e);
    for (const { rotulo, no } of out)
      for (const c of [rotulo, no]) {
        expect(c.x0).toBeGreaterThanOrEqual(0); expect(c.x1).toBeLessThanOrEqual(QUADRO.w);
        expect(c.y0).toBeGreaterThanOrEqual(0); expect(c.y1).toBeLessThanOrEqual(QUADRO.h);
      }
    for (const r of s.setores) {
      const w = larguraRotulo(r.nome, 1.2);
      const x0 = r.ancora === "end" ? r.x - w : r.ancora === "middle" ? r.x - w / 2 : r.x;
      expect(x0).toBeGreaterThanOrEqual(0); expect(x0 + w).toBeLessThanOrEqual(QUADRO.w);
      expect(r.y).toBeGreaterThanOrEqual(12); expect(r.y).toBeLessThanOrEqual(QUADRO.h);
    }
  });

  it("mesma entrada, mesma saída — a parede não dança", () => {
    expect(calcularLayout(e)).toEqual(calcularLayout(e));
  });
});

it("cada setor ganha um rótulo, na ordem", () => {
  expect(calcularLayout(entrada(REAL)).setores.map((s) => s.nome)).toEqual(REAL.map(([s]) => s));
});
```

- [ ] **Passo 4: implementar `frontend/src/lib/warroom-layout.ts`**

```ts
/**
 * Onde cada nó da War Room fica — função pura, testada sem React.
 *
 * ⚠️ **Por que existe.** Em 16/10/2026 a War Room foi para a TV da empresa com
 * 28 pessoas numa grade, e os nomes se atropelavam ("Ketlin Scalco" em cima de
 * "Suelen Patrícia…"). O cálculo vivia dentro da página, misturado com desenho
 * e animação, e nenhum teste olhava sobreposição.
 *
 * O desenho: núcleo no centro, agentes num anel interno, pessoas num anel
 * externo agrupadas por setor, com um vão entre setores e o nome do setor por
 * fora. Pontos a **distância igual sobre a elipse** (não ângulo igual: na
 * elipse, ângulo igual aperta as laterais). Determinístico de propósito: com
 * posições estáveis quem trabalha na sala aprende o mapa.
 */

export interface PontoXY { x: number; y: number }
export interface EntradaLayout {
  setores: { nome: string; pessoas: string[] }[];
  agentes: string[];
  /** id → nome exibido; é o que decide a largura do rótulo. */
  nomes: Record<string, string>;
}
export interface RotuloSetor { nome: string; x: number; y: number; ancora: "start" | "middle" | "end" }
export interface SaidaLayout {
  escala: number;
  nucleo: PontoXY;
  pessoas: Record<string, PontoXY>;
  agentes: Record<string, PontoXY>;
  setores: RotuloSetor[];
}

export const QUADRO = { w: 1600, h: 900 };
export const R_PESSOA = 18;
export const R_AGENTE = 36;

const CENTRO = { x: 800, y: 455 };
const ANEL_PESSOAS = { rx: 590, ry: 315 };
const ANEL_AGENTES = { rx: 200, ry: 150 };
const AFASTA_SETOR = 58;
/** Passo de arco a partir do qual cabe nó + rótulo sem encolher. */
const PASSO_CONFORTAVEL = 92;

/** Largura aproximada do rótulo de nome (fonte de 13 px). */
export function larguraRotulo(nome: string, escala: number): number {
  return Math.ceil(nome.length * 7.2 * escala) + 4;
}

const ponto = (rx: number, ry: number, t: number): PontoXY => ({
  x: CENTRO.x + rx * Math.cos(-Math.PI / 2 + t),
  y: CENTRO.y + ry * Math.sin(-Math.PI / 2 + t),
});

/** `n` ângulos-parâmetro a distância igual sobre a elipse, começando no topo,
 *  sentido horário, cada um no meio do seu trecho. */
function parametrosEquidistantes(n: number, rx: number, ry: number): number[] {
  const N = 2880;
  const acumulado = [0];
  let anterior = ponto(rx, ry, 0);
  for (let i = 1; i <= N; i++) {
    const p = ponto(rx, ry, (i / N) * 2 * Math.PI);
    acumulado.push(acumulado[i - 1] + Math.hypot(p.x - anterior.x, p.y - anterior.y));
    anterior = p;
  }
  const total = acumulado[N];
  const out: number[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const alvo = ((k + 0.5) / n) * total;
    while (acumulado[i] < alvo) i++;
    out.push((i / N) * 2 * Math.PI);
  }
  return out;
}

function perimetro(rx: number, ry: number) {
  // Ramanujan; folga de sobra para decidir a escala.
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

const arred = (p: PontoXY): PontoXY => ({ x: Math.round(p.x), y: Math.round(p.y) });

export function calcularLayout(e: EntradaLayout): SaidaLayout {
  const setores = e.setores.filter((s) => s.pessoas.length);
  // Um vão do tamanho de uma pessoa entre setores.
  const vagas = setores.reduce((n, s) => n + s.pessoas.length, 0) + setores.length;
  const passo = vagas ? perimetro(ANEL_PESSOAS.rx, ANEL_PESSOAS.ry) / vagas : PASSO_CONFORTAVEL;
  const escala = +Math.min(1, passo / PASSO_CONFORTAVEL).toFixed(3);

  const t = parametrosEquidistantes(Math.max(vagas, 1), ANEL_PESSOAS.rx, ANEL_PESSOAS.ry);
  const pessoas: Record<string, PontoXY> = {};
  const rotulos: RotuloSetor[] = [];
  let vaga = 0;
  for (const s of setores) {
    const inicio = vaga;
    for (const id of s.pessoas) pessoas[id] = arred(ponto(ANEL_PESSOAS.rx, ANEL_PESSOAS.ry, t[vaga++]));
    const meio = (t[inicio] + t[vaga - 1]) / 2;
    const p = ponto(ANEL_PESSOAS.rx + AFASTA_SETOR, ANEL_PESSOAS.ry + AFASTA_SETOR * 0.75, meio);
    const ancora = p.x < CENTRO.x - 80 ? "end" : p.x > CENTRO.x + 80 ? "start" : "middle";
    // Rótulo de setor em cima do anel fica acima; embaixo, abaixo dos nomes.
    const y = p.y > CENTRO.y + ANEL_PESSOAS.ry * 0.6 ? p.y + 26 : p.y;
    rotulos.push({ nome: s.nome, x: Math.round(p.x), y: Math.round(y), ancora });
    vaga++; // o vão
  }

  const agentes: Record<string, PontoXY> = {};
  e.agentes.forEach((id, i) => {
    agentes[id] = arred(ponto(ANEL_AGENTES.rx, ANEL_AGENTES.ry, (i / Math.max(1, e.agentes.length)) * 2 * Math.PI));
  });

  return { escala, nucleo: { ...CENTRO }, pessoas, agentes, setores: rotulos };
}
```

- [ ] **Passo 5: rodar e ajustar até passar**

Run: `cd frontend && npx vitest run src/lib/warroom-layout.test.ts src/lib/warroom-feed.test.ts`
Esperado: PASSA. Se o teste de sobreposição ou de quadro falhar, ajustar
**só as constantes** (`ANEL_PESSOAS`, `AFASTA_SETOR`, `PASSO_CONFORTAVEL`,
`CENTRO`) — nunca afrouxar o teste. Registrar no comentário da constante o
valor final e por quê.

- [ ] **Passo 6: commit**

```bash
git add frontend/src/lib/warroom-feed.ts frontend/src/lib/warroom-feed.test.ts \
        frontend/src/lib/warroom-layout.ts frontend/src/lib/warroom-layout.test.ts
git commit -m "feat(warroom): contrato da TV pública e layout por setor sem sobreposição"
```

---

### Task 4: a tela (`pages/WarRoomPage.tsx`)

**Arquivos:**
- Modificar: `frontend/src/pages/WarRoomPage.tsx`
- Modificar: `frontend/src/styles/warroom.css`

**Interfaces:**
- Consome: `normalizar`, `Feed`, `Pessoa`, `Agente`, `ConversaTime`, `Evento`
  (de `@/lib/warroom-feed`); `calcularLayout`, `QUADRO`, `R_PESSOA`,
  `R_AGENTE` (de `@/lib/warroom-layout`).

Ler o arquivo inteiro antes. Ele tem ~1.020 linhas; o que **fica**: busca do
feed com polling de 15 s e "sem atualizar desde HH:MM", relógio, tema claro/
escuro, tela cheia, tela de erro, cabeçalho com marca e "AO VIVO", hexágono
(`hexagono`), `curva`, `pontoNaCurva`, `pontoNaRota`, halos, anel de contexto
do agente, núcleo, partículas por diferença entre leituras, e todo o
`warroom.css`.

- [ ] **Passo 1: remover o modo de organizar**

Apagar: `CHAVE_LAYOUT`, `Layout`, `lerLayout`, `FRAC_AGENTE`, `FRAC_PESSOA`,
os estados `editando`, `zoom`, `pan`, `posManual`, `sujo`, `salvando`, as
funções `organizar`, `desfazer`, `salvarMapa`, `comecaArrasto` e o arrasto
(`arrasto` ref e handlers de pointer), o `enquadre`, e os botões
mover/zoom/organizar/descartar/salvar do cabeçalho (ficam só tema e tela
cheia). Remover os ícones que sobrarem sem uso do import do `lucide-react`. Na
montagem, limpar o arranjo velho que a TV possa ter guardado:

```ts
// O arranjo arrastável saiu em 16/10/2026: o layout por setor é o produto, e
// um mapa velho guardado na TV sobreporia o novo.
useEffect(() => { try { localStorage.removeItem("warroom_layout"); } catch { /* bloqueado */ } }, []);
```

Remover também tudo de `filhos`, `enxame` e `parceiroAgente` (saíram do
contrato).

- [ ] **Passo 2: posições pelo layout**

O SVG passa a usar `viewBox={`0 0 ${QUADRO.w} ${QUADRO.h}`}` com
`preserveAspectRatio="xMidYMid meet"`. No lugar do `useMemo` de
`posAgente`/`posPessoa`:

```ts
const layout = useMemo(() => calcularLayout({
  setores: feed?.setores ?? [],
  agentes: (feed?.agentes ?? []).map((a) => a.id),
  nomes: Object.fromEntries((feed?.pessoas ?? []).map((p) => [p.id, p.nome])),
}), [feed?.setores, feed?.agentes, feed?.pessoas]);
const posPessoa = useMemo(() => new Map(Object.entries(layout.pessoas)), [layout]);
const posAgente = useMemo(() => new Map(Object.entries(layout.agentes)), [layout]);
const NUCLEO = layout.nucleo;
const rP = R_PESSOA * layout.escala;
```

Onde o código achava a pessoa pelo nome (`feed.pessoas.find((p) => p.nome === a.parceiro)`),
usar o id direto: `posPessoa.get(a.parceiroId ?? "")`.

- [ ] **Passo 3: nó de pessoa com status e presença**

Constantes no topo do arquivo:

```ts
const ROTULO_STATUS: Record<string, string> = {
  reuniao: "em reunião", foco: "foco", almoco: "almoço", ausente: "ausente",
};
/** O status vence a presença: em reunião dentro do escritório é âmbar. */
function corDoPonto(p: Pessoa): string | null {
  if (p.status === "reuniao" || p.status === "foco") return "var(--wr-ambar)";
  if (p.status === "almoco" || p.status === "ausente") return "var(--wr-muted)";
  return p.noEscritorio ? "var(--wr-green)" : null;
}
```

No render de cada pessoa (substitui o bloco atual do hexágono), com
`emConversa` = pessoa é ponta de agente ativo **ou** de `conversasTime`:

```tsx
<g key={p.id} transform={`translate(${pos.x} ${pos.y})`}>
  {emConversa && <polygon points={hexagono(rP + 7)} fill="none" className="wr-hex-halo" strokeWidth={2} opacity={0.5} />}
  <polygon points={hexagono(rP)} className={`wr-corpo-h wr-hex${emConversa ? " wr-viva" : ""}`} />
  <text y={5 * layout.escala} textAnchor="middle" className="wr-sigla-h" fontSize={13 * layout.escala}>
    {p.nome.slice(0, 1)}
  </text>
  {corDoPonto(p) && (
    <circle cx={rP * 0.78} cy={-rP * 0.78} r={4.5 * layout.escala} fill={corDoPonto(p)!}
      stroke="var(--wr-bg)" strokeWidth={1.5} />
  )}
  <text y={rP + 15 * layout.escala} textAnchor="middle" className="wr-nome-h" fontSize={13 * layout.escala}>
    {p.nome}
  </text>
  {p.status && (
    <text y={rP + 29 * layout.escala} textAnchor="middle" className="wr-status-h" fontSize={10.5 * layout.escala}>
      {ROTULO_STATUS[p.status]}
    </text>
  )}
</g>
```

Rótulos de setor, desenhados antes dos nós:

```tsx
{layout.setores.map((s) => (
  <text key={s.nome} x={s.x} y={s.y} textAnchor={s.ancora} className="wr-setor">{s.nome.toUpperCase()}</text>
))}
```

- [ ] **Passo 4: rótulo do agente sem tarefa**

Embaixo do nome do agente, onde era `a.tarefa ?? a.papel`:

```tsx
const parceiro = a.parceiroId ? feed?.pessoas.find((p) => p.id === a.parceiroId)?.nome : null;
const linha2 = a.estado !== "ocioso"
  ? `${parceiro ? `conversando com ${parceiro}` : "trabalhando"} · ${decorrido(a.desde)}`
  : a.papel;
```

- [ ] **Passo 5: linhas entre pessoas (DM)**

Junto das rotas de agente, para cada `c` em `feed.conversasTime` com as duas
pontas em `posPessoa`:

```tsx
{(feed?.conversasTime ?? []).map((c) => {
  const de = posPessoa.get(c.a), para = posPessoa.get(c.b);
  if (!de || !para) return null;
  const t = ((agoraFrame / 2600) % 1);
  const p = pontoNaCurva(de, para, t);
  return (
    <g key={`${c.a}-${c.b}`}>
      <path d={curva(de, para)} className="wr-rota-time" fill="none" />
      <circle cx={p.x} cy={p.y} r={3.5} className="wr-particula-time" />
    </g>
  );
})}
```

`curva(de, para)` já puxa o controle para o núcleo; conferir que a curva entre
duas pessoas do mesmo setor não colapsa numa reta sobre os nomes (se
colapsar, puxar o ponto de controle 35% em direção ao `NUCLEO`). No
cabeçalho, trocar o texto do sinal por:

```ts
const nConversas = ativos.length + (feed?.conversasTime.length ?? 0);
// "time em repouso" | "N conversa(s) agora"
```

- [ ] **Passo 6: Fluxo e rodapé**

O Fluxo renderiza `feed.eventos` como hoje (hora + `e.texto`), com a classe
por tipo: `entrega` mantém a borda verde atual, `agente` azul, `time` ciano.
O rodapé passa a ter quatro blocos:

| rótulo | valor | legenda |
|---|---|---|
| ENTREGAS HOJE | `numeros.entregas` | documentos publicados |
| CONVERSAS ATENDIDAS | `numeros.atendidas` | pessoa × agente, hoje |
| PESSOAS ATIVAS | `numeros.pessoasAtivas` | `de ${feed.pessoas.length} no time` |
| CONVERSAS NO TIME | `numeros.conversasTime` | entre pessoas, hoje |

Apagar o formatador de tokens e de custo.

- [ ] **Passo 7: CSS**

Em `frontend/src/styles/warroom.css`, acrescentar (nos dois temas, seguindo o
padrão das variáveis existentes):

```css
.wr-raiz { --wr-ambar: #f59e0b; --wr-time: #22d3ee; }
.wr-raiz.wr-claro { --wr-ambar: #d97706; --wr-time: #0891b2; }
.wr-setor { fill: var(--wr-muted); font-size: 13px; letter-spacing: 0.32em; font-weight: 600; }
.wr-nome-h { fill: var(--wr-ink); font-weight: 600; }
.wr-status-h { fill: var(--wr-muted); }
.wr-rota-time { stroke: var(--wr-time); stroke-width: 2; stroke-opacity: 0.85; }
.wr-particula-time { fill: var(--wr-time); }
```

Se `--wr-muted`, `--wr-ink`, `--wr-green` ou `--wr-bg` tiverem outro nome no
arquivo, usar o nome que existe (procurar por `--wr-` no topo do CSS).

- [ ] **Passo 8: conferir**

Run: `cd frontend && npx vitest run && npm run lint && npm run build`
Esperado: tudo passa, sem erro de tipo.

Depois, ver renderizado com dados falsos: em `npm run dev`, abrir
`http://localhost:8080/warroom` com o backend local ou, sem backend, trocar
temporariamente a chamada da API por um feed fixo com 28 pessoas, duas DMs e
um agente ativo — **não commitar o feed fixo**. Conferir: nenhum nome
atropelado, linha ciano entre as duas pessoas, ponto de status, rodapé com os
quatro números, Fluxo sem texto de mensagem. Tirar screenshot e deixar o
caminho no relatório.

- [ ] **Passo 9: commit**

```bash
git add frontend/src/pages/WarRoomPage.tsx frontend/src/styles/warroom.css
git commit -m "feat(warroom): tela da TV — anel por setor, DMs, status e Fluxo sem conteúdo"
```
