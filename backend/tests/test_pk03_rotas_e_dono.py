"""PK-03 (24/11/2026) — rotas fechadas por papel e o dono do relatório.

⚠️ **O que custava, em duas frentes:**

1. **Consumo e sessões abertos a qualquer logado.** `GET /uso/eventos`,
   `/uso/snapshots` e `/uso/estatisticas-de-agente` estavam em "só logado",
   enquanto as duas telas que os usam (`/monitoring`, `/analytics`) são de
   administrador. Com um Guardi por pessoa, 58% dos eventos são de `*-bot`: o
   `agent_id` diz **quando e quanto cada colaborador usa** o próprio Guardi.
   `GET /gateway/agents` e `/gateway/sessions` devolviam o `agents.list` e o
   `sessions.list` crus — quem conversa com qual agente, inclusive os Guardis
   dos outros —, passando por cima do `_pode_ver` do `GET /agents`. Nenhum
   front chamava essas duas.

2. **Relatório sem `solicitante` caía no administrador mais antigo.** Três
   das quatro ferramentas do `hsos-relatorios` gravam arquivo com dado
   financeiro (inadimplência, compradores, vendedores) nos Documentos do dono.
   No DN.OS esse desenho mandou o painel de uma pessoa para a conta de outra
   (17 de 17 envios sem destinatário). Agora sem `solicitante` válido a
   ferramenta recusa e diz ao agente de onde tirá-lo.

   ⚠️ A **wiki** fica de fora de propósito: lá o fallback é decisão (17/08) e
   é o caminho dos briefings — 326 documentos de `atlas`/`iris`/`flow` sem
   pessoa pedindo —, o documento vai para a base que todos leem, e a resposta
   avisa o agente.
"""
import asyncio

from app.routers import gateway, uso
from app.routers.relatorios import _SEM_SOLICITANTE, _dono_do_pedido


def _papeis_da_rota(router, caminho: str, metodo: str = "GET"):
    """Os papéis exigidos pela rota, lidos da dependência `exige_papel`."""
    for r in router.routes:
        if getattr(r, "path", "").endswith(caminho) and metodo in getattr(r, "methods", set()):
            for d in r.dependant.dependencies:
                papeis = getattr(d.call, "papeis", None)
                if papeis is not None:
                    return set(papeis)
            return None
    raise AssertionError(f"rota {caminho} não encontrada")


def test_consumo_e_so_do_administrador():
    for caminho in ("/eventos", "/snapshots", "/estatisticas-de-agente"):
        assert _papeis_da_rota(uso.router, caminho) == {"administrador"}, caminho


def test_agents_e_sessions_crus_do_gateway_sao_so_do_administrador():
    for caminho in ("/agents", "/sessions"):
        assert _papeis_da_rota(gateway.router, caminho) == {"administrador"}, caminho


class _Conn:
    def __init__(self, existe: set[str]):
        self.existe, self.sql = existe, []

    async def fetchval(self, sql, *args):
        self.sql.append(sql)
        return args[0] if args and args[0] in self.existe else None


ANA = "11111111-1111-1111-1111-111111111111"


def test_solicitante_valido_e_o_dono():
    assert asyncio.run(_dono_do_pedido(_Conn({ANA}), ANA)) == ANA


def test_sem_solicitante_nao_cai_no_administrador():
    for valor in (None, "", "nicholson", "22222222-2222-2222-2222-222222222222"):
        conn = _Conn({ANA})
        assert asyncio.run(_dono_do_pedido(conn, valor)) is None, valor
        assert not any("administrador" in s for s in conn.sql), valor


def test_a_recusa_ensina_o_agente_a_achar_o_id():
    assert "hsos-" in _SEM_SOLICITANTE and "solicitante" in _SEM_SOLICITANTE


def test_o_schema_das_quatro_ferramentas_exige_o_solicitante():
    """A recusa no servidor é a trava; o `required` é o que faz o agente não
    esquecer antes de chamar."""
    from app.routers.relatorios import _FERRAMENTAS
    nomes = {"publicar_pagina", "relatorio_vendedores", "compradores_produto", "inadimplencia"}
    vistas = {f["name"]: f for f in _FERRAMENTAS if f["name"] in nomes}
    assert set(vistas) == nomes
    for nome, f in vistas.items():
        assert "solicitante" in f["inputSchema"]["required"], nome
