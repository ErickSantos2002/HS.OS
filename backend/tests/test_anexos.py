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
