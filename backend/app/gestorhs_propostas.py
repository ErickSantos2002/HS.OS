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
from app.gestorhs_escrita import _data as data_iso
from app.gestorhs_escrita import exibir_texto, id_positivo, texto_curto

__all__ = ["TETO_ITENS", "TETO_QTD", "itens_do_pedido", "eh_phoebus", "frete_padrao", "total",
           "outros_itens_padrao", "texto_ainda_e_do_modelo", "lembretes", "reais", "dinheiro",
           "destinatario", "aparelhos_ids", "endereco_de_entrega", "campos_do_pedido",
           "pedido_de_criacao", "corpo_dos_itens", "exibir_itens"]

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


# ── O pedido do agente, validado ANTES da rede ───────────────────────────────

TETO_PAGAMENTO = 100
TETO_TEXTO = 500
TETO_APARELHOS = 30
_TIPOS_DESTINO = ("cliente", "empresa")
_CAMPOS_ENDERECO = ("endereco", "numero", "complemento", "bairro", "municipio", "estado", "cep")


def destinatario(v) -> dict:
    """⚠️ Só `{tipo, id}`. No GestorHS o bloco `destinatario` ESCREVE no cadastro
    (nome, documento, endereço) e agenda o Tiny; qualquer outro campo que o
    agente mande é descartado aqui, e `nova_empresa` é recusado."""
    if not isinstance(v, dict) or v.get("tipo") not in _TIPOS_DESTINO:
        raise ValueError("Informe `destinatario`: {tipo: \"cliente\" ou \"empresa\", id}. Cliente novo "
                         "se cadastra pela tela do GestorHS.")
    return {"tipo": v["tipo"], "id": id_positivo(v.get("id"), "destinatario.id")}


def aparelhos_ids(v, campo: str = "aparelhos") -> list[int]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise ValueError(f"`{campo}` é uma lista de ids de aparelho da frota (não a série).")
    if len(v) > TETO_APARELHOS:
        raise ValueError(f"No máximo {TETO_APARELHOS} aparelhos por proposta.")
    saida = []
    for a in v:
        n = id_positivo(a, campo)
        if n not in saida:
            saida.append(n)
    return saida


def endereco_de_entrega(v) -> dict | None:
    """O endereço de entrega no formato que a TELA do GestorHS edita (`texto`);
    o PDF de lá também o prefere ao estruturado."""
    if v is None:
        return None
    if not isinstance(v, dict) or not v:
        raise ValueError("`endereco_entrega` é um objeto: " + ", ".join(_CAMPOS_ENDERECO) + ".")
    e = {}
    for k, x in v.items():
        if k not in _CAMPOS_ENDERECO:
            raise ValueError(f"`endereco_entrega` não aceita {k!r}. Válidos: {', '.join(_CAMPOS_ENDERECO)}.")
        t = texto_curto(x, f"endereco_entrega.{k}", 100)
        if t:
            e[k] = _linha(t, 101)
    if not e:
        return None
    rua = ", ".join(x for x in (e.get("endereco"), e.get("numero")) if x)
    if e.get("complemento"):
        rua = f"{rua} {e['complemento']}".strip()
    cidade = "/".join(x for x in (e.get("municipio"), (e.get("estado") or "").upper() or None) if x)
    if e.get("cep"):
        cidade = f"{cidade} — CEP: {e['cep']}".strip(" —")
    linhas = [rua, f"Bairro: {e['bairro']}" if e.get("bairro") else "", cidade]
    return {"texto": "\n".join(x for x in linhas if x)}


def _forma_dos_itens(v) -> None:
    """Só a forma (sku e quantidade), para recusar sem ir à rede; o catálogo
    resolve o resto em `itens_do_pedido`."""
    if not isinstance(v, list) or not v:
        raise ValueError("Informe `itens`: pelo menos um, com o `sku` do catálogo e a quantidade.")
    if len(v) > TETO_ITENS:
        raise ValueError(f"No máximo {TETO_ITENS} itens por proposta.")
    for n, item in enumerate(v, 1):
        if not isinstance(item, dict) or not _sku(item.get("sku")):
            raise ValueError(f"Item {n}: um objeto com `sku` (do catálogo) e `quantidade`.")
        _quantidade(item.get("quantidade"), n)
        if item.get("preco") is not None:
            dinheiro(item["preco"], f"itens[{n}].preco")


