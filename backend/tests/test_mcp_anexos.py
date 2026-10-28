# backend/tests/test_mcp_anexos.py
"""A identidade do agente no `hsos-anexos` é verificada, não declarada.

⚠️ **Os outros servidores MCP confiam no agente.** `hsos-alerta`,
`hsos-documentos` e `hsos-relatorios` recebem `agente` e `solicitante` como
argumento que o próprio agente preenche — o gateway não repassa quem chama
(`mcp_alerta.py`, 14/08/2026). Para alerta, o pior caso é ruído. Para anexo, é
a planilha de ponto do RH sendo lida por outro agente.

Aqui cada agente tem uma URL própria com um HMAC do id dele. Quem a monta é o
backend; o agente nem vê o segredo. A URL de um não serve para outro.
"""
from app.routers import mcp_anexos as m

SEGREDO = "s3gr3d0-de-teste"


def test_assinatura_e_estavel_e_depende_do_agente():
    a = m.assinatura_do_agente(SEGREDO, "bruce")
    assert a == m.assinatura_do_agente(SEGREDO, "bruce")
    assert a != m.assinatura_do_agente(SEGREDO, "nina")
    assert len(a) == 64


def test_assinatura_normaliza_o_id():
    assert m.assinatura_do_agente(SEGREDO, "Bruce") == m.assinatura_do_agente(SEGREDO, "bruce")


def test_assinatura_confere_so_a_propria():
    assert m.assinatura_confere(SEGREDO, "bruce", m.assinatura_do_agente(SEGREDO, "bruce"))
    assert not m.assinatura_confere(SEGREDO, "nina", m.assinatura_do_agente(SEGREDO, "bruce"))
    assert not m.assinatura_confere(SEGREDO, "bruce", "0" * 64)
    assert not m.assinatura_confere("", "bruce", m.assinatura_do_agente("", "bruce"))


def test_ferramenta_tem_a_regra_na_description():
    """O agente lê a `description`, não o docstring — lição do
    `dias_de_validade` de 08/09/2026."""
    ler = next(f for f in m._FERRAMENTAS if f["name"] == "ler_anexo")
    assert "id" in ler["inputSchema"]["required"]
    assert "pagina" in ler["inputSchema"]["properties"]
    assert "outra conversa" in ler["description"]


def test_falha_de_banco_vira_resposta_mcp_e_nao_500():
    """Erro de banco/R2 dentro do `tools/call` chega ao gateway como
    `isError`, não como 500 cru — o agente precisa de resposta MCP válida;
    a causa fica no log (`logger.exception`)."""
    import asyncio

    def quebra(**_):
        raise RuntimeError("banco fora")

    original = m.sessao
    m.sessao = quebra
    try:
        texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "x"}))
    finally:
        m.sessao = original
    assert erro is True
    assert texto == "Falha interna ao ler o anexo; avise o administrador."


# --- A fronteira de segurança do router ------------------------------------
import asyncio
import json

import pytest

from app import anexos as ax


def _anexo(**kw):
    base = dict(id="a1", caminho="x/y.xlsx", nome="ponto.xlsx", mime="", tamanho=1,
                contexto="conversa_agente", channel_id=None, agent_id="bruce",
                dono_conversa="u1")
    base.update(kw)
    return ax.Anexo(**base)


RUN_ABERTO = {"message_id": None, "idade_s": 60.0}


class _ConnRuns:
    """Conexão falsa: `fetch` devolve os runs que o teste puser em `estado`."""

    def __init__(self, estado):
        self.estado = estado

    async def fetch(self, sql, *a):
        self.estado["consultas"].append((sql, a))
        return self.estado["runs"]


