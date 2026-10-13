# backend/tests/test_anexos.py
"""Quem lê um anexo de conversa — e como ele aparece para o agente.

⚠️ **Anexo de conversa era público até 13/10/2026.** Ia para `agent-files`,
bucket de leitura aberta, e quem tivesse a URL abria sem login. A primeira
pessoa liberada depois do CEO é do RH e vai mandar planilha de ponto, com nome
e horário de cada funcionário. A regra agora é participar da conversa, e ela
mora aqui, em função pura, para ser testada sem banco.

⚠️ **Sem atalho para administrador.** Anexo é da conversa. A porta de
documento gerado já não abre exceção para admin, e duas regras diferentes para
arquivos parecidos é o que produz o próximo buraco.
"""
from app import anexos as ax

PESSOA = "77071556-7a52-41d5-805a-cbbd3923da45"
OUTRA = "2e4c31db-aab1-4d0a-a8cd-19f6da3ae32f"
CANAL = "5b0d2a43-8f1e-4a7b-9b4e-1d2c3f4a5b6c"


def _anexo(**kw):
    base = dict(id="a1", caminho="conversa/bruce/a1/ponto.xlsx", nome="ponto.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                tamanho=2_411_724, contexto="conversa_agente", channel_id=None,
                agent_id="bruce", dono_conversa=PESSOA)
    base.update(kw)
    return ax.Anexo(**base)


CANAL_ANEXO = dict(contexto="canal", channel_id=CANAL, agent_id=None, dono_conversa=None,
                   caminho=f"canal/{CANAL}/a1/ponto.xlsx")


# ── pessoa ──────────────────────────────────────────────────────────────────

def test_dona_da_conversa_le():
    assert ax.pessoa_pode_ler(_anexo(), PESSOA, membro_do_canal=False)


def test_outra_pessoa_nao_le_conversa_alheia_com_agente():
    assert not ax.pessoa_pode_ler(_anexo(), OUTRA, membro_do_canal=False)


def test_membro_le_anexo_do_canal():
    assert ax.pessoa_pode_ler(_anexo(**CANAL_ANEXO), OUTRA, membro_do_canal=True)


def test_quem_nao_e_membro_nao_le_anexo_do_canal():
    assert not ax.pessoa_pode_ler(_anexo(**CANAL_ANEXO), OUTRA, membro_do_canal=False)


def test_ser_membro_de_algum_canal_nao_abre_conversa_com_agente():
    """`membro_do_canal=True` só vale para contexto canal — passar True por
    engano numa conversa com agente não pode abrir a porta."""
    assert not ax.pessoa_pode_ler(_anexo(), OUTRA, membro_do_canal=True)


# ── agente ──────────────────────────────────────────────────────────────────

def test_agente_da_conversa_le():
    assert ax.agente_pode_ler(_anexo(), "bruce", agente_no_canal=False)


def test_outro_agente_nao_le_conversa_alheia():
    """O vazamento que esta frente existe para impedir: a planilha do RH
    mandada ao Bruce não pode ser lida pela Nina só porque ela tem o id."""
    assert not ax.agente_pode_ler(_anexo(), "nina", agente_no_canal=False)


def test_agente_membro_le_anexo_do_canal():
    assert ax.agente_pode_ler(_anexo(**CANAL_ANEXO), "nina", agente_no_canal=True)


def test_agente_fora_do_canal_nao_le():
    assert not ax.agente_pode_ler(_anexo(**CANAL_ANEXO), "nina", agente_no_canal=False)


def test_id_de_agente_e_comparado_normalizado():
    """O gateway às vezes devolve o id com maiúscula; o banco guarda minúsculo."""
    assert ax.agente_pode_ler(_anexo(), "Bruce", agente_no_canal=False)


# ── nome e caminho ──────────────────────────────────────────────────────────

def test_nome_com_acento_espaco_e_parenteses_vira_chave_segura():
    assert ax.nome_saneado("Relatório Ponto Março (final).xlsx") == "Relatorio-Ponto-Marco-final.xlsx"


def test_nome_so_de_simbolos_vira_arquivo():
    assert ax.nome_saneado("???.") == "arquivo"


def test_nome_muito_longo_e_cortado_preservando_a_extensao():
    n = ax.nome_saneado("a" * 300 + ".xlsx")
    assert len(n) <= 100 and n.endswith(".xlsx")


def test_caminho_passa_na_validacao_de_chave():
    """Se o saneamento deixar escapar algo que `arm.chave` recusa, o upload
    falha com 400 para um nome comum — o pior jeito de descobrir."""
    from app import armazenamento as arm
    c = ax.caminho_do_anexo("a1", "conversa_agente", "bruce", "Relatório Ponto Março (final).xlsx")
    assert arm.chave("anexos", c) == f"anexos/conversa/bruce/a1/Relatorio-Ponto-Marco-final.xlsx"


# ── como o agente vê ────────────────────────────────────────────────────────

def test_linha_de_anexo_tem_nome_tamanho_tipo_e_id():
    assert ax.linha_de_anexo(_anexo()) == "[anexo: ponto.xlsx · 2,3 MB · planilha · id=a1]"


def test_tamanho_legivel_em_portugues():
    assert ax.tamanho_legivel(512) == "512 B"
    assert ax.tamanho_legivel(2_411_724) == "2,3 MB"
    assert ax.tamanho_legivel(15_360) == "15 KB"


def test_tipo_legivel_pela_extensao_quando_o_mime_e_generico():
    """O navegador manda `application/octet-stream` para `.xls` com frequência."""
    assert ax.tipo_legivel("ponto.xls", "application/octet-stream") == "planilha"
    assert ax.tipo_legivel("ponto.csv", "text/csv") == "planilha"
    assert ax.tipo_legivel("a.pdf", "application/pdf") == "pdf"
    assert ax.tipo_legivel("a.png", "image/png") == "imagem"


