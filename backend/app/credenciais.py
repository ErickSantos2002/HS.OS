"""Credencial de conector cifrada **por valor** em `integrations.credentials` (PK-08).

Até 25/11/2026 as senhas dos bancos da empresa ficavam em claro na tabela — e
a tabela é legível pelo usuário `leitura` do cadastro e vai inteira no dump
diário. Agora cada `value` sai como `cifra:v1:<token Fernet>`, com a mesma
chave do e-mail (`EMAIL_CHAVE_CIFRA`): a ameaça é a mesma, quem tem a tabela não
tem o env.

⚠️ **Por valor, não a coluna inteira.** A listagem de conectores tira
`credential_keys` dos NOMES das chaves em SQL (`_COLUNAS_CONECTOR`). Cifrar o
JSON inteiro esconderia os nomes, a tela abriria o formulário em branco e
salvar apagaria as chaves — exatamente o que aquela consulta foi escrita para
impedir.

⚠️ **O valor sem prefixo é devolvido como está.** É o que deixa o código subir
antes da migração que cifra as linhas existentes (`scripts/cifrar-credenciais.py`)
— e o que mantém legível uma linha que alguém tenha gravado em claro por fora.
"""
import json

from app.email import cifra

PREFIXO = "cifra:v1:"


def _fechar_valor(valor):
    if not isinstance(valor, str) or not valor or valor.startswith(PREFIXO):
        return valor
    return PREFIXO + cifra.cifrar(valor)


def _abrir_valor(valor):
    if isinstance(valor, str) and valor.startswith(PREFIXO):
        return cifra.decifrar(valor[len(PREFIXO):])
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
    """Estrutura em claro → com cada valor cifrado. Idempotente.

    Sem chave, levanta `ErroCifra`: gravar senha em claro achando que cifrou é
    pior do que recusar a gravação.
    """
    return _aplicar(_carregar(estrutura), _fechar_valor)