class _Sessao:
    def __init__(self, estado):
        self.estado = estado

    async def __aenter__(self):
        return _ConnRuns(self.estado)

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def isolado(monkeypatch):
    """Banco e R2 falsos; `arm.ler` FALHA se for chamado."""
    estado = {"anexo": None, "membro": False, "runs": [RUN_ABERTO], "consultas": []}

    async def buscar(conn, anexo_id):
        return estado["anexo"]

    async def membro(conn, canal, membro_id, tipo):
        return estado["membro"]

    async def ler_proibido(chave):
        raise AssertionError("arm.ler chamado para anexo que o agente não pode ler")

    monkeypatch.setattr(m, "sessao", lambda **k: _Sessao(estado))
    monkeypatch.setattr(m, "buscar_anexo", buscar)
    monkeypatch.setattr(m, "membro_do_canal", membro)
    monkeypatch.setattr(m.arm, "ler", ler_proibido)
    return estado


def test_agente_nao_le_anexo_da_conversa_de_outro_agente(isolado):
    """Anexo `conversa_agente` do bruce, pedido pela nina: recusado e o R2
    nunca é tocado."""
    isolado["anexo"] = _anexo()
    texto, erro = asyncio.run(m._ler_anexo("nina", {"id": "a1"}))
    assert erro is True and "não pertence" in texto


def test_agente_fora_do_canal_nao_le_anexo_do_canal(isolado):
    isolado["anexo"] = _anexo(contexto="canal", channel_id="c1", agent_id=None)
    isolado["membro"] = False
    texto, erro = asyncio.run(m._ler_anexo("nina", {"id": "a1"}))
    assert erro is True and "não pertence" in texto


def test_pagina_nao_numerica_diz_o_problema_real(isolado):
    async def ler(chave):
        return b"x"

    isolado["anexo"] = _anexo()
    m.arm.ler = ler  # o monkeypatch do fixture restaura no fim
    texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "a1", "pagina": "abc"}))
    assert erro is True
    assert texto == "pagina deve ser um número inteiro a partir de 1."


class _Req:
    def __init__(self, corpo, falha=False):
        self.corpo, self.falha, self.lido = corpo, falha, False

    async def json(self):
        self.lido = True
        return self.corpo


def test_assinatura_errada_da_404_sem_ler_o_corpo(monkeypatch):
    async def segredo(nome):
        return SEGREDO

    monkeypatch.setattr(m, "ler_segredo", segredo)
    from fastapi import HTTPException
    req = _Req({})
    with pytest.raises(HTTPException) as e:
        asyncio.run(m.mcp_anexos("bruce", "0" * 64, req, None))
    assert e.value.status_code == 404 and req.lido is False


def test_corpo_que_nao_e_objeto_da_erro_jsonrpc(monkeypatch):
    async def segredo(nome):
        return SEGREDO

    monkeypatch.setattr(m, "ler_segredo", segredo)
    r = asyncio.run(m.mcp_anexos("bruce", m.assinatura_do_agente(SEGREDO, "bruce"),
                                 _Req([{"jsonrpc": "2.0"}]), None))
    assert json.loads(r.body)["error"]["code"] == -32600


def test_description_diz_o_que_o_codigo_garante():
    ler = next(f for f in m._FERRAMENTAS if f["name"] == "ler_anexo")
    assert "conversa com você" in ler["description"]
    assert "Use apenas ids que apareceram nesta conversa." in ler["description"]
    assert "conversando com você agora" in ler["description"]


def test_enviar_arquivo_existe_e_exige_destino_formato_e_conteudo():
    f = next(f for f in m._FERRAMENTAS if f["name"] == "enviar_arquivo")
    assert set(f["inputSchema"]["required"]) == {"para", "nome", "formato", "conteudo"}
    assert "já conversa" in f["description"]
    assert "conversando com você agora" in f["description"]


