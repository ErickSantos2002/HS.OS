"""O que o Guardi pode consultar no GestorHS — e só isso (11/11/2026, fase 1).

Spec `docs/superpowers/specs/2026-11-11-guardi-gestorhs-design.md`. O Guardi lê o
GestorHS (frota de aparelhos dos clientes, clientes da calibração, OS, caixas,
certificados e propostas) COMO o dono: quem decide o que ele vê é o GestorHS,
com a função que o dono tem lá. Aqui mora a outra metade, a mesma do DataCore
e do DocsHS: **o agente escolhe uma consulta desta lista, nunca um caminho.**
Fora dela de propósito: qualquer escrita (é a fase 2), PDF de certificado ou de
proposta, `/exportar`, notas fiscais, logs de integração, usuários e portal.

O `/openapi.json` do GestorHS é alcançável (ao contrário do DocsHS), mas os
filtros ficam DECLARADOS aqui mesmo assim: o openapi dá o nome do parâmetro e
não o significado dos valores — `status=vencendo` são os próximos 90 dias, e
isso o agente só sabe se a descrição disser. Caminhos e filtros conferidos no
openapi de produção em 11/11/2026; filtro novo numa rota de lá só chega ao
Guardi entrando aqui.

Puro, testado em `tests/test_guardi_gestorhs.py`.
"""
from __future__ import annotations

import re

from app.datacore_consultas import _escalar, texto_do_retorno

__all__ = ["CONSULTAS", "caminho_da_consulta", "params_da_consulta", "paginacao_local",
           "pede_id", "com_links", "texto_do_retorno"]

# Paginação feita DO NOSSO LADO, em rota que devolve a lista inteira. Nenhuma
# rota do catálogo que use estes nomes os aceita lá, então nunca vão ao GestorHS.
_LOCAL = ("offset", "limite")
_MAX_PAGINA = 100    # `limit` e `page_size` têm le=100 lá (acima, 422)
# Todo id do GestorHS é inteiro: um segmento só, sem `/` nem `..`.
_ID = re.compile(r"^[0-9]{1,10}$")
_MARCADOR = re.compile(r"\{[a-z_]+\}")

# chave → (caminho no GestorHS, o que é e para quem, filtros aceitos).
# O `{..._id}` do caminho (o nome é o do openapi) pede `id`.
CONSULTAS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "aparelhos": ("/equipamentos-cliente",
                  "a frota: aparelhos dos clientes. `cliente` (id do cliente), `equipamento` "
                  "(id do modelo, de `modelos`), `status` da calibração (`vencido`, `vencendo` "
                  "= vence nos próximos 90 dias, `em_dia`, `sem_data`), `ativo` (true/false), "
                  "`q` (número de série ou patrimônio). Pagina lá: `offset` e `limit` (até 100)",
                  ("cliente", "equipamento", "status", "ativo", "q", "offset", "limit")),
    "aparelho": ("/equipamentos-cliente/{item_id}",
                 "um aparelho pelo id: cliente, modelo, série, vencimento da calibração", ()),
    "historico_do_aparelho": ("/equipamentos-cliente/{item_id}/historico",
                              "o histórico de um aparelho (calibrações e movimentações)", _LOCAL),
    "os_do_aparelho": ("/equipamentos-cliente/{item_id}/ordens",
                       "as OS de um aparelho (para saber se tem OS aberta)", _LOCAL),
    "certificados_do_aparelho": ("/equipamentos-cliente/{item_id}/certificados",
                                 "os certificados de calibração de um aparelho", _LOCAL),
    "aparelhos_por_modelo": ("/equipamentos-cliente/resumo-por-modelo",
                             "quantos aparelhos e quantos clientes há por modelo", _LOCAL),
    "modelos": ("/equipamentos", "os modelos de aparelho (ids para o filtro `equipamento`)", _LOCAL),
    "clientes": ("/clientes",
                 "os clientes da calibração. `q` (nome, CNPJ ou CPF), `equipamento` (id do "
                 "modelo: quem tem esse modelo). Pagina lá: `offset` e `limit` (até 100)",
                 ("q", "equipamento", "offset", "limit")),
    "cliente": ("/clientes/{cliente_id}", "um cliente pelo id", ()),
    "ordens": ("/ordens",
               "as OS. `fase` (número, de `fases`), `cliente` (id), `tipo`, `q` (número da OS "
               "ou busca), `chegada_de` e `chegada_ate` (AAAA-MM-DD). Pagina lá: `offset` e "
               "`limit` (até 100)",
               ("fase", "cliente", "tipo", "q", "chegada_de", "chegada_ate", "offset", "limit")),
    "ordem": ("/ordens/{ordem_id}", "uma OS pelo id (traz a caixa em que está)", ()),
    "certificados_da_ordem": ("/ordens/{ordem_id}/certificados", "os certificados de uma OS", _LOCAL),
    "fases": ("/fases", "as fases de OS (para traduzir o número da fase)", _LOCAL),
    "caixas": ("/caixas",
               "as caixas. `q` (número da caixa ou observação), `incluir_concluidas` "
               "(true/false; por padrão só as abertas). Pagina lá: `offset` e `limit` (até 100)",
               ("q", "incluir_concluidas", "offset", "limit")),
    "caixa": ("/caixas/{caixa_id}", "uma caixa pelo id, com as OS e aparelhos dela", ()),
    "propostas": ("/propostas",
                  "as propostas. `q` (busca), `incluir_desabilitadas` (true/false). Pagina lá: "
                  "`page` e `page_size` (até 100)",
                  ("q", "incluir_desabilitadas", "page", "page_size")),
    "proposta": ("/propostas/{proposta_id}", "uma proposta pelo id: cliente, valor, situação", ()),
    "versoes_da_proposta": ("/propostas/{proposta_id}/versoes", "as versões de uma proposta", _LOCAL),
    # Fase 2c (12/11/2026): o catálogo de onde sai o `sku` de cada item da proposta.
    "servicos": ("/servicos", "o catálogo de serviços (sku, nome, preço) para os itens da proposta. "
                 "`q` (nome ou sku)", ("q",) + _LOCAL),
    "produtos": ("/produtos", "o catálogo de produtos (sku, nome, preço) para os itens da proposta. "
                 "`q` (nome ou sku)", ("q",) + _LOCAL),
}

