"""Credencial de conector cifrada **por valor** em `integrations.credentials` (PK-08).

Até 25/11/2026 as senhas dos bancos da empresa ficavam em claro na tabela — e
a tabela é legível pelo usuário `leitura` do cadastro e vai inteira no dump
diário. Agora cada `value` sai como `cifra:v1:<token Fernet>`, com chave derivada
da `EMAIL_CHAVE_CIFRA` (ver `_fernet`): quem tem a tabela não tem o env.

⚠️ **Por valor, não a coluna inteira.** A listagem de conectores tira
`credential_keys` dos NOMES das chaves em SQL (`_COLUNAS_CONECTOR`). Cifrar o
JSON inteiro esconderia os nomes, a tela abriria o formulário em branco e
salvar apagaria as chaves — exatamente o que aquela consulta foi escrita para
impedir.

⚠️ **O valor sem prefixo é devolvido como está.** É o que deixa o código subir
antes da migração que cifra as linhas existentes (`scripts/cifrar-credenciais.py`)
— e o que mantém legível uma linha que alguém tenha gravado em claro por fora.
"""
import base64
import json

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.email import cifra
from app.email.cifra import ErroCifra

PREFIXO = "cifra:v1:"


class ValorReservado(ValueError):
    """Valor vindo de fora já com o prefixo da cifra."""


def _fernet() -> Fernet:
    """Chave PRÓPRIA, derivada da `EMAIL_CHAVE_CIFRA` com rótulo de contexto.

    ⚠️ Não é a Fernet do e-mail: com a mesma chave, um refresh token da
    `email_contas` (legível pelo usuário `leitura`) gravado aqui como credencial
    seria decifrado e entregue ao agente por `/agent-credentials`. Derivar
    separa os domínios sem exigir variável nova no ambiente.
    """
    cifra._fernet()  # sem chave, ou chave inválida: `ErroCifra` com a mensagem de lá
    mestra = cifra.settings.EMAIL_CHAVE_CIFRA.encode()
    chave = HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
                 info=b"hsos-credenciais-conector-v1").derive(mestra)
    return Fernet(base64.urlsafe_b64encode(chave))


def _fechar_valor(valor):
    if not isinstance(valor, str) or not valor:
        return valor
    if valor.startswith(PREFIXO):
        # ⚠️ Recusa, não "já está cifrado": quem grava sempre parte do claro
        # (o guardado passa por `abrir` antes da mescla). Aceitar o prefixo de
        # fora seria deixar alguém plantar um texto cifrado para o sistema
        # decifrar por ele.
        raise ValorReservado(f"Valor de credencial não pode começar com {PREFIXO!r}.")
    return PREFIXO + _fernet().encrypt(valor.encode()).decode()


def _abrir_valor(valor):
    if isinstance(valor, str) and valor.startswith(PREFIXO):
        try:
            return _fernet().decrypt(valor[len(PREFIXO):].encode()).decode()
        except InvalidToken as e:
            raise ErroCifra("credencial que esta chave não abre") from e
    return valor


def _aplicar(estrutura, f):
    if isinstance(estrutura, list):
        # Lista de pares `{key_name, value, label?}`: só o `value` é segredo.
        return [
            {**c, "value": f(c.get("value"))} if isinstance(c, dict) and "value" in c else c
            for c in estrutura
        ]
    if isinstance(estrutura, dict):
        # Formato objeto (MCP: `{transport, url, token, …}`): não há como saber
        # qual campo é segredo, então todo valor string é cifrado.
        return {k: f(v) for k, v in estrutura.items()}
    return estrutura


def _carregar(bruto):
    if isinstance(bruto, str):
        try:
            return json.loads(bruto)
        except ValueError:
            return None
    return bruto


def abrir(bruto):
    """`credentials` como veio do banco (texto JSON ou estrutura) → em claro."""
    return _aplicar(_carregar(bruto), _abrir_valor)


def fechar(estrutura):
    """Estrutura em claro → com cada valor cifrado.

    Sem chave, levanta `ErroCifra`: gravar senha em claro achando que cifrou é
    pior do que recusar a gravação. Valor que já chega com o prefixo levanta
    `ValorReservado`.
    """
    return _aplicar(_carregar(estrutura), _fechar_valor)