def test_pode_enviar_so_para_quem_ja_conversa_com_o_agente():
    """Push é menos grave que pull, mas a planilha do RH mandada ao CEO por
    engano é vazamento do mesmo jeito. Destino tem que ser alguém que já abriu
    conversa com este agente."""
    import asyncio

    class Conn:
        def __init__(self, existe):
            self.existe = existe
            self.args = None

        async def fetchval(self, sql, *args):
            self.args = args
            return self.existe

    conn = Conn(False)
    assert asyncio.run(m._ja_conversa(conn, "bruce", "77071556-7a52-41d5-805a-cbbd3923da45")) is False
    assert conn.args == ("bruce", "77071556-7a52-41d5-805a-cbbd3923da45")
    assert asyncio.run(m._ja_conversa(Conn(True), "bruce", "77071556-7a52-41d5-805a-cbbd3923da45")) is True
    assert asyncio.run(m._ja_conversa(Conn(True), "bruce", "nao-e-uuid")) is False


# ── _enviar_arquivo com banco, R2 e hub falsos ──────────────────────────────

PESSOA = "77071556-7a52-41d5-805a-cbbd3923da45"


class _Conn:
    def __init__(self, existe, falha_em=None, log=None, runs=None):
        self.existe, self.falha_em, self.log = existe, falha_em, log
        self.runs = [RUN_ABERTO] if runs is None else runs

    async def fetch(self, sql, *a):
        return self.runs

    async def fetchval(self, sql, *a):
        return self.existe

    async def execute(self, sql, *a):
        self.log.append((sql, a))
        if self.falha_em and self.falha_em in sql:
            raise RuntimeError("banco caiu")


def _ambiente(monkeypatch, existe=True, falha_em=None, runs=None):
    import contextlib

    log, gravados, apagados, publicados = [], [], [], []

    @contextlib.asynccontextmanager
    async def sessao(role=None):
        yield _Conn(existe, falha_em, log, runs)

    async def gravar(chave, dados, mime):
        gravados.append(chave)

    async def apagar(chave):
        apagados.append(chave)

    monkeypatch.setattr(m, "sessao", sessao)
    monkeypatch.setattr(m.arm, "gravar", gravar)
    monkeypatch.setattr(m.arm, "apagar", apagar)
    return log, gravados, apagados


def _args(para=PESSOA):
    return {"para": para, "nome": "r", "formato": "csv", "conteudo": "a;b\n1;2"}


def test_destino_que_nunca_conversou_nao_escreve_nada(monkeypatch):
    """Recusa antes de montar e antes de tocar no R2 ou no banco."""
    import asyncio
    log, gravados, apagados = _ambiente(monkeypatch, existe=False)
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", _args()))
    assert erro and "já conversa" in texto
    assert gravados == [] and log == []


def test_falha_no_insert_recolhe_os_objetos_do_r2(monkeypatch):
    import asyncio
    log, gravados, apagados = _ambiente(monkeypatch, falha_em="INSERT INTO public.generated_documents")
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", _args()))
    assert erro and "Falha interna" in texto
    assert len(gravados) == 2 and sorted(apagados) == sorted(gravados)


def test_caminho_feliz_grava_anexo_da_conversa_do_agente(monkeypatch):
    import asyncio
    log, gravados, apagados = _ambiente(monkeypatch)
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", _args("{" + PESSOA.upper() + "}")))
    assert not erro and apagados == [] and len(gravados) == 2
    sql, a = next(x for x in log if "INSERT INTO public.anexos" in x[0])
    assert "'conversa_agente'" in sql and "enviado_por_agent" in sql
    assert a[5] == "bruce" and a[6] == PESSOA  # uuid normalizado
    assert any("INSERT INTO public.conversations" in x[0] for x in log)


def test_para_que_nao_e_uuid_e_recusado(monkeypatch):
    import asyncio
    log, gravados, _ = _ambiente(monkeypatch)
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", _args("../x")))
    assert erro and gravados == [] and log == []


# ── A amarra ao turno em curso (decisão do Erick, 13/10/2026) ───────────────
#
# O gateway não diz ao MCP qual sessão nem qual pessoa chama. Sem amarra, o
# agente lia qualquer anexo de conversa com ele e enviava arquivo a qualquer
# pessoa que um dia falou com ele: um id de anexo de B que vazasse para a
# sessão de A (MEMORY.md do agente, a sessão `main`, uma delegação da nina)
# abria o arquivo de B para A, sempre. Com a amarra, só enquanto B tem um
# turno em curso com aquele agente — a janela vai de "sempre" para "durante a
# conversa ativa".

