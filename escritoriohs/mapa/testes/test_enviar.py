"""Enviar com diretório "/" apaga os outros .wam do map-storage — inclusive o
office, que é o plano de volta. O envio tem que ir para hs/."""
import re

def test_enviar_usa_diretorio_hs():
    s = open("enviar.sh").read()
    assert re.search(r'-F\s+"directory=hs"', s)
    assert 'directory=/' not in s

def test_enviar_nao_imprime_o_token():
    s = open("enviar.sh").read()
    assert "set -x" not in s and "echo \"$TOKEN" not in s and "echo $TOKEN" not in s

def test_enviar_mescla_com_o_mapa_no_ar_antes_de_zipar():
    """Sem a mescla, cada envio apagaria os objetos que o Erick pôs no navegador."""
    s = open("enviar.sh").read()
    assert "mesclar.py" in s
    assert s.index("mesclar.py") < s.index("zip -qr")
