"""O que o Guardi pode ESCREVER no GestorHS — e como (12/11/2026, fase 2a: Expedição).

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-expedicao-design.md`.
Quatro ações, todas por cartão (o dono confirma, o executor roda o `payload`
gravado): receber aparelhos (abrir OS em lote), avançar caixa, fechar caixa com
o rastreio e cadastrar aparelho. Quem decide se a pessoa PODE é a função dela no
GestorHS; aqui mora a outra metade:

- validar o que o agente mandou (tipo de serviço, condição, acessórios, tetos)
  antes de existir cartão — um 422 no clique é confirmação jogada fora;
- conferir o que foi LIDO do GestorHS (aparelho com OS ativa, fase da caixa,
  série que já existe), para o cartão nunca prometer o que lá vai ser recusado;
- montar o texto do lote que parou no meio, que é o que a pessoa usa para
  decidir o resto (nada é desfeito: OS aberta é registro).

Tudo puro: levanta `ValueError` com a mensagem para o agente. Testado em
`tests/test_guardi_gestorhs_escrita.py`.
"""
from __future__ import annotations

import re
from datetime import date

from app.bots_pessoais import _linha

__all__ = ["FASES", "ATIVAS", "TIPOS", "CONDICOES", "ACESSORIOS", "TETO_LOTE",
           "aparelhos_do_lote", "conferir_aparelho", "conferir_caixa_para_receber",
           "conferir_caixa_para_avancar", "conferir_caixa_para_fechar", "conferir_cadastro",
           "texto_lote_parcial", "exibir_texto"]

# id → (nome, função dona da fase). Conferido no GestorHS em 12/11/2026.
FASES: dict[int, tuple[str, str | None]] = {
    4: ("Recebido", "Expedição"),
    5: ("Laboratório", "Laboratório"),
    6: ("Pós-Vendas", "Comercial Pós-Vendas"),
    10: ("Financeiro", "Financeiro"),
    7: ("Preparando Retorno", "Expedição"),
    8: ("Finalizada", None),
    9: ("Cancelada", None),
}
ATIVAS = (4, 5, 6, 10, 7)
RECEBIDO, PREPARANDO = 4, 7

TIPOS = {"C": "calibração", "M": "manutenção", "A": "calibração e manutenção"}
CONDICOES = ("Bom estado", "Com avarias", "Oxidado", "Lacrado", "Sem acessórios")
ACESSORIOS = {1: "Bobinas", 2: "Bocal", 3: "Cabos USB", 4: "Capa", 5: "Carregador veicular",
              6: "Carregadores AC/DC", 7: "Impressora", 8: "Maleta", 9: "Nf de Remessa"}

TETO_LOTE = 30
TETO_OBS = 500
TETO_RASTREIO = 60
TETO_SERIE = 60
_TETO_QTD = 99          # pilhas e bocais: número pequeno; acima é engano de digitação
_TETO_EXIBIR = 80


def exibir_texto(valor) -> str:
    """Texto vindo do GestorHS (cliente, modelo, série) para o cartão: uma linha,
    cortado em 80 — o mesmo cuidado do título do TaskHS."""
    return _linha(str(valor or ""), _TETO_EXIBIR)


def _id(valor, campo: str) -> int:
    if isinstance(valor, bool):
        raise ValueError(f"`{campo}` tem que ser um número (o id no GestorHS).")
    try:
        n = int(valor)
    except (TypeError, ValueError):
        raise ValueError(f"`{campo}` tem que ser um número (o id no GestorHS).") from None
    if n < 1 or str(n) != str(valor).strip():
        raise ValueError(f"`{campo}` inválido: {valor}.")
    return n


def _qtd(valor, campo: str) -> int:
    if valor is None:
        return 0
    if isinstance(valor, bool) or not isinstance(valor, int) or not 0 <= valor <= _TETO_QTD:
        raise ValueError(f"`{campo}` tem que ser um número de 0 a {_TETO_QTD}.")
    return valor


def _texto_opcional(valor, campo: str, teto: int) -> str | None:
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise ValueError(f"`{campo}` tem que ser texto.")
    t = valor.strip()
    if len(t) > teto:
        raise ValueError(f"`{campo}` passa de {teto} caracteres.")
    return t or None


def _data(valor, campo: str) -> str | None:
    if valor in (None, ""):
        return None
    try:
        return date.fromisoformat(str(valor)).isoformat()
    except ValueError:
        raise ValueError(f"`{campo}` precisa ser uma data AAAA-MM-DD.") from None