def campos_do_pedido(args: dict, *, validade: bool = False) -> dict:
    """Os campos soltos (só os que vieram), normalizados. Dinheiro em `Decimal`."""
    args = args or {}
    c: dict = {}
    for k in ("desconto", "frete"):
        if args.get(k) is not None:
            c[k] = dinheiro(args[k], k)
    for k, teto in (("condicao_pagamento", TETO_PAGAMENTO), ("contato", TETO_TEXTO),
                    ("intro", TETO_TEXTO), ("descricao_entrega", TETO_TEXTO)):
        if k in args and args[k] is not None:
            c[k] = texto_curto(args[k], k, teto)
    if args.get("data_entrega") not in (None, ""):
        c["data_entrega"] = data_iso(args["data_entrega"], "data_entrega")
    if args.get("endereco_entrega") is not None:
        c["endereco_entrega"] = endereco_de_entrega(args["endereco_entrega"])
    if validade and args.get("validade_dias") is not None:
        d = args["validade_dias"]
        if isinstance(d, bool) or not isinstance(d, int) or not 1 <= d <= 365:
            raise ValueError("`validade_dias` vai de 1 a 365.")
        c["validade_dias"] = d
    return c


def pedido_de_criacao(args: dict) -> dict:
    args = args or {}
    p = {"destinatario": destinatario(args.get("destinatario")),
         "aparelhos": aparelhos_ids(args.get("aparelhos"))}
    _forma_dos_itens(args.get("itens"))
    p["itens"] = args["itens"]
    p.update(campos_do_pedido(args))
    return p


def corpo_dos_itens(itens) -> list[dict]:
    """No formato do `PropostaItemCreate` (números em float, como o JSON leva)."""
    return [{"descricao": i["descricao"], "sku": i["sku"], "quantidade": float(i["quantidade"]),
             "unidade": i["unidade"], "preco_un": float(i["preco_un"])} for i in itens]


forma_dos_itens = _forma_dos_itens


def mesmo_texto(a, b) -> bool:
    return _normal(a) == _normal(b)


def itens_atuais(itens_da_proposta, catalogo) -> list[dict]:
    """Os itens que a proposta JÁ tem, no formato de `itens_do_pedido`. O preço de
    catálogo é o de hoje quando o sku casa uma vez só; senão, o próprio preço
    (sem lembrete: não há com o que comparar)."""
    por_sku: dict[str, list[dict]] = {}
    for c in catalogo or []:
        if isinstance(c, dict) and _sku(c.get("sku")):
            por_sku.setdefault(_sku(c.get("sku")), []).append(c)
    saida = []
    for i in itens_da_proposta or []:
        if not isinstance(i, dict):
            continue
        preco = Decimal(str(i.get("preco_un") or 0))
        achados = por_sku.get(_sku(i.get("sku"))) or []
        cat = Decimal(str(achados[0].get("preco") or 0)) if len(achados) == 1 else preco
        saida.append({"descricao": str(i.get("descricao") or ""), "sku": _sku(i.get("sku")) or None,
                      "quantidade": Decimal(str(i.get("quantidade") or 0)), "unidade": i.get("unidade"),
                      "preco_un": preco, "preco_catalogo": cat})
    return saida


def rotulo_do_item(i: dict) -> str:
    q = Decimal(str(i["quantidade"]))
    qtd = str(int(q)) if q == q.to_integral_value() else f"{q.normalize():f}".replace(".", ",")
    return f"{qtd} × {exibir_texto(i['descricao'])} — {reais(i['preco_un'])}"


def _chave_do_item(i: dict) -> tuple:
    return (i.get("sku") or "", " ".join(str(i.get("descricao") or "").split()),
            Decimal(str(i["quantidade"])).normalize(), Decimal(str(i["preco_un"])).normalize())


def itens_mudaram(antes, depois) -> bool:
    return [_chave_do_item(i) for i in antes] != [_chave_do_item(i) for i in depois]


def entram_e_saem(antes: list[str], depois: list[str]) -> tuple[list[str], list[str]]:
    """O que entra e o que sai, como multiconjunto (duas linhas iguais contam duas)."""
    from collections import Counter
    a, d = Counter(antes), Counter(depois)
    return list((d - a).elements()), list((a - d).elements())


def exibir_itens(itens) -> list[dict]:
    saida = []
    for i in itens:
        linha = (Decimal(str(i["quantidade"])) * Decimal(str(i["preco_un"]))).quantize(_CENTAVO, ROUND_HALF_UP)
        saida.append({"descricao": exibir_texto(i["descricao"]), "quantidade": float(i["quantidade"]),
                      "preco_un": float(i["preco_un"]), "total": float(linha),
                      "fora_do_catalogo": Decimal(str(i["preco_un"])) != Decimal(str(i["preco_catalogo"]))})
    return saida