def test_turno_em_curso_exige_run_aberto_e_recente():
    """Run aberto = sem `message_id` (a resposta ainda não foi gravada) e
    criado há menos de 30 minutos. Run respondido ou velho não conta."""
    assert m.algum_turno_aberto([RUN_ABERTO]) is True
    assert m.algum_turno_aberto([]) is False
    assert m.algum_turno_aberto([{"message_id": "m1", "idade_s": 10.0}]) is False
    assert m.algum_turno_aberto([{"message_id": None, "idade_s": 31 * 60.0}]) is False
    assert m.algum_turno_aberto([{"message_id": "m1", "idade_s": 5.0}, RUN_ABERTO]) is True


def test_turno_em_curso_consulta_agente_normalizado_e_a_pessoa():
    """O `agent_id` em `agent_runs` é o da URL do `/send`, cru; o da consulta é
    normalizado, e o SQL normaliza a coluna do mesmo jeito — senão `"Bruce"`
    gravado não casaria com `"bruce"` pedido."""
    estado = {"runs": [RUN_ABERTO], "consultas": []}
    assert asyncio.run(m.turno_em_curso(_ConnRuns(estado), " Openclaw:Bruce ", PESSOA)) is True
    sql, a = estado["consultas"][0]
    assert "public.agent_runs" in sql and "message_id" in sql
    assert a[:2] == ("bruce", PESSOA)


def test_turno_em_curso_com_pessoa_invalida_nem_consulta():
    estado = {"runs": [RUN_ABERTO], "consultas": []}
    assert asyncio.run(m.turno_em_curso(_ConnRuns(estado), "bruce", None)) is False
    assert asyncio.run(m.turno_em_curso(_ConnRuns(estado), "bruce", "nao-e-uuid")) is False
    assert estado["consultas"] == []


def test_ler_anexo_sem_turno_da_dona_e_recusado_sem_tocar_o_r2(isolado):
    """Anexo do próprio bruce, mas a pessoa que o enviou não está conversando
    com ele agora: recusa, e `arm.ler` (que no fixture explode) nunca roda."""
    isolado["anexo"] = _anexo(dono_conversa=PESSOA)
    isolado["runs"] = []
    texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "a1"}))
    assert erro is True
    assert texto == ("Este anexo só pode ser lido enquanto a pessoa que o enviou está "
                     "conversando com você agora. Peça a ela para mandar a mensagem de novo.")
    assert isolado["consultas"][0][1][:2] == ("bruce", PESSOA)


def test_ler_anexo_com_run_ja_respondido_e_recusado(isolado):
    isolado["anexo"] = _anexo(dono_conversa=PESSOA)
    isolado["runs"] = [{"message_id": "m1", "idade_s": 30.0}]
    texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "a1"}))
    assert erro is True and "conversando com você agora" in texto


def test_ler_anexo_com_turno_em_curso_passa(isolado, monkeypatch):
    async def ler(chave):
        return b"a;b\n1;2\n"

    monkeypatch.setattr(m.arm, "ler", ler)
    isolado["anexo"] = _anexo(dono_conversa=PESSOA, nome="r.csv", mime="text/csv")
    texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "a1"}))
    assert erro is False and texto.startswith("r.csv")


def test_anexo_de_canal_nao_depende_de_turno(isolado, monkeypatch):
    """Canal não passa por `agent_runs`: vale a regra de membro, e só ela."""
    async def ler(chave):
        return b"a;b\n1;2\n"

    monkeypatch.setattr(m.arm, "ler", ler)
    isolado["anexo"] = _anexo(contexto="canal", channel_id="c1", agent_id=None,
                              dono_conversa=None, nome="r.csv", mime="text/csv")
    isolado["membro"] = True
    isolado["runs"] = []
    texto, erro = asyncio.run(m._ler_anexo("bruce", {"id": "a1"}))
    assert erro is False and isolado["consultas"] == []