def data_de_chegada(valor) -> str | None:
    return _data(valor, "data_chegada")


def aparelhos_do_lote(args: dict) -> list[dict]:
    """A lista de aparelhos de um recebimento, normalizada no formato do
    `POST /ordens` do GestorHS (`OrdemAbrirIn`)."""
    lista = (args or {}).get("aparelhos")
    if not isinstance(lista, list) or not lista:
        raise ValueError("Informe `aparelhos`: a lista com pelo menos um aparelho.")
    if len(lista) > TETO_LOTE:
        raise ValueError(f"No máximo {TETO_LOTE} aparelhos por recebimento — divida em dois.")
    saida, vistos = [], set()
    for n, item in enumerate(lista, 1):
        if not isinstance(item, dict):
            raise ValueError(f"Aparelho {n}: um objeto com `id` e `tipo_servico`.")
        ident = _id(item.get("id"), f"aparelhos[{n}].id")
        if ident in vistos:
            raise ValueError(f"O aparelho {ident} aparece duas vezes no lote.")
        vistos.add(ident)
        tipo = item.get("tipo_servico")
        if tipo not in TIPOS:
            raise ValueError(f"Aparelho {ident}: `tipo_servico` é C (calibração), M (manutenção) "
                             "ou A (as duas).")
        condicao = item.get("condicao")
        if condicao is not None and condicao not in CONDICOES:
            raise ValueError(f"Aparelho {ident}: `condicao` é uma de {', '.join(CONDICOES)}.")
        acess = item.get("acessorios") or []
        if not isinstance(acess, list):
            raise ValueError(f"Aparelho {ident}: `acessorios` é uma lista de ids.")
        checklist = []
        for a in acess:
            if isinstance(a, bool) or not isinstance(a, int) or a not in ACESSORIOS:
                validos = ", ".join(f"{k} {v}" for k, v in ACESSORIOS.items())
                raise ValueError(f"Aparelho {ident}: acessório {a!r} desconhecido. Válidos: {validos}.")
            if a not in checklist:
                checklist.append(a)
        saida.append({"equipamento_cliente": ident, "tipo_servico": tipo,
                      "condicao_chegada": condicao, "checklist": checklist,
                      "pilhas": _qtd(item.get("pilhas"), "pilhas"),
                      "bocais": _qtd(item.get("bocais"), "bocais"),
                      "observacoes": _texto_opcional(item.get("observacao"), "observacao", TETO_OBS)})
    return saida


def _ordens(ordens) -> list[dict]:
    if isinstance(ordens, dict):
        ordens = ordens.get("items") or []
    return [o for o in (ordens or []) if isinstance(o, dict)]


def conferir_aparelho(item: dict, aparelho: dict, ordens) -> dict:
    """Recebe o GET do aparelho e o das OS dele. Recusa aparelho com OS ativa
    (o GestorHS daria 409 no clique, no meio do lote) e devolve a linha do cartão."""
    aparelho = aparelho or {}
    serie = exibir_texto(aparelho.get("serie")) or f"id {item['equipamento_cliente']}"
    cliente = exibir_texto(aparelho.get("cliente_nome"))
    ativa = [o for o in _ordens(ordens) if o.get("fase") in ATIVAS]
    if ativa:
        o = ativa[0]
        fase = FASES.get(o.get("fase"), ("?", None))[0]
        raise ValueError(f"O aparelho série {serie} ({cliente or 'cliente ?'}) já tem a OS {o.get('id')} "
                         f"ativa, em {fase}. Tire-o do lote ou finalize a OS antes.")
    if aparelho.get("ativo") is False:
        raise ValueError(f"O aparelho série {serie} ({cliente or 'cliente ?'}) está inativo no GestorHS.")
    return {"cliente": cliente, "modelo": exibir_texto(aparelho.get("equipamento_descricao")),
            "serie": serie}


def _fase(caixa: dict) -> tuple[int | None, str]:
    f = (caixa or {}).get("fase")
    nome = FASES.get(f, (None, None))[0] or exibir_texto((caixa or {}).get("fase_descricao")) or "sem fase"
    return f, nome


def conferir_caixa_para_receber(caixa: dict) -> str | None:
    """Caixa existente, em qualquer fase ativa (decisão do Erick, 12/11): a OS nova
    entra na fase em que a caixa está. Fora de Recebido, devolve o aviso."""
    f, nome = _fase(caixa)
    if f not in ATIVAS:
        raise ValueError(f"A caixa {caixa.get('id')} está {nome}: não recebe OS nova. "
                         "Deixe sem `caixa` para abrir uma nova.")
    if f != RECEBIDO:
        return f"a OS já entra em {nome}"
    return None


