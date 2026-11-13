"""O que o Guardi pode consultar no DocsHS — e só isso (11/11/2026).

Spec `docs/superpowers/specs/2026-11-11-guardi-docshs-design.md`. O Guardi lê o
DocsHS (documentos da qualidade, leituras, treinamentos) COMO o dono: quem
decide o que ele vê é o DocsHS, com as regras de cargo, setor e classificação
que já tem. Aqui mora a outra metade, a mesma do DataCore
(`app/datacore_consultas.py`): **o agente escolhe uma consulta desta lista,
nunca um caminho.** Fora dela de propósito: arquivo de documento (decisão do
Erick: nenhum arquivo vai ao modelo), prova de treinamento, vídeo, materiais,
anexos e exportações.

Ao contrário do DataCore, os filtros ficam DECLARADOS aqui: o `/openapi.json`
do DocsHS não é alcançável de fora (o nginx só repassa `/api/`). Foram tirados
do código de lá (`backend/app/api/rotas/`) em 11/11/2026 — rota que ganhar
filtro novo só o oferece ao Guardi quando ele entrar aqui.

Puro, testado em `tests/test_guardi_docshs.py`.
"""
from __future__ import annotations

from app.datacore_consultas import _ID, _escalar, texto_do_retorno

__all__ = ["CONSULTAS", "caminho_da_consulta", "params_da_consulta", "paginacao_local",
           "precisa_de_eu", "link_de", "com_links", "texto_do_retorno"]

# Paginação feita DO NOSSO LADO, em rota que devolve a lista inteira. Nenhuma
# rota do catálogo aceita esses nomes, então eles nunca vão ao DocsHS.
_LOCAL = ("offset", "limite")
_MAX_TAMANHO = 200   # `tamanho` da Lista Mestra: le=200 lá (acima, 422)

# chave → (caminho relativo a /api/v1, o que é e para quem, filtros aceitos).
# `{id}` pede `id`; `{eu}` é preenchido pelo servidor com o id do `/auth/eu`.
CONSULTAS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "eu": ("/auth/eu", "quem o seu dono é no DocsHS (nome, papel)", ()),
    "documentos": ("/documentos", "a Lista Mestra: procurar documentos por código ou título "
                   "(`busca`, sem acento); só vêm os que o seu dono pode ver. Pagina lá: "
                   "`pagina` e `tamanho` (até 200)",
                   ("busca", "tipo_id", "setor_id", "classificacao", "status", "situacao",
                    "pagina", "tamanho")),
    "documento": ("/documentos/{id}", "um documento pelo id: revisão vigente, vencimento", ()),
    "revisoes_do_documento": ("/documentos/{id}/revisoes", "as revisões de um documento", _LOCAL),
    "setores": ("/setores", "os setores (ids para o filtro `setor_id`)", _LOCAL),
    "normas": ("/normas", "as normas cadastradas", _LOCAL),
    "tipos_de_documento": ("/administracao/tipos", "os tipos de documento (ids para `tipo_id`) — "
                           "só a Qualidade; os outros procuram por `busca`", _LOCAL),
    "minhas_leituras": ("/leituras/minhas", "as leituras do seu dono (pendentes primeiro)", _LOCAL),
    "minhas_pendencias": ("/minhas-acoes", "o que o seu dono tem para fazer no DocsHS "
                          "(leituras, treinamentos abertos, assinaturas)", ()),
    "meus_treinamentos": ("/treinamentos/pessoas/{eu}/historico",
                          "o histórico de treinamentos do seu dono", ()),
    "painel": ("/painel", "o painel do DocsHS (o bloco da Qualidade só para ela); os totais já "
               "vêm prontos", ()),
    "treinamentos": ("/treinamentos", "treinamentos — a Qualidade vê todos; os outros, só os que "
                     "MINISTRAM (os abertos para a pessoa estão em minhas_pendencias)",
                     ("ano", "situacao", "tipo", "instrutor_id", "com_pendentes") + _LOCAL),
    "treinamento": ("/treinamentos/{id}", "um treinamento pelo id (a ficha)", ()),
    "controle_de_treinamentos": ("/treinamentos/controle", "controle de treinamentos "
                                 "(FORM-SGI-006), encerrados por data `de`/`ate` "
                                 "(AAAA-MM-DD) — só a Qualidade", ("de", "ate") + _LOCAL),
    "plano_de_treinamento": ("/planos-treinamento/{id}", "o plano anual de treinamento (id = ano) — "
                             "só a Qualidade", ()),
    "leituras_por_pessoa": ("/leituras/por-pessoa", "leituras por pessoa (vencidas e pendentes) — "
                            "só a Qualidade", _LOCAL),
    "leituras_de_uma_pessoa": ("/leituras/por-pessoa/{id}", "as leituras de uma pessoa "
                               "(id = usuario_id) — só a Qualidade", _LOCAL),
    "leituras_da_revisao": ("/revisoes/{id}/leituras", "quem leu uma revisão (id da revisão) — "
                            "só a Qualidade", ()),
    "verificacoes": ("/documentos/verificacoes", "documentos que moram fora do sistema e a "
                     "verificação deles — só a Qualidade", _LOCAL),
}

