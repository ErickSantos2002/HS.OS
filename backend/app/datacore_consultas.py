"""O que o Guardi pode consultar no DataCore — e só isso (10/11/2026).

Decisão do Erick: o Guardi vê o que o login do DONO vê no DataCore. A
permissão é do DataCore (papel de cada pessoa, aplicado com o token de agente);
aqui mora a outra metade: **o agente escolhe uma consulta desta lista, nunca um
caminho**. Um caminho livre alcançaria `/auth/users` ou uma escrita. Rota nova
do DataCore só chega ao Guardi quando entrar neste catálogo — e no allowlist de
lá. Puro, testado em `tests/test_guardi_datacore.py`.
"""
from __future__ import annotations

import json
import re

TETO_RETORNO = 12_000
_MAX_FILTROS = 20
_MAX_VALOR = 200
_CHAVE = re.compile(r"^[a-z][a-z0-9_]{0,40}$")
# Só pontos (`..`) subiria um nível no caminho: `/clientes/..` vira `/`.
_ID = re.compile(r"^(?!\.+$)[A-Za-z0-9._-]{1,80}$")

# chave → (caminho no DataCore, o que é). `{id}` marca a consulta que pede `id`.
CONSULTAS: dict[str, tuple[str, str]] = {
    "clientes": ("/clientes/", "procurar clientes (nome, CNPJ…)"),
    "cliente": ("/clientes/{id}", "um cliente pelo id"),
    "estoque": ("/estoque/", "produtos em estoque, com quantidade e preço"),
    "produto_no_estoque": ("/estoque/{id}", "um item do estoque pelo id"),
    "faturamento_resumo": ("/faturamento/resumo", "resumo comercial do período (a régua do DataCore)"),
    "faturamento_filtros": ("/faturamento/filtros", "os filtros aceitos pelo faturamento"),
    "faturamento_mensal": ("/faturamento/mensal", "faturamento mês a mês"),
    "vendas": ("/faturamento/vendas", "vendas (notas) do período"),
    "observacoes_da_venda": ("/faturamento/vendas/{id}/observacoes", "observações de uma venda (id da nota)"),
    "servicos": ("/faturamento/servicos", "notas de serviço do período"),
    "servicos_resumo": ("/faturamento/servicos/resumo", "resumo dos serviços"),
    "notas_fiscais": ("/notas_fiscais/", "notas fiscais"),
    "notas_de_venda": ("/notas_fiscais/vendas/", "notas fiscais de venda"),
    "notas_de_locacao": ("/notas_fiscais/locacao/", "notas fiscais de locação"),
    "notas_de_servico": ("/notas_servico/", "notas de serviço"),
    "itens_de_nota": ("/itens_nota/", "itens das notas"),
    "item_de_nota": ("/itens_nota/{id}", "um item de nota pelo id"),
    "contas_receber_resumo": ("/contas_receber/resumo", "resumo do contas a receber"),
    "contas_receber": ("/contas_receber/pagina", "títulos a receber, paginado"),
    "contas_pagar_resumo": ("/contas_pagar/resumo", "resumo do contas a pagar"),
    "contas_pagar": ("/contas_pagar/pagina", "títulos a pagar, paginado"),
    "inadimplencia_resumo": ("/inadimplencia/resumo", "inadimplência: totais, faixas e cobrança"),
    "inadimplencia_indicadores": ("/inadimplencia/indicadores", "taxa de inadimplência mês a mês"),
    "inadimplencia_empresas": ("/inadimplencia/empresas", "empresas inadimplentes, paginado"),
    "inadimplencia_empresa": ("/inadimplencia/empresas/{id}", "detalhe de uma empresa inadimplente"),
    "inadimplencia_titulos": ("/inadimplencia/empresas/{id}/titulos", "títulos de uma empresa inadimplente"),
    "centro_de_custo": ("/centro_custo/resumo_produto/", "resumo por produto do centro de custo"),
    # Gerenciamento financeiro (11/11/2026). No DataCore só a DIRETORIA abre.
    "notas_de_entrada_resumo": ("/notas_entrada/resumo", "resumo das notas de entrada (compras)"),
    "notas_de_entrada": ("/notas_entrada/pagina", "notas de entrada (compras), paginado. "
                         "Importação antiga vem com remetente 'Exterior — remetente não "
                         "identificado': o nome real não está no DataCore, não deduza"),
    "itens_da_nota_de_entrada": ("/notas_entrada/{id}/itens", "itens de uma nota de entrada (id da nota)"),
}