# Consultas cuja resposta traz algo que tem tela no front — e o prefixo dela.
# Propostas não têm página por proposta lá: o link vai para a lista.
_LINK = {"aparelhos": "/app/equipamentos/", "aparelho": "/app/equipamentos/",
         "clientes": "/app/clientes/", "cliente": "/app/clientes/",
         "ordens": "/app/ordens/", "ordem": "/app/ordens/", "os_do_aparelho": "/app/ordens/",
         "caixas": "/app/caixas/", "caixa": "/app/caixas/"}
_LINK_SEM_ID = {"propostas": "/app/propostas", "proposta": "/app/propostas"}


def pede_id(chave: str) -> bool:
    return chave in CONSULTAS and bool(_MARCADOR.search(CONSULTAS[chave][0]))


def caminho_da_consulta(chave: str, ident: str | None) -> str:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja gestorhs_consultas.")
    caminho = CONSULTAS[chave][0]
    if pede_id(chave):
        if ident is None or isinstance(ident, bool) or not _ID.match(str(ident)):
            raise ValueError(f"A consulta {chave} precisa de um `id` (só números).")
        return _MARCADOR.sub(str(ident), caminho)
    if ident not in (None, ""):
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
        raise ValueError(f"Consulta desconhecida: {chave}. Veja gestorhs_consultas.")
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
        if k in ("limit", "page_size"):
            v = _inteiro(k, v, 1, _MAX_PAGINA)
        elif k == "page":
            v = _inteiro(k, v, 1)
        elif k == "offset":
            v = _inteiro(k, v, 0)
        elif k == "limite":
            v = _inteiro(k, v, 1)
        saida.append((k, _escalar(v)))
    return saida


def paginacao_local(chave: str,
                    params: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], int, int | None]:
    """Separa `offset`/`limite` (já validados) do que vai ao GestorHS — só nas
    consultas que paginam DO NOSSO LADO. Nas que paginam lá (`aparelhos`,
    `clientes`, `ordens`, `caixas`), o `offset` é do GestorHS e segue na query."""
    if "limite" not in CONSULTAS.get(chave, ("", "", ()))[2]:
        return params, 0, None
    resto, offset, limite = [], 0, None
    for k, v in params:
        if k == "offset":
            offset = int(v)
        elif k == "limite":
            limite = int(v)
        else:
            resto.append((k, v))
    return resto, offset, limite


def _com_link(item, prefixo: str, base: str, com_id: bool):
    if not isinstance(item, dict) or "link" in item:
        return item
    if not com_id:
        return {**item, "link": f"{base.rstrip('/')}{prefixo}"}
    ident = item.get("id")
    if ident is None or isinstance(ident, bool) or not _ID.match(str(ident)):
        return item
    return {**item, "link": f"{base.rstrip('/')}{prefixo}{ident}"}


def com_links(chave: str, dados, base: str):
    """Acrescenta `link` (tela do FRONT do GestorHS) aos itens que têm tela —
    montado aqui, nunca pelo modelo. Lista crua, `{"items": [...]}` (o envelope
    de lá) ou objeto único."""
    if chave in _LINK:
        prefixo, com_id = _LINK[chave], True
    elif chave in _LINK_SEM_ID:
        prefixo, com_id = _LINK_SEM_ID[chave], False
    else:
        return dados
    if isinstance(dados, list):
        return [_com_link(i, prefixo, base, com_id) for i in dados]
    if isinstance(dados, dict) and isinstance(dados.get("items"), list):
        return {**dados, "items": [_com_link(i, prefixo, base, com_id) for i in dados["items"]]}
    return _com_link(dados, prefixo, base, com_id)
