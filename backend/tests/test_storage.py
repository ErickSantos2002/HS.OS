"""Quem pode ler um arquivo de bucket privado.

⚠️ **A conferência de dono existia numa porta e faltava na outra.**
`GET /storage/documento/{id}` confere que a linha em `generated_documents` é de
quem pediu — e devolve 404, não 403, para quem não é dono nem descobrir que o
documento existe. Depois devolve uma URL `/storage/privado/generated-documents/…`
que, até 31/08/2026, servia o arquivo a **qualquer pessoa autenticada**.

Ou seja: a checagem gate descobrir o caminho, não ler o arquivo. E o caminho é
adivinhável — `{user_id}/{doc_id}.xlsx`, com o user_id visível em várias telas.

O docstring daquele endpoint dizia que o efeito de segurança era "o mesmo —
melhor, até" que a URL assinada do Supabase. Não era: a URL assinada valia para
um arquivo, o token vale para o bucket inteiro.

⚠️ **Sem exceção para administrador, de propósito** — a porta que já funcionava
não tem, e inventar regra diferente nas duas faz a diferença virar bug depois.
"""
from app.routers import storage as s

DONO = "77071556-7a52-41d5-805a-cbbd3923da45"
OUTRO = "2e4c31db-aab1-4d0a-a8cd-19f6da3ae32f"
CAMINHO = f"{DONO}/8c6c6c1e-f730-422b-8baf-6f027c886226.xlsx"


def test_o_dono_le_o_proprio_documento():
    assert s._pode_ler_privado("generated-documents", CAMINHO, DONO) is True


def test_outra_pessoa_autenticada_nao_le():
    assert s._pode_ler_privado("generated-documents", CAMINHO, OUTRO) is False


def test_administrador_tambem_nao_le_o_de_outro():
    """A porta de `/documento/{id}` não abre exceção para admin; esta também não."""
    assert s._pode_ler_privado("generated-documents", CAMINHO, OUTRO) is False


def test_company_docs_segue_sendo_da_empresa():
    """Documento da empresa é company-wide por desenho — ver o cabeçalho do
    módulo. Apertar aqui quebraria a aba Empresa sem ganho."""
    assert s._pode_ler_privado("company-docs", "perfil/contrato.pdf", OUTRO) is True


def test_caminho_sem_dono_reconhecivel_falha_fechado():
    """Arquivo solto na raiz do bucket não tem dono declarado. Negar é o certo:
    o contrário faz um caminho malformado virar chave mestra."""
    assert s._pode_ler_privado("generated-documents", "solto.xlsx", DONO) is False


def test_prefixo_parecido_nao_engana():
    """`<uuid-do-dono>maiscoisa/` não é o diretório do dono."""
    assert s._pode_ler_privado("generated-documents", f"{DONO}x/a.xlsx", DONO) is False


# ── Fase R2: o upload em dois passos ────────────────────────────────────────
#
# O navegador sobe direto para o R2 com um PUT assinado; o backend só autoriza
# (`iniciar`) e confere (`concluir`). O ticket carrega o que foi autorizado,
# para o `concluir` não confiar no que o cliente manda de novo.
import pytest
from fastapi import HTTPException

from app.armazenamento import TAMANHO_MAXIMO, Objeto


@pytest.mark.parametrize("tamanho", [1, TAMANHO_MAXIMO])
def test_tamanho_dentro_do_limite_passa(tamanho):
    s._validar_tamanho(tamanho)


def test_cem_mega_e_um_byte_e_recusado_com_413():
    with pytest.raises(HTTPException) as e:
        s._validar_tamanho(TAMANHO_MAXIMO + 1)
    assert e.value.status_code == 413
    assert "100 MB" in e.value.detail


def test_arquivo_vazio_e_recusado_com_mensagem():
    """Arquivo de 0 byte é quase sempre engano (atalho, exportação que falhou).
    Aceitar criaria uma bolha de anexo que abre em branco."""
    with pytest.raises(HTTPException) as e:
        s._validar_tamanho(0)
    assert e.value.status_code == 400
    assert "vazio" in e.value.detail


def test_ticket_ida_e_volta_para_a_mesma_pessoa():
    t = s.emitir_ticket({"bucket": "agent-files", "caminho": "a/b.png", "tamanho": 3}, DONO)
    assert s.ler_ticket(t, DONO)["caminho"] == "a/b.png"


