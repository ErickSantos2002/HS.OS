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