def caminho_da_consulta(chave: str, ident: str | None) -> str:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja datacore_consultas.")
    caminho = CONSULTAS[chave][0]
    if "{id}" in caminho:
        if not ident or not _ID.match(str(ident)):
            raise ValueError(f"A consulta {chave} precisa de um `id` (letras, números, . _ -).")
        return caminho.replace("{id}", str(ident))
    if ident:
        raise ValueError(f"A consulta {chave} não leva `id` — use os filtros.")
    return caminho


def _escalar(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float, str)):
        t = str(v)
        if len(t) > _MAX_VALOR:
            raise ValueError("Filtro grande demais.")
        return t
    raise ValueError("Filtro só aceita texto, número, sim/não ou lista deles.")


def params_da_consulta(parametros: dict | None) -> list[tuple[str, str]]:
    if not parametros:
        return []
    if not isinstance(parametros, dict) or len(parametros) > _MAX_FILTROS:
        raise ValueError(f"Filtros: no máximo {_MAX_FILTROS}, como um objeto nome → valor.")
    saida: list[tuple[str, str]] = []
    for k, v in parametros.items():
        if not _CHAVE.match(str(k)):
            raise ValueError(f"Nome de filtro inválido: {k!r}.")
        for x in (v if isinstance(v, list) else [v]):
            saida.append((str(k), _escalar(x)))
    return saida


def paginacao_local(openapi: dict, caminho: str,
                    params: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], int, int | None]:
    """Separa `offset`/`limite` da query quando a rota NÃO pagina no DataCore.

    11/11/2026: `/estoque/` não aceita parâmetro nenhum e devolve a tabela
    inteira; o `offset` que o agente mandava era ignorado e ele recebia sempre a
    mesma lista cortada. Rota que declara `offset` pagina lá e a query segue
    intacta. Devolve (query para o DataCore, offset local, limite local)."""
    op = (((openapi or {}).get("paths") or {}).get(caminho) or {}).get("get") or {}
    if any(p.get("name") == "offset" for p in op.get("parameters") or []):
        return params, 0, None
    resto, offset, limite = [], 0, None
    for k, v in params:
        if k in ("offset", "limite"):
            try:
                n = int(v)
            except ValueError:
                raise ValueError(f"`{k}` tem que ser um número inteiro.") from None
            if n < 0 or (k == "limite" and n == 0):
                raise ValueError(f"`{k}` inválido: {n}.")
            if k == "offset":
                offset = n
            else:
                limite = n
        else:
            resto.append((k, v))
    return resto, offset, limite


def _pagina_da_lista(dados: list, offset: int, limite: int | None) -> str:
    """Lista crua: a fatia pedida, por ITEM inteiro, dentro do teto."""
    total = len(dados)
    ini = min(offset, total)
    fim_pedido = total if limite is None else min(total, ini + limite)

    def montar(fim: int) -> str:
        return json.dumps({"total": total, "offset": ini,
                           "proximo_offset": fim if fim < total else None,
                           "itens": dados[ini:fim]},
                          ensure_ascii=False, separators=(",", ":"), default=str)

    fim = fim_pedido
    t = montar(fim)
    while len(t) > TETO_RETORNO and fim > ini + 1:
        # encolhe proporcionalmente e afina item a item
        fim = max(ini + 1, min(fim - 1, ini + int((fim - ini) * TETO_RETORNO / len(t))))
        t = montar(fim)
    if len(t) > TETO_RETORNO:  # um item sozinho maior que o teto
        return t[:TETO_RETORNO] + "\n…[cortado: um item só já passa do teto]"
    return t


def texto_do_retorno(dados, offset: int = 0, limite: int | None = None) -> str:
    if isinstance(dados, list):
        return _pagina_da_lista(dados, offset, limite)
    t = json.dumps(dados, ensure_ascii=False, separators=(",", ":"), default=str)
    if len(t) <= TETO_RETORNO:
        return t
    return (t[:TETO_RETORNO] + "\n…[cortado: resposta grande demais — refine os filtros ou "
            "use limite/offset para paginar]")


def filtros_da_openapi(openapi: dict, caminho: str) -> list[str]:
    """Os filtros (query) que a rota aceita, como o DataCore os declara."""
    op = (((openapi or {}).get("paths") or {}).get(caminho) or {}).get("get") or {}
    out = []
    for p in op.get("parameters") or []:
        if p.get("in") != "query":
            continue
        sch = p.get("schema") or {}
        tipo = sch.get("type") or ("lista" if sch.get("anyOf") else "")
        desc = (p.get("description") or "").strip()
        out.append(f"{p['name']} ({tipo})" + (f": {desc}" if desc else ""))
    return out
