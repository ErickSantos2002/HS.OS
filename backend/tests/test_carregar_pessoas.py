"""A parte do carregamento que decide, separada da que fala com a rede.

O script cria contas em produção; o que dá para provar antes é quem ele
escolhe. `Bruce` e `Carlos` são cadastro de teste no TalentHS e não podem virar
conta; quem já tem conta não pode virar segunda conta.
"""
from scripts.carregar_pessoas import quem_falta, senha_forte

QUADRO = [
    {"nome": "Erick Santos Dantas", "email": "ti@healthsafetytech.com",
     "setor": "TI", "cargo": "Coordenador de Dados Pleno"},
    {"nome": "Beltrano de Tal", "email": "beltrano@exemplo.test",
     "setor": "RECURSOS HUMANOS", "cargo": "Coordenadora de RH Junior"},
    {"nome": "Bruce", "email": "bruce@healthsafetytech.com",
     "setor": "SEM SETOR", "cargo": None},
    {"nome": "Carlos", "email": "carlos@healthsafetytech.com",
     "setor": "SEM SETOR", "cargo": None},
]


def test_descarta_quem_ja_tem_conta():
    falta = quem_falta(QUADRO, {"ti@healthsafetytech.com"})
    assert [p["email"] for p in falta] == ["beltrano@exemplo.test"]


def test_descarta_o_cadastro_de_teste():
    """Bruce e Carlos não são gente — ver a view `pessoas` do TalentHS."""
    falta = quem_falta(QUADRO, set())
    assert "bruce@healthsafetytech.com" not in [p["email"] for p in falta]
    assert "carlos@healthsafetytech.com" not in [p["email"] for p in falta]


def test_e_mail_repetido_no_quadro_vira_uma_conta_so():
    quadro = QUADRO + [dict(QUADRO[1])]
    falta = quem_falta(quadro, set())
    assert len(falta) == 2  # Erick e Beltrano, uma vez cada


def test_comparacao_de_e_mail_ignora_caixa_e_espaco():
    quadro = [{"nome": "Alguém", "email": "  TI@HealthSafetyTech.com ",
               "setor": "TI", "cargo": None}]
    assert quem_falta(quadro, {"ti@healthsafetytech.com"}) == []


def test_senha_forte_nao_se_repete_e_tem_tamanho():
    """`POST /profiles` exige no mínimo 8 caracteres."""
    a, b = senha_forte(), senha_forte()
    assert len(a) >= 16 and a != b
