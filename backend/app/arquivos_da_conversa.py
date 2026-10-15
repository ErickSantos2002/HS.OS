"""Painel "Arquivos" da conversa com o agente — o recorte, sem banco.

A rota (`GET /conversations/{agent_id}/arquivos`) busca as mensagens com
`media` e entrega aqui. A saída tem o formato da rota do canal
(`GET /channels/{id}/arquivos`): `id`, `created_at`, `author_name` e
`attachments` — assim a tela usa o mesmo painel e o mesmo `arquivosDoCanal`.

⚠️ **O resumo em áudio fica de fora.** Ele entra em `media` como `type:
"audio"` em quase toda resposta (`app/voz_entrega.py`); deixá-lo passar enche
o painel de `resumo.mp3` e esconde o arquivo que a pessoa veio procurar.
"""
from __future__ import annotations

import json

# O que a tela usa. `base64` não desce: mensagem antiga pode carregar o
# arquivo inteiro nele.
_CAMPOS = ("id", "url", "name", "size", "mimeType")


def _itens(bruto) -> list:
    if isinstance(bruto, str):
        try:
            bruto = json.loads(bruto)
        except ValueError:
            return []
    if isinstance(bruto, dict):
        return [bruto]
    return bruto if isinstance(bruto, list) else []


def arquivos_da_conversa(linhas, nome_agente: str) -> list[dict]:
    saida = []
    for l in linhas:
        anexos = [
            {k: item[k] for k in _CAMPOS if item.get(k) is not None}
            for item in _itens(l.get("media"))
            if isinstance(item, dict) and item.get("type") != "audio"
            and (item.get("id") or item.get("url"))
        ]
        if anexos:
            saida.append({
                "id": l["id"],
                "created_at": l["created_at"],
                "author_name": "Você" if l["role"] == "user" else nome_agente,
                "attachments": anexos,
            })
    return saida