def test_enviar_sem_turno_do_destino_nao_escreve_nada(monkeypatch):
    """Destino que já conversou com o bruce, mas não está conversando agora:
    recusa antes de montar o arquivo, sem R2 e sem banco."""
    log, gravados, apagados = _ambiente(monkeypatch, runs=[])
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", _args()))
    assert erro is True
    assert texto == "Só posso enviar arquivo para quem está conversando comigo agora."
    assert gravados == [] and log == []


def test_enviar_com_run_ja_respondido_nao_escreve_nada(monkeypatch):
    log, gravados, _ = _ambiente(monkeypatch, runs=[{"message_id": "m1", "idade_s": 5.0}])
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", _args()))
    assert erro is True and gravados == [] and log == []


# ── relatorio_ponto — só o bruce, e só com os anexos da pessoa em turno ─────
#
# A planilha de ponto do RH traz nome e horário de cada funcionário. A ferramenta
# mora aqui porque este servidor verifica o agente pela URL e a posse do anexo;
# nos servidores que confiam no argumento, outro agente a chamaria.

import dataclasses

PONTO_M = "﻿Nome;Matrícula;Departamento;Data da Marcação;Tipo Marcação 1;Hora da Marcação 1\nAna Teste;000001;LAB;01/09/2026;Original;07:55\n".encode()
PONTO_E = "﻿Matrícula;Nome;EventoId;Motivo;Descrição;Justificativa;CID;Data Inicio;Data Fim;Hora Inicio;Hora Fim;Qtde;Status\n000001;Ana Teste;9000001;Férias;;;;02/09/2026;03/09/2026;;;2 Dias;Aprovado\n".encode()
PONTO_B = "﻿Ano;Mês;Matrícula;Nome;Saldo banco total\n2026;9;000001;Ana Teste;(-01:00)\n".encode()
# Cálculo Diário (v2.1) com CPF e PIS inventados — não podem voltar no resumo.
PONTO_C = ("﻿Nome;Matrícula;CPF;PIS;Data;Natureza Dia;Marcações Válidas;Jornada Considerada;"
           "Horas Trabalhadas;Eventos\nAna Teste;000001;CPFSECRETO;PISSECRETO;01/09/2026;Trabalho;07:55;"
           "Trabalho com horas negativas;00:00;-\n").encode()


def test_relatorio_ponto_so_aparece_para_o_bruce():
    assert "relatorio_ponto" in [f["name"] for f in m.ferramentas_de("bruce")]
    assert "relatorio_ponto" not in [f["name"] for f in m.ferramentas_de("nina")]
    assert {"ler_anexo", "enviar_arquivo"} <= {f["name"] for f in m.ferramentas_de("nina")}


def test_description_do_relatorio_ponto_diz_que_eventos_e_obrigatorio():
    """Na homologação de 10/2026 vieram três CSV, a ferramenta aceitava dois e o
    `bruce` calculou de cabeça — errado. A regra mora onde ele lê."""
    f = next(f for f in m._FERRAMENTAS if f["name"] == "relatorio_ponto")
    assert "OBRIGATÓRIOS" in f["description"] and "Eventos" in f["description"]
    assert "publicar_pagina" in f["description"]
    ids = f["inputSchema"]["properties"]["ids"]
    assert (ids["minItems"], ids["maxItems"]) == (2, 4)
    # v2.1: o quarto arquivo é opcional, e a description diz que é recomendado.
    assert "CalculoDiario" in f["description"] and "recomendado" in f["description"]


