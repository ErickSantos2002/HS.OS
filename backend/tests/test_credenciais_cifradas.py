"""PK-08 — credencial de conector cifrada por valor (25/11/2026).

Até aqui as senhas dos 9 bancos da empresa ficavam em claro em
`integrations.credentials`: quem tinha o usuário `leitura` do cadastro, ou o
dump diário, tinha as senhas. A cifra é **por valor** — os nomes das chaves
ficam legíveis porque a listagem de conectores os tira em SQL, e sem eles a
tela abria o formulário em branco e salvar apagava as credenciais.
"""
import json

import pytest
from cryptography.fernet import Fernet

from app import credenciais
from app.email import cifra
from app.routers import integracoes


@pytest.fixture
def chave(monkeypatch):
    monkeypatch.setattr(cifra.settings, "EMAIL_CHAVE_CIFRA", Fernet.generate_key().decode())


PARES = [
    {"key_name": "ro_usuario", "value": "leitor"},
    {"key_name": "ro_senha", "value": "s3nh@/forte", "label": "Senha"},
]


def test_fechar_cifra_so_o_valor_e_mantem_os_nomes(chave):
    """O nome da chave é o que a listagem lê em SQL — tem que sobreviver."""
    fechado = credenciais.fechar(PARES)
    assert [c["key_name"] for c in fechado] == ["ro_usuario", "ro_senha"]
    assert fechado[1]["label"] == "Senha"
    texto = json.dumps(fechado)
    assert "leitor" not in texto and "s3nh@/forte" not in texto
    assert all(c["value"].startswith(credenciais.PREFIXO) for c in fechado)


def test_ida_e_volta(chave):
    assert credenciais.abrir(credenciais.fechar(PARES)) == PARES


def test_abrir_aceita_o_texto_json_da_coluna(chave):
    """O asyncpg devolve jsonb como `str`; todo leitor recebia assim."""
    assert credenciais.abrir(json.dumps(credenciais.fechar(PARES))) == PARES


def test_abrir_devolve_legado_em_claro_como_esta(chave):
    """Sem isso o deploy teria que vir junto da migração, sem volta.

    O código novo sobe ANTES de cifrar as 9 linhas; até lá ele lê o claro.
    """
    assert credenciais.abrir(PARES) == PARES


def test_valor_de_fora_com_o_prefixo_e_recusado(chave):
    """Aceitar `cifra:v1:` de quem grava seria deixar plantar texto cifrado.

    Achado na revisão de segurança do próprio PK-08: com o prefixo aceito,
    quem tem o token compartilhado gravava um refresh token da `email_contas`
    (legível pelo usuário `leitura`) como credencial, e o `/agent-credentials`
    o devolvia decifrado.
    """
    with pytest.raises(credenciais.ValorReservado):
        credenciais.fechar(credenciais.fechar(PARES))


def test_chave_propria_nao_abre_o_cifrado_do_email(chave):
    """Domínios separados: o que a cifra do e-mail gerou não abre aqui."""
    do_email = credenciais.PREFIXO + cifra.cifrar("refresh-token-de-alguem")
    with pytest.raises(cifra.ErroCifra):
        credenciais.abrir([{"key_name": "t", "value": do_email}])


def test_rota_responde_400_ao_prefixo(chave):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        integracoes.fechar_credenciais([{"key_name": "t", "value": credenciais.PREFIXO + "x"}])
    assert e.value.status_code == 400


def test_formato_objeto_do_mcp(chave):
    """O outro formato que convive na tabela: `{transport, url, token}`."""
    obj = {"transport": "http", "url": "https://x", "token": "abc123"}
    fechado = credenciais.fechar(obj)
    assert "abc123" not in json.dumps(fechado)
    assert credenciais.abrir(fechado) == obj


def test_vazios_passam(chave):
    assert credenciais.abrir(None) is None
    assert credenciais.fechar(None) is None
    assert credenciais.fechar([{"key_name": "x", "value": ""}]) == [{"key_name": "x", "value": ""}]


def test_sem_chave_nao_grava_em_claro(monkeypatch):
    """Falhar alto é melhor que gravar senha em claro achando que cifrou."""
    monkeypatch.setattr(cifra.settings, "EMAIL_CHAVE_CIFRA", "")
    with pytest.raises(cifra.ErroCifra):
        credenciais.fechar(PARES)


def test_url_do_banco_sai_da_credencial_cifrada(chave):
    """O caminho que importa: testar, publicar no MCP e o relatório do HSGrowth."""
    linha = {"db_host": "h", "db_porta": 5432, "db_base": "b", "db_sslmode": "disable"}
    url = integracoes._url_do_banco(linha, json.dumps(credenciais.fechar(PARES)), True)
    assert url == "postgresql://leitor:s3nh%40%2Fforte@h:5432/b?sslmode=disable"


def test_mescla_preserva_o_guardado_cifrado(chave):
    """Editar só o nome do conector manda valor vazio: o guardado fica."""
    guardado = json.dumps(credenciais.fechar(PARES))
    novas = [{"key_name": "ro_usuario", "value": "outro"}, {"key_name": "ro_senha", "value": ""}]
    mescladas = integracoes._mesclar_credenciais(guardado, novas)
    assert credenciais.abrir(mescladas) == [
        {"key_name": "ro_usuario", "value": "outro"},
        {"key_name": "ro_senha", "value": "s3nh@/forte"},
    ]


def test_token_da_integracao_decifra(chave):
    pares = [{"key_name": "access_token", "value": "tok-xyz"}]
    assert integracoes._token_da_integracao(json.dumps(credenciais.fechar(pares)), None) == "tok-xyz"
