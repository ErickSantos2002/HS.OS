"""O `.hsos` viaja entre instalações — e podia levar senha junto.

⚠️ **O sanitizador tirava IP, host e nomes, e não tocava em credencial.** Uma
URL como `postgresql://usuario:senha@host/banco` saía inteira no arquivo
exportado. E a regra de IP piorava o quadro em vez de salvar: ela trocava o
host e deixava a senha encostada no placeholder —
`postgresql://usuario:senha@{{IP_ADDRESS}}/banco`, que tem cara de arquivo
limpo.

Não é hipótese distante: os agentes falam com os nove bancos da empresa por
servidores MCP, e string de conexão é exatamente o tipo de coisa que aparece
escrita num `TOOLS.md` ou num `MEMORY.md`.

Estava catalogado como pendência de segurança em `docs/CONTINUAR-AQUI.md`
desde 14/08/2026.
"""
from app.routers.agent_export import _sanitizar_infra_e_nomes as sanitizar


def _limpar(texto: str) -> str:
    return sanitizar(texto, "", None, [])


def test_senha_em_url_de_postgres_nao_sai():
    saida = _limpar("postgresql://usuario:s3nh4-secreta@db.exemplo.com:5432/hsos")
    assert "s3nh4-secreta" not in saida
    assert "usuario" not in saida


def test_o_resto_da_url_sobrevive():
    """Apagar a URL inteira tiraria contexto de quem for ler o agente noutra
    instalação. O que não pode sair é a credencial."""
    saida = _limpar("postgresql://usuario:senha@db.exemplo.com:5432/hsos")
    assert "db.exemplo.com" in saida and "hsos" in saida


def test_token_em_url_https_tambem_nao_sai():
    assert "tok3n" not in _limpar("https://bot:tok3n@api.exemplo.com/enviar")


def test_url_sem_credencial_fica_intacta():
    url = "https://api.exemplo.com/v1/coisas"
    assert _limpar(url) == url


def test_email_no_texto_nao_e_confundido_com_credencial():
    """`contato@empresa.com` não tem esquema antes; casar aqui apagaria texto
    comum e faria o sanitizador parecer quebrado."""
    texto = "Escreva para contato@empresa.com se precisar."
    assert _limpar(texto) == texto


def test_a_senha_sai_mesmo_quando_o_host_e_um_IP():
    """⚠️ O caso que enganava: a regra de IP trocava o host e a senha ficava
    do lado do placeholder, com cara de arquivo já sanitizado."""
    saida = _limpar("postgresql://admin:senha123@10.0.0.7:5432/banco")
    assert "senha123" not in saida
    assert "{{IP_ADDRESS}}" in saida