def test_outro_agente_chamando_relatorio_ponto_recebe_ferramenta_desconhecida(monkeypatch):
    """Esconder no `tools/list` não basta: o `tools/call` tem que recusar também."""
    async def segredo(nome):
        return SEGREDO

    async def proibido(*a, **k):
        raise AssertionError("relatorio_ponto executado para a nina")

    monkeypatch.setattr(m, "ler_segredo", segredo)
    monkeypatch.setattr(m, "_relatorio_ponto", proibido)
    corpo = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
             "params": {"name": "relatorio_ponto", "arguments": {"ids": ["a", "b"]}}}
    r = asyncio.run(m.mcp_anexos("nina", m.assinatura_do_agente(SEGREDO, "nina"), _Req(corpo), None))
    assert json.loads(r.body)["error"]["code"] == -32601


@pytest.fixture
def ponto(isolado, monkeypatch):
    """Quatro anexos da mesma pessoa, em turno; um R2 em dicionário; a entrega é capturada."""
    anexos = {k: _anexo(id=k, caminho=k, nome=n, dono_conversa=PESSOA)
              for k, n in (("m", "Marcacoes.csv"), ("e", "Eventos.csv"), ("b", "BancoHoras.csv"),
                           ("c", "CalculoDiario.csv"))}
    r2 = {"anexos/m": PONTO_M, "anexos/e": PONTO_E, "anexos/b": PONTO_B, "anexos/c": PONTO_C}
    entregas = []

    async def buscar(conn, anexo_id):
        return anexos.get(anexo_id)

    async def ler(chave):
        return r2.get(chave)

    async def gravar(chave, dados, mime):
        r2[chave] = dados

    async def listar(prefixo, recursivo=False):
        return [{"chave": k, "nome": k.rsplit("/", 1)[-1], "tamanho": len(v)}
                for k, v in sorted(r2.items()) if k.startswith(prefixo)]

    async def entregar(agent_id, para, nome, dados, mime):
        entregas.append((agent_id, para, nome, dados))
        return "Enviado.", False

    monkeypatch.setattr(m, "buscar_anexo", buscar)
    monkeypatch.setattr(m.arm, "ler", ler)
    monkeypatch.setattr(m.arm, "gravar", gravar)
    monkeypatch.setattr(m.arm, "listar", listar)
    monkeypatch.setattr(m, "_entregar", entregar)
    isolado.update(anexos=anexos, entregas=entregas, r2=r2)
    return isolado


def _historicos(r2):
    return {k: json.loads(v) for k, v in r2.items() if k.startswith("ponto-historico/")}


def test_relatorio_ponto_entrega_ao_dono_e_grava_o_historico(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["b", "e", "m"]}))
    assert not erro, texto
    [(agente, para, nome, dados)] = ponto["entregas"]
    assert (agente, para, nome) == ("bruce", PESSOA, "Controle de jornada - SETEMBRO-2026.xlsx")
    assert dados[:2] == b"PK"  # xlsx é zip
    assert "SETEMBRO/2026" in texto and "Enviado." in texto and "Ana" not in texto
    [(chave, h)] = _historicos(ponto["r2"]).items()
    assert chave.startswith(f"ponto-historico/2026-09/{m.ponto.VERSAO_REGUA}-")
    assert "Ana" not in json.dumps(h) and set(h["por_matricula"]) == {"1"}


def test_relatorio_ponto_aceita_o_calculo_diario_como_quarto_arquivo(ponto):
    """v2.1: o Cálculo Diário é opcional mas recomendado; com ele são 4 ids.
    O export de Eventos de setembro/2026 não trazia 5 dias de férias que o
    FLASH conhecia — é o Cálculo que os tira do denominador."""
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["c", "b", "e", "m"]}))
    assert not erro, texto
    assert len(ponto["entregas"]) == 1
    assert "Cálculo Diário: marcações iguais em 1 de 1 dias" in texto
    assert "SECRETO" not in texto
    [(_, h)] = _historicos(ponto["r2"]).items()
    assert h["com_calculo_diario"] is True and "SECRETO" not in json.dumps(h)


