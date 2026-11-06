"""Assinatura de e-mail por pessoa — modelo do HSGrowth (05/11/2026).

Texto antes + até 2 imagens (GIF animado incluso) + texto depois (aviso LGPD).
Todo e-mail que o bot PREPARA sai em HTML com ela no fim.

⚠️ Os dois textos são da EMPRESA, fixos aqui, desde 06/11/2026 (decisão do
Erick). Eram campos do Perfil, e em dois dias duas pessoas mandaram e-mail sem
eles: uma não preencheu, outra preencheu e não clicou em "Salvar texto". Como
são iguais para todos, a pessoa só cuida das imagens. As colunas
`texto_antes`/`texto_depois` de `email_assinaturas` ficaram sem leitor.

⚠️ Imagens EMBUTIDAS (`cid:`), não link: link externo não anima e o Outlook de
quem recebe bloqueia imagem remota por padrão. ⚠️ O corpo do bot é ESCAPADO:
ele pode carregar texto de e-mail lido, e tag ali viraria HTML de verdade.
"""
from __future__ import annotations

import base64
import html as h

MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
TETO_IMAGEM = 2_000_000
TETO_TOTAL = 3_000_000   # o Graph recusa requisição acima de 4 MB (base64 incha ~33%)

TEXTO_ANTES = "Atenciosamente,"
TEXTO_DEPOIS = (
    "Este e-mail e seus anexos são estritamente confidenciais, de acordo com a LGPD - Lei Geral de "
    "Proteção de Dados (Lei nº 13.709/2018). Se você recebeu este e-mail por engano, por favor, "
    "notifique o remetente imediatamente e evite divulgar, salvar ou copiar seu conteúdo, a menos que "
    "autorizado por escrito pelo remetente ou conforme a lei aplicável. Para informações sobre direitos "
    "de titulares, entre em contato pelo e-mail qualidade@healthsafety.com.br. Consulte nossa Política "
    "de Privacidade em https://www.healthsafety.com.br/privacidade.cfm"
)


def validar_imagem(mime: str, tamanho: int, outras: int) -> None:
    if mime not in MIMES:
        raise ValueError("Use PNG, JPG, WEBP ou GIF.")
    if tamanho > TETO_IMAGEM:
        raise ValueError("Cada imagem pode ter no máximo 2 MB.")
    if tamanho + outras > TETO_TOTAL:
        raise ValueError("As imagens da assinatura somam mais de 3 MB.")


def _texto_html(t: str) -> str:
    return h.escape(t or "").replace("\n", "<br>")


def _sem_despedida_repetida(corpo: str, ass: dict | None) -> str:
    """Se o corpo termina com o mesmo texto que abre a assinatura (ex.:
    "Atenciosamente,"), tira a cópia do corpo — sairia duas vezes."""
    antes = " ".join(((ass or {}).get("texto_antes") or "").split()).strip(" ,.").lower()
    if not antes:
        return corpo
    linhas = (corpo or "").rstrip().splitlines()
    while linhas and " ".join(linhas[-1].split()).strip(" ,.").lower() == antes:
        linhas.pop()
        while linhas and not linhas[-1].strip():
            linhas.pop()
    return "\n".join(linhas)


def montar_html(corpo: str, ass: dict | None) -> str:
    corpo = _sem_despedida_repetida(corpo, ass)
    partes = [f'<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">{_texto_html(corpo)}</div>']
    if ass:
        if (ass.get("texto_antes") or "").strip():
            partes.append(f'<p style="font-family:Calibri,Arial,sans-serif;font-size:11pt">'
                          f'{_texto_html(ass["texto_antes"])}</p>')
        imgs = "".join(f'<img src="cid:assinatura-{i["ordem"]}" alt="" style="max-width:600px;'
                       f'vertical-align:middle">' for i in sorted(ass.get("imagens") or [],
                                                                     key=lambda i: i["ordem"]))
        if imgs:
            partes.append(f"<div>{imgs}</div>")
        if (ass.get("texto_depois") or "").strip():
            partes.append(f'<p style="font-family:Calibri,Arial,sans-serif;font-size:9pt;color:#777;'
                          f'font-style:italic">{_texto_html(ass["texto_depois"])}</p>')
    return "\n".join(partes)


def anexos_inline(ass: dict | None) -> list[dict]:
    return [{"@odata.type": "#microsoft.graph.fileAttachment", "name": i["nome"],
             "contentType": i["mime"], "contentBytes": base64.b64encode(bytes(i["dados"])).decode(),
             "contentId": f"assinatura-{i['ordem']}", "isInline": True}
            for i in sorted((ass or {}).get("imagens") or [], key=lambda i: i["ordem"])]


async def carregar(conn, user_id: str) -> dict:
    """A assinatura da pessoa: os textos fixos da empresa + as imagens dela.
    Sempre devolve — sem imagem, o e-mail sai com os dois textos."""
    imagens = await conn.fetch(
        "SELECT ordem, mime, nome, dados FROM public.email_assinatura_imagens WHERE user_id = $1::uuid "
        "ORDER BY ordem", user_id)
    return {"texto_antes": TEXTO_ANTES, "texto_depois": TEXTO_DEPOIS, "imagens": [dict(i) for i in imagens]}
