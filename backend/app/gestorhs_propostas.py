"""Propostas do GestorHS pelo Guardi (12/11/2026, fase 2c: Serviços).

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-propostas-design.md`.
A pessoa conta o que o cliente pediu; o servidor monta a proposta pelo padrão
da casa e lista os LEMBRETES do que fugiu dele. Aqui mora a parte pura:

- itens só do catálogo (`/servicos` + `/produtos`), com nome e preço de lá —
  preço falado vai, mas marcado como diferente;
- o modelo (padrão ou Phoebus), o frete da tabela por região e o total, em
  `Decimal` com 2 casas, como o `montar_saida` do GestorHS;
- os lembretes, que NÃO travam: são aviso para a pessoa ler antes do clique;
- se o `outros_itens` de uma proposta ainda é o do modelo (para a alteração
  saber se pode refazê-lo) ou se alguém o editou na tela.

⚠️ O padrão (observação, validade, tabela de frete, os dois `outros_itens`) vem
do GestorHS por `GET /propostas/padrao` e nunca é copiado para cá: duas cópias
foi o que fez o faturamento divergir por anos (ver o CLAUDE.md).

Levanta `ValueError` com a mensagem para o agente. Testado em
`tests/test_guardi_gestorhs_propostas.py`.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from app.bots_pessoais import _linha

__all__ = ["TETO_ITENS", "TETO_QTD", "itens_do_pedido", "eh_phoebus", "frete_padrao", "total",
           "outros_itens_padrao", "texto_ainda_e_do_modelo", "lembretes", "reais", "dinheiro"]

TETO_ITENS = 30
TETO_QTD = 999
_CENTAVO = Decimal("0.01")
_TETO_EXIBIR = 120
_LACUNAS_PHOEBUS = ("[Inserir número]", "R$ ____")


def dinheiro(valor, campo: str) -> Decimal:
    """Valor em reais vindo do agente (número ou texto com vírgula), ≥ 0."""
    if isinstance(valor, bool) or valor is None:
        raise ValueError(f"`{campo}` tem que ser um número (em reais).")
    t = str(valor).strip().replace(",", ".") if isinstance(valor, str) else str(valor)
    try:
        d = Decimal(t)
    except InvalidOperation:
        raise ValueError(f"`{campo}` tem que ser um número (em reais).") from None
    if not d.is_finite() or d < 0 or d > Decimal("10000000"):
        raise ValueError(f"`{campo}` inválido: {valor} (aceito de 0 em diante).")
    return d.quantize(_CENTAVO, rounding=ROUND_HALF_UP)


def _quantidade(valor, n: int) -> Decimal:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        raise ValueError(f"Item {n}: `quantidade` tem que ser um número maior que 0.")
    q = Decimal(str(valor))
    if not q.is_finite() or q <= 0 or q > TETO_QTD:
        raise ValueError(f"Item {n}: `quantidade` vai de 1 a {TETO_QTD}.")
    return q


def _sku(valor) -> str:
    return str(valor).strip() if valor is not None and not isinstance(valor, bool) else ""


def itens_do_pedido(args_itens, catalogo) -> list[dict]:
    """Os itens que o agente mandou (`{sku, quantidade, preco?}`), resolvidos no
    catálogo. ⚠️ O `sku` tem que existir — e uma vez só: serviço e produto
    podem repetir o código, e escolher um seria chutar."""
    if not isinstance(args_itens, list) or not args_itens:
        raise ValueError("Informe `itens`: pelo menos um, com o `sku` do catálogo e a quantidade.")
    if len(args_itens) > TETO_ITENS:
        raise ValueError(f"No máximo {TETO_ITENS} itens por proposta.")
    por_sku: dict[str, list[dict]] = {}
    for c in catalogo or []:
        if isinstance(c, dict) and _sku(c.get("sku")):
            por_sku.setdefault(_sku(c.get("sku")), []).append(c)
    saida = []
    for n, item in enumerate(args_itens, 1):
        if not isinstance(item, dict):
            raise ValueError(f"Item {n}: um objeto com `sku` e `quantidade`.")
        sku = _sku(item.get("sku"))
        if not sku:
            raise ValueError(f"Item {n}: falta o `sku` (procure com gestorhs_consultar servicos ou produtos).")
        achados = por_sku.get(sku) or []
        if not achados:
            raise ValueError(f"Item {n}: o sku {sku} não está no catálogo do GestorHS — procure com "
                             "gestorhs_consultar servicos (ou produtos) q=<nome>. Não invente item.")
        if len(achados) > 1:
            nomes = "; ".join(_linha(str(a.get("nome") or ""), 80) for a in achados[:5])
            raise ValueError(f"Item {n}: o sku {sku} aparece {len(achados)} vezes no catálogo ({nomes}): "
                             "pergunte qual é.")
        cat = achados[0]
        q = _quantidade(item.get("quantidade"), n)
        preco_cat = dinheiro(cat.get("preco") or 0, "preco")
        preco = dinheiro(item["preco"], f"itens[{n}].preco") if item.get("preco") is not None else preco_cat
        saida.append({"descricao": _linha(str(cat.get("nome") or ""), 200), "sku": sku, "quantidade": q,
                      "unidade": _linha(str(cat.get("unidade") or ""), 10) or None,
                      "preco_un": preco, "preco_catalogo": preco_cat})
    return saida


def eh_phoebus(itens) -> bool:
    return any("PHOEBUS" in str(i.get("descricao") or "").upper() for i in itens or [])


def frete_padrao(padrao: dict, uf, phoebus: bool) -> Decimal | None:
    """Phoebus: frete incluso (0). Padrão: a tabela pela região do estado.
    `None` = estado desconhecido — nunca um frete chutado."""
    if phoebus:
        return Decimal("0")
    uf = str(uf or "").strip().upper()
    regiao = ((padrao or {}).get("regiao_por_uf") or {}).get(uf) if uf else None
    valor = ((padrao or {}).get("frete_por_regiao") or {}).get(regiao) if regiao else None
    if valor is None:
        return None
    return dinheiro(valor, "frete")


def total(itens, frete: Decimal, desconto: Decimal) -> Decimal:
    """Soma(quantidade × preço) + frete − desconto, 2 casas — o `montar_saida` de lá."""
    soma = sum((Decimal(str(i["quantidade"])) * Decimal(str(i["preco_un"])) for i in itens or []),
               Decimal("0"))
    return (soma + Decimal(str(frete)) - Decimal(str(desconto))).quantize(_CENTAVO, rounding=ROUND_HALF_UP)


def outros_itens_padrao(padrao: dict, phoebus: bool) -> str:
    modelos = (padrao or {}).get("outros_itens") or {}
    return str(modelos.get("phoebus" if phoebus else "padrao") or "")


_RE_VAZIA = re.compile(r"<(\w+)[^>]*>(?:\s|<br\s*/?>)*</\1>", re.I)


def _normal(html: str) -> str:
    t = str(html or "").replace("&nbsp;", " ").replace(" ", " ")
    anterior = None
    while anterior != t:            # <p><strong></strong></p> some em duas voltas
        anterior, t = t, _RE_VAZIA.sub("", t)
    t = re.sub(r">\s+<", "><", t)
    return re.sub(r"\s+", " ", t).strip()


def texto_ainda_e_do_modelo(atual: str, padrao_antigo: dict) -> bool:
    """O `outros_itens` ainda é um dos dois modelos gerados para os aparelhos
    antigos? Se não, alguém editou na tela — e a alteração não pode sobrescrever."""
    a = _normal(atual)
    if not a:
        return False
    return any(a == _normal(m) for m in ((padrao_antigo or {}).get("outros_itens") or {}).values() if m)


def reais(d) -> str:
    """`Decimal('1335')` → `R$ 1.335,00`."""
    q = Decimal(str(d)).quantize(_CENTAVO, rounding=ROUND_HALF_UP)
    inteiro, cent = f"{q:.2f}".split(".")
    sinal = "-" if inteiro.startswith("-") else ""
    inteiro = inteiro.lstrip("-")
    grupos = []
    while inteiro:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    return f"{sinal}R$ {'.'.join(grupos) or '0'},{cent}"


def _igual(a, b) -> bool:
    return " ".join(str(a or "").split()).casefold() == " ".join(str(b or "").split()).casefold()


def lembretes(*, itens, frete, frete_tabela, uf, desconto, pagamento, pagamento_ultima,
              aparelhos_na_proposta, frota_vencendo, phoebus, outros_itens, entrega_diferente) -> list[str]:
    """O que fugiu do padrão, uma linha cada. Lembrete não trava: é aviso."""
    saida: list[str] = []
    uf = str(uf or "").strip().upper()
    if not phoebus:
        if frete_tabela is None:
            saida.append("Frete: estado desconhecido (o cliente não tem UF no cadastro, ou ela não está "
                         f"na tabela) — confira o frete de {reais(frete)}.")
        elif Decimal(str(frete)) == 0 and Decimal(str(frete_tabela)) > 0:
            saida.append(f"Frete zerado, mas a tabela para {uf} é {reais(frete_tabela)}: o cliente retira?")
        elif Decimal(str(frete)) != Decimal(str(frete_tabela)):
            saida.append(f"Frete de {reais(frete)}, diferente da tabela para {uf} ({reais(frete_tabela)}).")
    elif any(lacuna in str(outros_itens or "") for lacuna in _LACUNAS_PHOEBUS):
        saida.append("O texto do modelo Phoebus tem lacunas sem preencher (número do módulo, valores): "
                     "complete na tela do GestorHS.")
    for i in itens or []:
        if Decimal(str(i["preco_un"])) != Decimal(str(i["preco_catalogo"])):
            saida.append(f"Preço de {_linha(i['descricao'], 60)}: {reais(i['preco_un'])}, diferente do "
                         f"catálogo ({reais(i['preco_catalogo'])}).")
    if Decimal(str(desconto or 0)) > 0:
        saida.append(f"Proposta com desconto de {reais(desconto)} (raro nas propostas).")
    if pagamento_ultima and not _igual(pagamento, pagamento_ultima):
        atual = f"“{_linha(pagamento, 60)}”" if pagamento else "em branco"
        saida.append(f"Pagamento {atual}, diferente da última proposta deste cliente "
                     f"(“{_linha(pagamento_ultima, 60)}”).")
    dentro = {int(a) for a in aparelhos_na_proposta or []}
    fora = [a for a in frota_vencendo or [] if isinstance(a, dict) and a.get("id") not in dentro]
    if fora:
        series = ", ".join(_linha(str(a.get("serie") or f"id {a.get('id')}"), 40) for a in fora[:_TETO_EXIBIR // 4])
        saida.append(f"Aparelhos do cliente com calibração vencida ou vencendo em 90 dias que ficaram fora: "
                     f"{series}.")
    if entrega_diferente:
        saida.append("Endereço de entrega diferente do cadastro: confira.")
    return saida