# O que a pessoa diria ao Guardi para chegar a esta consulta — só para a tela
# "Capacidade" (`app/capacidade.py`). Opcional: sem exemplo, a tela mostra só o
# rótulo. O agente não lê isto: ele lê a descrição acima.
EXEMPLOS: dict[str, str] = {
    "documentos": "acha o procedimento de calibração",
    "minhas_leituras": "tenho leitura pendente?",
    "minhas_pendencias": "o que eu tenho para fazer no DocsHS?",
    "meus_treinamentos": "quais treinamentos eu já fiz?",
    "treinamentos": "quais treinamentos estão abertos este ano?",
    "leituras_por_pessoa": "quem está com leitura vencida?",
}

# Consultas cuja resposta traz documento ou treinamento — e onde está o id.
_LINK_DE_ID = {"documentos": "/documentos/", "documento": "/documentos/",
               "treinamentos": "/treinamentos/", "treinamento": "/treinamentos/"}
_LINK_DE_DOCUMENTO = ("minhas_leituras", "leituras_de_uma_pessoa")


def precisa_de_eu(chave: str) -> bool:
    return chave in CONSULTAS and "{eu}" in CONSULTAS[chave][0]


def caminho_da_consulta(chave: str, ident: str | None, eu: int | None = None) -> str:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja docshs_consultas.")
    caminho = CONSULTAS[chave][0]
    if "{eu}" in caminho:
        # ⚠️ Nunca do argumento: o Guardi de A pediria o histórico de B.
        if ident:
            raise ValueError(f"A consulta {chave} é sempre do seu dono — não leva `id`.")
        if not isinstance(eu, int) or isinstance(eu, bool):
            raise ValueError("Não consegui saber quem o seu dono é no DocsHS.")
        return caminho.replace("{eu}", str(eu))
    if "{id}" in caminho:
        if not ident or not _ID.match(str(ident)):
            raise ValueError(f"A consulta {chave} precisa de um `id` (letras, números, . _ -).")
        return caminho.replace("{id}", str(ident))
    if ident:
        raise ValueError(f"A consulta {chave} não leva `id` — use os filtros.")
    return caminho


def _inteiro(k: str, v, minimo: int, maximo: int | None = None) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"`{k}` tem que ser um número inteiro.") from None
    if isinstance(v, bool) or n < minimo or (maximo is not None and n > maximo):
        faixa = f"de {minimo} a {maximo}" if maximo is not None else f"a partir de {minimo}"
        raise ValueError(f"`{k}` inválido: {v} (aceito {faixa}).")
    return n


def params_da_consulta(chave: str, parametros: dict | None) -> list[tuple[str, str]]:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja docshs_consultas.")
    if not parametros:
        return []
    if not isinstance(parametros, dict):
        raise ValueError("Filtros: um objeto nome → valor.")
    aceitos = CONSULTAS[chave][2]
    saida: list[tuple[str, str]] = []
    for k, v in parametros.items():
        if k not in aceitos:
            validos = ", ".join(aceitos) if aceitos else "nenhum"
            raise ValueError(f"A consulta {chave} não aceita o filtro {k!r}. Válidos: {validos}.")
        if isinstance(v, (list, dict)):
            raise ValueError(f"O filtro {k} aceita um valor só.")
        if k == "tamanho":
            v = _inteiro(k, v, 1, _MAX_TAMANHO)
        elif k == "pagina":
            v = _inteiro(k, v, 1)
        elif k == "offset":
            v = _inteiro(k, v, 0)
        elif k == "limite":
            v = _inteiro(k, v, 1)
        saida.append((k, _escalar(v)))
    return saida


def paginacao_local(params: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], int, int | None]:
    """Separa `offset`/`limite` (já validados) do que vai ao DocsHS."""
    resto, offset, limite = [], 0, None
    for k, v in params:
        if k == "offset":
            offset = int(v)
        elif k == "limite":
            limite = int(v)
        else:
            resto.append((k, v))
    return resto, offset, limite


def link_de(caminho: str, base: str) -> str | None:
    """Link do FRONT do DocsHS para um documento ou treinamento."""
    partes = caminho.strip("/").split("/")
    if len(partes) == 2 and partes[0] in ("documentos", "treinamentos") and _ID.match(partes[1]):
        return f"{base.rstrip('/')}/{partes[0]}/{partes[1]}"
    return None


def _com_link(item, prefixo: str, campo: str, base: str):
    if isinstance(item, dict) and item.get(campo) is not None and "link" not in item:
        link = link_de(f"{prefixo}{item[campo]}", base)
        if link:
            return {**item, "link": link}
    return item


def com_links(chave: str, dados, base: str):
    """Acrescenta `link` aos itens que são documento ou treinamento — montado
    aqui, nunca pelo modelo."""
    if chave in _LINK_DE_ID:
        prefixo = _LINK_DE_ID[chave]
        if isinstance(dados, list):
            return [_com_link(i, prefixo, "id", base) for i in dados]
        if isinstance(dados, dict) and isinstance(dados.get("itens"), list):
            return {**dados, "itens": [_com_link(i, prefixo, "id", base) for i in dados["itens"]]}
        return _com_link(dados, prefixo, "id", base)
    if chave in _LINK_DE_DOCUMENTO and isinstance(dados, list):
        return [_com_link(i, "/documentos/", "documento_id", base) for i in dados]
    return dados