# ── a rota e o banco ────────────────────────────────────────────────────────
import asyncio
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

from app import armazenamento as arm
from app.dependencies import Usuario
from app.routers import anexos as rota


class ConnFalsa:
    """Responde só o que a rota pergunta; registra se foi tocada."""

    def __init__(self, linha=None, membro=False, agente_existe=True, pode_ver=True, erro=None):
        self.linha, self.membro, self.agente_existe = linha, membro, agente_existe
        self.pode_ver, self.erro, self.chamadas = pode_ver, erro, 0

    async def fetchrow(self, sql, *a):
        self.chamadas += 1
        if self.erro:
            raise self.erro
        return self.linha

    async def fetchval(self, sql, *a):
        self.chamadas += 1
        if "channel_members" in sql:
            return self.membro
        if "agent_profiles" in sql:
            return self.agente_existe
        return self.pode_ver


def _usa(monkeypatch, conn):
    @asynccontextmanager
    async def sessao(**kw):
        yield conn
    monkeypatch.setattr(rota, "sessao", sessao)

    async def url_get(k, s, nome_download=None, inline=True):
        return f"https://r2/{k}?inline={inline}"
    monkeypatch.setattr(arm, "url_get", url_get)


def _linha(**kw):
    base = dict(id="a1", caminho="conversa/bruce/a1/ponto.xlsx", nome="ponto.xlsx", mime="x",
                tamanho=10, contexto="conversa_agente", channel_id=None, agent_id="bruce",
                dono_conversa=PESSOA)
    base.update(kw)
    return base


def _eu(i):
    return Usuario(id=i, email="x@x", papel="colaborador")


def test_id_malformado_nao_toca_o_banco():
    c = ConnFalsa()
    assert asyncio.run(rota.buscar_anexo(c, "nao-e-uuid")) is None
    assert c.chamadas == 0


def test_erro_de_banco_propaga_e_nao_vira_404():
    """017 não aplicada = `relation "anexos" does not exist`; isso tem que
    aparecer como erro, não como "Anexo não encontrado" (lição de 18/09)."""
    c = ConnFalsa(erro=RuntimeError("relation anexos does not exist"))
    with pytest.raises(RuntimeError):
        asyncio.run(rota.buscar_anexo(c, "5b0d2a43-8f1e-4a7b-9b4e-1d2c3f4a5b6c"))


UUID_A = "5b0d2a43-8f1e-4a7b-9b4e-1d2c3f4a5b6c"


def test_url_dono_recebe_url(monkeypatch):
    _usa(monkeypatch, ConnFalsa(linha=_linha()))
    r = asyncio.run(rota.url_do_anexo(UUID_A, _eu(PESSOA)))
    assert r.url == "https://r2/anexos/conversa/bruce/a1/ponto.xlsx?inline=False"


def test_url_outra_pessoa_recebe_404(monkeypatch):
    _usa(monkeypatch, ConnFalsa(linha=_linha()))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.url_do_anexo(UUID_A, _eu(OUTRA)))
    assert e.value.status_code == 404


def test_url_canal_sem_ser_membro_recebe_404(monkeypatch):
    _usa(monkeypatch, ConnFalsa(linha=_linha(contexto="canal", channel_id=CANAL, agent_id=None,
                                             dono_conversa=None), membro=False))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.url_do_anexo(UUID_A, _eu(OUTRA)))
    assert e.value.status_code == 404


def test_url_canal_membro_recebe_url(monkeypatch):
    _usa(monkeypatch, ConnFalsa(linha=_linha(contexto="canal", channel_id=CANAL, agent_id=None,
                                             dono_conversa=None), membro=True))
    assert asyncio.run(rota.url_do_anexo(UUID_A, _eu(OUTRA))).url.startswith("https://r2/")


class _In:
    def __init__(self, **kw):
        base = dict(tamanho=10, nome="a.xlsx", mime="x", contexto="conversa_agente",
                    channel_id=None, agent_id="bruce")
        base.update(kw)
        self.__dict__.update(base)


def test_canal_com_id_invalido_e_400(monkeypatch):
    _usa(monkeypatch, ConnFalsa())
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.iniciar_anexo(_In(contexto="canal", channel_id="xx", agent_id=None), _eu(PESSOA)))
    assert e.value.status_code == 400


def test_agente_sem_perfil_e_404_mesmo_com_pode_ver(monkeypatch):
    """`pode_ver_agente` libera id sem perfil; para anexar o agente tem que existir."""
    _usa(monkeypatch, ConnFalsa(agente_existe=False, pode_ver=True))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.iniciar_anexo(_In(agent_id="fantasma"), _eu(PESSOA)))
    assert e.value.status_code == 404


@pytest.mark.parametrize("mime,esperado", [
    ("image/svg+xml", False), ("text/html", False), ("application/xhtml+xml", False),
    ("text/xml", False), ("", False), ("application/octet-stream", False),
    ("image/png", True), ("image/jpeg", True), ("application/pdf", True),
    ("audio/mpeg", True), ("video/mp4", True), ("text/plain", True),
    ("TEXT/HTML; charset=utf-8", False), ("text/plain; charset=utf-8", True),
])
def test_so_tipo_inofensivo_abre_no_navegador(mime, esperado):
    """HTML e SVG abertos inline pela URL assinada viram página ativa servida
    pelo domínio do R2 (XSS armazenado). Só a allowlist abre; o resto baixa."""
    assert ax.exibe_inline(mime) is esperado