def test_ticket_de_outra_pessoa_e_recusado():
    """Sem isto, quem interceptasse o ticket de alguém concluiria o upload
    dele — e, nos anexos, gravaria a linha em nome dele."""
    t = s.emitir_ticket({"bucket": "agent-files", "caminho": "a/b.png", "tamanho": 3}, DONO)
    with pytest.raises(HTTPException) as e:
        s.ler_ticket(t, OUTRO)
    assert e.value.status_code == 400


def test_ticket_adulterado_e_recusado():
    t = s.emitir_ticket({"bucket": "agent-files", "caminho": "a/b.png", "tamanho": 3}, DONO)
    with pytest.raises(HTTPException):
        s.ler_ticket(t[:-2] + "xx", DONO)


def test_conclusao_sem_objeto_no_r2_diz_que_nao_chegou():
    """É o sintoma de CORS errado: o PUT morreu no navegador e o `concluir`
    chega mesmo assim. A mensagem precisa apontar para o envio, não para o
    servidor."""
    with pytest.raises(HTTPException) as e:
        s._conferir_conclusao(None, 10)
    assert e.value.status_code == 400
    assert "não chegou" in e.value.detail


def test_conclusao_com_tamanho_diferente_e_recusada():
    with pytest.raises(HTTPException) as e:
        s._conferir_conclusao(Objeto(tamanho=9, mime="text/plain"), 10)
    assert e.value.status_code == 400


def test_conclusao_com_tamanho_certo_passa():
    s._conferir_conclusao(Objeto(tamanho=10, mime="text/plain"), 10)


def test_anexo_nao_e_lido_pela_porta_privada_generica():
    """Anexo tem regra própria (participar da conversa). A porta
    `/storage/privado/` só conhece dono por pasta — se aceitasse `anexos`,
    seria uma segunda regra para o mesmo arquivo."""
    assert s._pode_ler_privado("anexos", f"{DONO}/x/a.pdf", DONO) is False


# ── Rodada de correção 1: ticket não é login, e as portas conferem dono ─────
import jwt as _jwt

from app.auth import security


def test_ticket_nao_serve_de_token_de_login():
    """O ticket é assinado com o mesmo segredo do login. Sem `aud`, ele valeria
    como Bearer de sessão completa por 15 min. Com `aud`, o `ler_token` do
    login (que não passa `audience`) o recusa."""
    t = s.emitir_ticket({"bucket": "agent-files", "caminho": "a/b.png", "tamanho": 3}, DONO)
    with pytest.raises(_jwt.PyJWTError):
        security.ler_token(t)


def test_token_de_login_nao_serve_de_ticket():
    token, _ = security.emitir_token(DONO, "colaborador", "a@b.c")
    with pytest.raises(HTTPException) as e:
        s.ler_ticket(token, DONO)
    assert e.value.status_code == 400


def test_extracao_recusa_anexos():
    """Anexo tem porta própria; esta seria uma segunda regra de leitura."""
    with pytest.raises(HTTPException) as e:
        s._conferir_extracao("anexos", f"{DONO}/x/a.pdf", DONO)
    assert e.value.status_code == 400
    assert "anexos" in e.value.detail


def test_extracao_nao_le_documento_gerado_de_outro():
    with pytest.raises(HTTPException) as e:
        s._conferir_extracao("generated-documents", CAMINHO, OUTRO)
    assert e.value.status_code == 404


def test_extracao_le_o_proprio_documento_gerado_e_company_docs():
    s._conferir_extracao("generated-documents", CAMINHO, DONO)
    s._conferir_extracao("company-docs", "perfil/x.pdf", OUTRO)


def test_cliente_nao_escreve_em_generated_documents():
    """Só o servidor grava ali (gerar_documento, relatórios). Se o cliente
    pudesse, escreveria na pasta de outra pessoa."""
    assert s._cliente_pode_escrever("generated-documents") is False
    assert s._cliente_pode_escrever("company-docs") is True
    assert s._cliente_pode_escrever("agent-files") is True


def test_remover_privado_exige_dono():
    with pytest.raises(HTTPException) as e:
        s._conferir_remocao("generated-documents", CAMINHO, OUTRO)
    assert e.value.status_code == 404
    s._conferir_remocao("generated-documents", CAMINHO, DONO)
    s._conferir_remocao("agent-files", "avatars/x.png", OUTRO)