def test_relatorio_ponto_sem_calculo_avisa_que_ele_faltou(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e"]}))
    assert not erro and "Sem o CSV de Cálculo Diário" in texto


def test_relatorio_ponto_sem_banco_funciona(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e"]}))
    assert not erro, texto
    assert len(ponto["entregas"]) == 1


def test_relatorio_ponto_compara_com_o_mes_anterior_da_mesma_regua(ponto):
    totais = {a: {"identificadas": 0, "justificadas": 0, "pendentes": 0, "denominador": 10, "pessoas": 0}
              for a in m.ponto.INDICADORES}
    ant = {"periodo": "2026-08", "versao_regua": m.ponto.VERSAO_REGUA, "gerado_em": "2026-09-01",
           "totais": totais}
    ponto["r2"]["ponto-historico/2026-08/x.json"] = json.dumps(ant).encode()
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e"]}))
    assert not erro and "Comparado com AGOSTO/2026" in texto


def test_relatorio_ponto_entrega_mesmo_se_o_historico_falhar(ponto, monkeypatch):
    """O histórico é acessório: a planilha do mês vale sozinha."""
    async def quebra(*a, **k):
        raise RuntimeError("R2 fora")
    monkeypatch.setattr(m.arm, "listar", quebra)
    monkeypatch.setattr(m.arm, "gravar", quebra)
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e"]}))
    assert not erro and len(ponto["entregas"]) == 1
    assert "histórico deste mês não foi gravado" in texto and "sem comparação" in texto


def test_relatorio_ponto_sem_eventos_diz_o_que_falta(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "b"]}))
    assert erro and "eventos" in texto and "obrigatório" in texto and ponto["entregas"] == []
    assert _historicos(ponto["r2"]) == {}


@pytest.mark.parametrize("ids", [["m"], ["m", "e", "b", "c", "x"], "m,e", ["m", ""]])
def test_relatorio_ponto_exige_de_2_a_4_ids(ponto, ids):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ids}))
    assert erro and "2 a 4" in texto and ponto["entregas"] == []


def test_relatorio_ponto_recusa_anexos_de_pessoas_diferentes_sem_ler_o_r2(ponto, monkeypatch):
    ponto["anexos"]["b"] = dataclasses.replace(ponto["anexos"]["b"], dono_conversa="00000000-0000-4000-8000-0000000000b2")

    async def ler_proibido(chave):
        raise AssertionError("leu o R2 com anexos de duas pessoas")
    monkeypatch.setattr(m.arm, "ler", ler_proibido)
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e", "b"]}))
    assert erro and "mesma pessoa" in texto and ponto["entregas"] == []


def test_relatorio_ponto_com_id_repetido(ponto):
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e", "m"]}))
    assert erro and "repetido" in texto and ponto["entregas"] == []


def test_relatorio_ponto_sem_turno_e_recusado(ponto):
    ponto["runs"] = []
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "e"]}))
    assert erro and texto == m._FORA_DO_TURNO_LER and ponto["entregas"] == []


def test_relatorio_ponto_com_id_de_fora_da_conversa_nao_toca_o_r2(ponto, monkeypatch):
    async def ler_proibido(chave):
        raise AssertionError("leu o R2 com um anexo que não é da conversa")
    monkeypatch.setattr(m.arm, "ler", ler_proibido)
    texto, erro = asyncio.run(m._relatorio_ponto("bruce", {"ids": ["m", "nao-existe"]}))
    assert erro and "não pertence" in texto and ponto["entregas"] == []


def test_enviar_arquivo_com_erro_que_nao_e_valueerror_vira_resposta_mcp(monkeypatch):
    """Depois de extrair o `_entregar`, só `ValueError` era tratado na montagem.
    Um caractere de controle no CSV faz o openpyxl levantar `IllegalCharacterError`
    — e o gateway recebia 500 cru, que pausa o servidor MCP."""
    import asyncio
    log, gravados, _ = _ambiente(monkeypatch)
    texto, erro = asyncio.run(m._enviar_arquivo("bruce", {
        "para": PESSOA, "nome": "x", "formato": "xlsx", "conteudo": "a\x01b;c"}))
    assert erro and "Falha interna" in texto and gravados == []