def _clientes(caixa: dict) -> list[str]:
    return [exibir_texto(c) for c in (caixa.get("clientes") or [])][:20]


def conferir_caixa_para_avancar(caixa: dict, cliente_principal: int | None) -> dict:
    """Avançar é para qualquer função dona da fase (o GestorHS confere). Daqui só
    o que dá para saber antes: Preparando Retorno é "fechar", inativa não anda, e
    caixa de clientes misturados não sai de Recebido sem o cliente principal."""
    f, nome = _fase(caixa)
    if f == PREPARANDO:
        raise ValueError(f"A caixa {caixa.get('id')} está em Preparando Retorno: para despachar, use "
                         "gestorhs_fechar_caixa com o código de rastreio.")
    if f not in ATIVAS:
        raise ValueError(f"A caixa {caixa.get('id')} está {nome}: não há para onde avançar.")
    clientes = _clientes(caixa)
    if (f == RECEBIDO and len(caixa.get("clientes") or []) > 1
            and not caixa.get("cliente_principal") and not cliente_principal):
        raise ValueError(f"A caixa {caixa.get('id')} tem {len(caixa['clientes'])} clientes "
                         f"({', '.join(clientes)}): pergunte qual é o principal e mande "
                         "`cliente_principal` (o id do cliente).")
    return {"fase": nome, "funcao": FASES[f][1], "total_os": int(caixa.get("total_os") or 0),
            "clientes": clientes}


def conferir_caixa_para_fechar(caixa: dict, cod_retorno) -> dict:
    """Fechar é o avanço de Preparando Retorno para Finalizada, que exige o rastreio."""
    f, nome = _fase(caixa)
    if f != PREPARANDO:
        raise ValueError(f"A caixa {caixa.get('id')} está {nome}, não em Preparando Retorno: "
                         "só lá ela fecha. Para andar de fase, use gestorhs_avancar_caixa.")
    cod = cod_retorno.strip() if isinstance(cod_retorno, str) else ""
    if not 1 <= len(cod) <= TETO_RASTREIO:
        raise ValueError(f"Informe `cod_retorno`, o código de rastreio (até {TETO_RASTREIO} caracteres).")
    return {"cod_retorno": cod, "total_os": int(caixa.get("total_os") or 0), "clientes": _clientes(caixa)}


def _serie_chave(s) -> str:
    return re.sub(r"\s+", "", str(s or "")).upper()


def conferir_cadastro(args: dict, achados) -> dict:
    """O payload do `POST /equipamentos-cliente`. `achados` é o GET
    `equipamentos-cliente?q=<série>`: série igual (sem diferenciar maiúscula e
    espaço) já na frota é recusada dizendo de qual cliente é."""
    args = args or {}
    payload: dict = {"cliente": _id(args.get("cliente"), "cliente"),
                     "equipamento": _id(args.get("equipamento"), "equipamento")}
    serie = _texto_opcional(args.get("serie"), "serie", TETO_SERIE)
    if not serie:
        raise ValueError("Informe a `serie` do aparelho.")
    payload["serie"] = serie
    pat = _texto_opcional(args.get("patrimonio"), "patrimonio", TETO_SERIE)
    if pat:
        payload["patrimonio"] = pat
    for campo in ("datacompra", "ult_calibragem", "prox_calibragem"):
        d = _data(args.get(campo), campo)
        if d:
            payload[campo] = d
    chave = _serie_chave(serie)
    for a in _ordens(achados):
        if _serie_chave(a.get("serie")) == chave:
            raise ValueError(f"A série {exibir_texto(a.get('serie'))} já está cadastrada no GestorHS, "
                             f"no cliente {exibir_texto(a.get('cliente_nome')) or '?'} (aparelho id "
                             f"{a.get('id')}). Não cadastre de novo: use esse id.")
    return payload


def texto_lote_parcial(n_ok: int, total: int, serie_falhou: str, motivo: str,
                       os_abertas: list[int], caixa: int | None) -> str:
    """O `erro` do cartão quando o lote para no meio. Nada é desfeito."""
    abertas = ", ".join(str(o) for o in os_abertas)
    onde = f" na caixa {caixa}" if caixa else ""
    return (f"Parou no aparelho {n_ok + 1} de {total} (série {serie_falhou}): {motivo}. "
            f"Já abertas{onde}: OS {abertas}. Nada foi desfeito — os {total - n_ok} restantes "
            "não foram abertos; confira no GestorHS e decida o resto.")
