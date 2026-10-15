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

def test_token_nao_vai_na_linha_de_comando_do_curl():
    """-H "Authorization: Bearer $TOKEN" aparece no `ps` enquanto o curl roda.
    O cabeçalho vai pela entrada padrão (--config -)."""
    s = open("enviar.sh").read()
    assert '-H "Authorization: Bearer $TOKEN"' not in s
    assert "--config -" in s

def test_registro_de_publicados_so_avanca_depois_do_200():
    """Se o envio falhar e o registro avançar, os objetos 'publicados' que nunca
    chegaram ao ar não seriam criados nunca mais."""
    s = open("enviar.sh").read()
    assert s.index('[ "$codigo" = 200 ]') < s.index("mv publicados.json.novo publicados.json")
