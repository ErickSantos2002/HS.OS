"""Preparar as escritas do Guardi em Serviços/Cobrança do HSGrowth (12/11/2026).

Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`.
As cinco ferramentas de escrita passam por `preparar`: só LÊ o HSGrowth (e o
GestorHS, para a proposta), confere com as regras puras de
`app/hsgrowth_servicos_escrita.py` e devolve `(payload, resumo)` para o
`mcp_bot` gravar o cartão. Nada é escrito antes do clique do dono.

- O payload é exatamente o CONTRATO escrito acima dos executores de Serviços em
  `app/acoes.py`. O `_exibir` leva só NOMES e o "antes" (saneados em uma linha);
  os valores que serão executados ficam só no payload — o cartão os lê de lá.
- Recusa = `ValueError` com mensagem para a pessoa (o `mcp_bot` devolve ao agente).
- Sem dono no card: qualquer `service` escreve em qualquer card dos quadros 1 e 2
  (decisão da spec). O que segura é o cartão, a lista fechada e o "uma etapa".
- ⚠️ O card de Serviços do HSGrowth NÃO traz `board_id` (o `ServiceCardResponse`
  não tem o campo): ele é posto aqui, com o quadro da rota, antes das regras.

Testado em `tests/test_guardi_hsgrowth_servicos_preparar.py`.
"""
from __future__ import annotations

from app import acoes
from app import hsgrowth_servicos_escrita as hgse
from app.config import settings
from app.hsgrowth_escrita import uma_linha
from app.sistemas import gestorhs, hsgrowth

__all__ = ["ESCRITAS", "TETO_ITENS", "AVISO_GANHO", "preparar"]

ESCRITAS = ("hsgrowth_servicos_registrar", "hsgrowth_servicos_itens", "hsgrowth_servicos_ganhar",
            "hsgrowth_servicos_perder", "hsgrowth_servicos_anexar_proposta")
TETO_ITENS = 10
# Até o HSGrowth expor `external_source` no card (item 3 de "Para o HSGrowth"),
# o Guardi não sabe se o card veio do GestorHS: o aviso é condicional.
AVISO_GANHO = "Se este card veio do GestorHS, o ganho avisa o GestorHS e a caixa vai para o Financeiro."
_NOMES_QUADRO = {1: "Serviços", 2: "Cobrança"}


# --- leitura -------------------------------------------------------------------------

def _id(v, campo: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or v <= 0:
        raise ValueError(f"`{campo}` tem que ser o número (id) no HSGrowth.")
    return v


def _quadro(v) -> int:
    if isinstance(v, bool) or v not in hgse.QUADROS:
        raise ValueError("Só mexo nos quadros Serviços (1) e Serviço - Cobrança (2).")
    return v


def _itens(r, chave: str) -> list[dict]:
    if isinstance(r, dict):
        r = r.get(chave) or []
    return [x for x in (r if isinstance(r, list) else []) if isinstance(x, dict)]


async def _get(ctx: dict, bot: str, caminho: str, params=None, nao_achou: str | None = None):
    try:
        return await hsgrowth.chamar(ctx["email"], bot, caminho, params=params, dono=ctx["dono"])
    except hsgrowth.ErroSistema as e:
        if e.status == 404 and nao_achou:
            raise ValueError(nao_achou) from e
        raise


def _base(board: int, cid: int) -> str:
    return f"/service-boards/{board}/cards/{cid}"


async def _etapas(ctx: dict, bot: str, board: int) -> list[dict]:
    r = await _get(ctx, bot, f"/service-boards/{board}/lists")
    # `ServiceListResponse` tem `board_id`; se faltar, é o do quadro pedido.
    return [{**e, "board_id": e.get("board_id", board)} for e in _itens(r, "lists")
            if e.get("board_id", board) == board]


async def _card(ctx: dict, bot: str, board: int, cid: int) -> tuple[dict, list[dict]]:
    """O card e as etapas do quadro. ⚠️ O HSGrowth acha o card SÓ pelo id e ignora o
    `board_id` da rota: o que prova que o card é do quadro é a etapa dele estar
    entre as etapas do quadro. Sem isso, `board_id: 1` abriria card de quadro livre."""
    card = await _get(ctx, bot, _base(board, cid),
                      nao_achou=f"O card {cid} não existe no quadro {_NOMES_QUADRO[board]} — ache o id "
                                "com hsgrowth_servicos_consultar buscar.")
    if not isinstance(card, dict) or card.get("id") != cid:
        raise ValueError(f"O HSGrowth não devolveu o card {cid}; não preparo às cegas.")
    etapas = await _etapas(ctx, bot, board)
    if card.get("list_id") not in {e.get("id") for e in etapas}:
        raise ValueError(f"O card {cid} não é do quadro {_NOMES_QUADRO[board]} ({board}) — ache o "
                         "quadro certo com hsgrowth_servicos_consultar buscar.")
    # O card não traz o quadro: é o da rota, agora conferido.
    return {**card, "board_id": board}, etapas


async def _doc_do_cliente(ctx: dict, bot: str, client_id) -> str | None:
    """O CNPJ/CPF do cliente do card. ⚠️ O GET de um card não traz `client_document`
    (só a listagem traz): sem ler o cliente, "proposta de outro cliente" nunca avisaria."""
    if isinstance(client_id, bool) or not isinstance(client_id, int):
        return None
    return (await _cadastro(ctx, bot, "cliente", client_id)).get("document")


async def _atividades_do_card(ctx: dict, bot: str, board: int, cid: int) -> list[dict]:
    return _itens(await _get(ctx, bot, _base(board, cid) + "/activities"), "activities")


def _nome_etapa(etapas: list[dict], lid) -> str:
    e = next((e for e in etapas if e.get("id") == lid), None)
    return uma_linha((e or {}).get("name")) or f"etapa {lid}"


def _exibir(card: dict, board: int) -> dict:
    return {"card": uma_linha(card.get("title")) or f"card {card['id']}",
            "link": f"{settings.HSGROWTH_URL.rstrip('/')}/servicos/{board}/cards/{card['id']}",
            "quadro": _NOMES_QUADRO[board], "cliente": uma_linha(card.get("client_name")),
            "contato": uma_linha(card.get("person_name"))}


_ENCERRADO = "Este card está encerrado (ganho ou perdido); reabrir é com o time de TI."


def _encerrado(card: dict, etapas: list[dict]) -> bool:
    return hgse.terminal(next((e for e in etapas if e.get("id") == card.get("list_id")), None))


# --- proposta no GestorHS -------------------------------------------------------------

async def _proposta(ctx: dict, bot: str, numero: int) -> dict | None:
    """A proposta de NÚMERO `numero` (não o id). A busca `q` casa nome e documento
    também: só vale o `numero` exato."""
    r = await gestorhs.chamar(ctx["email"], bot, "/propostas", params={"q": str(numero), "page_size": 100},
                              dono=ctx["dono"])
    return next((p for p in _itens(r, "items") if p.get("numero") == numero), None)


def _doc_da_proposta(p: dict) -> str | None:
    dest = p.get("destinatario") if isinstance(p.get("destinatario"), dict) else {}
    return p.get("cliente_documento") or dest.get("documento")


def _valor(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _exibir_proposta(p: dict) -> dict:
    return {"numero": p.get("numero"), "cliente": uma_linha(p.get("cliente_nome")),
            "valor": _valor(p.get("total"))}


async def _conferir_proposta(ctx: dict, bot: str, numero: int, doc_cliente) -> tuple[dict | None, list[str]]:
    """Para o `registrar`: diferença vira AVISO, nunca recusa (decisão da spec)."""
    try:
        p = await _proposta(ctx, bot, numero)
    except gestorhs.ErroSistema as e:
        return None, [f"Não consegui conferir a proposta {numero} no GestorHS ({uma_linha(e, 120)})"]
    if p is None:
        return None, [f"A proposta {numero} não foi achada no GestorHS — confira o número"]
    avisos = []
    if hgse.mesmo_cliente(doc_cliente, _doc_da_proposta(p)) is False:
        avisos.append(f"A proposta {numero} é de {uma_linha(p.get('cliente_nome')) or 'outro cliente'}, "
                      "não do cliente do card")
    return _exibir_proposta(p), avisos


# --- registrar ------------------------------------------------------------------------

async def _cadastro(ctx: dict, bot: str, tipo: str, i: int) -> dict:
    caminho, o_que = ("/clients", "cliente") if tipo == "cliente" else ("/persons", "contato")
    r = await _get(ctx, bot, f"{caminho}/{i}",
                   nao_achou=f"O {o_que} {i} não existe no HSGrowth — procure com "
                             f"hsgrowth_servicos_consultar {'clientes' if tipo == 'cliente' else 'contatos'}.")
    if not isinstance(r, dict) or r.get("id") != i:
        raise ValueError(f"O HSGrowth não devolveu o {o_que} {i}; não preparo às cegas.")
    return r


async def _registrar(ctx: dict, bot: str, args: dict) -> tuple[dict, str]:
    board = _quadro(args.get("board_id"))
    cid = _id(args.get("card_id"), "card_id")
    pedido = [k for k in ("negocio", "campos", "atividades", "mover_para")
              if args.get(k) not in (None, "", [], {})]
    if not pedido:
        raise ValueError("Diga o que registrar: negocio, campos, atividades ou mover_para.")
    # O que dá para validar sem rede, antes da rede.
    negocio = hgse.negocio(args["negocio"], board) if "negocio" in pedido else None
    campos = hgse.campos_do_card(args["campos"]) if "campos" in pedido else None
    destino = _id(args["mover_para"], "mover_para") if "mover_para" in pedido else None

    card, etapas = await _card(ctx, bot, board, cid)
    ex = _exibir(card, board)
    avisos: list[str] = []
    payload: dict = {"board_id": board, "card_id": cid}
    resumo: list[str] = []

    if _encerrado(card, etapas):
        ops = args.get("atividades") if isinstance(args.get("atividades"), list) else []
        if negocio or campos or destino or any(not isinstance(o, dict) or o.get("op") != "criar" for o in ops):
            raise ValueError(_ENCERRADO + " Nele só entram atividade e anotação novas.")

    if negocio:
        atual = card.get("business_info") if isinstance(card.get("business_info"), dict) else {}
        ex["negocio_antes"] = {k: (atual.get(k) if isinstance(atual.get(k), (bool, int, float))
                                   or atual.get(k) is None else uma_linha(atual.get(k)))
                               for k in negocio}
        payload["negocio"] = negocio
        resumo.append("Resumo")

    doc_cliente = None
    if campos:
        cli_id = campos.get("client_id")
        con_id = campos.get("person_id")
        cliente_novo = None
        if cli_id is not None and cli_id != card.get("client_id"):
            cliente_novo = await _cadastro(ctx, bot, "cliente", cli_id)
            ex["cliente_novo"] = uma_linha(cliente_novo.get("name")) or f"cliente {cli_id}"
        efetivo = cli_id if cli_id is not None else card.get("client_id")
        # O contato tem de ser do cliente: o novo que veio, ou o atual se o cliente mudou.
        conferir = con_id if con_id is not None else (card.get("person_id") if cliente_novo else None)
        if conferir is not None:
            pessoa = await _cadastro(ctx, bot, "contato", conferir)
            if pessoa.get("organization_id") != efetivo:
                if con_id is None:
                    raise ValueError(f"O contato atual do card ({uma_linha(pessoa.get('name'))}) não é do "
                                     "cliente novo: diga também o contato (person_id) do cliente.")
                raise ValueError(f"O contato {con_id} não é do cliente do card — veja "
                                 "hsgrowth_servicos_consultar contatos.")
            if con_id is not None and con_id != card.get("person_id"):
                ex["contato_novo"] = uma_linha(pessoa.get("name")) or f"contato {con_id}"
        if cliente_novo is not None:
            # A proposta confere com o cliente que o card VAI ter.
            doc_cliente = cliente_novo.get("document")
        payload["campos"] = campos
        resumo.append("dados do card")

    if "atividades" in pedido:
        acts = await _atividades_do_card(ctx, bot, board, cid)
        pendentes = {a["id"]: a for a in acts if a.get("category") == "atividade"
                     and not a.get("is_completed") and isinstance(a.get("id"), int)}
        ops = hgse.atividades(args["atividades"], pendentes)
        ex["atividades_nomes"] = {str(o["activity_id"]): uma_linha(pendentes[o["activity_id"]].get("title"))
                                  for o in ops if o["op"] == "concluir"}
        payload["atividades"] = ops
        n = len(ops)
        resumo.append(f"{n} atividade{'s' if n > 1 else ''}")

    if destino is not None:
        mov = hgse.conferir_movimento(card, etapas, destino)
        payload["mover"] = mov
        ex["etapa_de"] = _nome_etapa(etapas, mov["de"])
        ex["etapa_para"] = _nome_etapa(etapas, mov["para"])
        resumo.append(f"mover para {ex['etapa_para']}")

    numero = (negocio or {}).get("proposal_number")
    atual_bi = card.get("business_info") if isinstance(card.get("business_info"), dict) else {}
    if numero is not None and str(atual_bi.get("proposal_number")) != str(numero) \
            and "gestorhs" in (ctx.get("sistemas") or []):
        if doc_cliente is None:
            doc_cliente = await _doc_do_cliente(ctx, bot, card.get("client_id"))
        prop, av = await _conferir_proposta(ctx, bot, numero, doc_cliente)
        if prop:
            ex["proposta"] = prop
        avisos += av

    if avisos:
        ex["aviso"] = " · ".join(avisos)
    payload["_exibir"] = ex
    return payload, uma_linha(f"HSGrowth Serviços · {ex['card']} — " + ", ".join(resumo), 200)


# --- itens ----------------------------------------------------------------------------

async def _itens_do_card(ctx: dict, bot: str, board: int, cid: int, tipo: str) -> dict[int, dict]:
    rota = "products" if tipo == "aparelho" else "services"
    linhas = _itens(await _get(ctx, bot, f"{_base(board, cid)}/{rota}"), "items")
    return {x["id"]: x for x in linhas if isinstance(x.get("id"), int)}


async def _catalogo(ctx: dict, bot: str, tipo: str) -> dict[int, dict]:
    if tipo == "aparelho":
        linhas = _itens(await _get(ctx, bot, "/service-products", {"is_active": "true", "limit": "1000"}),
                        "items")
    else:
        linhas = _itens(await _get(ctx, bot, "/services", {"page_size": "1000", "is_active": "true"}),
                        "services")
    return {x["id"]: x for x in linhas if isinstance(x.get("id"), int)}


async def _itens_op(ctx: dict, bot: str, args: dict) -> tuple[dict, str]:
    board = _quadro(args.get("board_id"))
    cid = _id(args.get("card_id"), "card_id")
    pedidos = args.get("itens")
    if not isinstance(pedidos, list) or not pedidos:
        raise ValueError("Diga quais itens pôr, alterar ou tirar (`itens`).")
    if len(pedidos) > TETO_ITENS:
        raise ValueError(f"No máximo {TETO_ITENS} itens por cartão.")
    tipos = []
    for op in pedidos:
        t = op.get("tipo") if isinstance(op, dict) else None
        if t not in ("aparelho", "servico"):
            raise ValueError("Cada item tem `tipo`: aparelho ou servico.")
        if t not in tipos:
            tipos.append(t)
    card, etapas = await _card(ctx, bot, board, cid)
    if _encerrado(card, etapas):
        raise ValueError(_ENCERRADO)
    catalogos = {t: await _catalogo(ctx, bot, t) for t in tipos}
    no_card = {t: await _itens_do_card(ctx, bot, board, cid, t) for t in tipos}
    ids = {t: set(c) for t, c in catalogos.items()}
    ops, nomes = [], []
    for op in pedidos:
        o = hgse.item(op, ids, no_card)
        if o["acao"] == "por":
            chave = "product_id" if o["tipo"] == "aparelho" else "service_id"
            nome = catalogos[o["tipo"]][o["corpo"][chave]].get("name")
        else:
            linha = no_card[o["tipo"]][o["item_id"]]
            nome = linha.get("product_name") if o["tipo"] == "aparelho" else linha.get("service_name")
        ops.append(o)
        nomes.append(uma_linha(nome) or o["tipo"])
    ex = {**_exibir(card, board), "itens_nomes": nomes}
    rot = {"por": "pôr", "alterar": "alterar", "tirar": "tirar"}
    resumo = "; ".join(f"{rot[o['acao']]} {n}" for o, n in zip(ops, nomes))
    return ({"board_id": board, "card_id": cid, "ops": ops, "_exibir": ex},
            uma_linha(f"HSGrowth Serviços · {ex['card']} — itens: {resumo}", 200))


# --- ganhar / perder ------------------------------------------------------------------

async def _ganhar(ctx: dict, bot: str, args: dict) -> tuple[dict, str]:
    board = _quadro(args.get("board_id"))
    cid = _id(args.get("card_id"), "card_id")
    card, etapas = await _card(ctx, bot, board, cid)
    biz = card.get("business_info") if isinstance(card.get("business_info"), dict) else {}
    mov = hgse.conferir_ganho(card, etapas, biz)
    ex = {**_exibir(card, board), "etapa_de": _nome_etapa(etapas, mov["de"]),
          "etapa_para": _nome_etapa(etapas, mov["para"]), "valor": _valor(card.get("value")),
          "aviso": AVISO_GANHO}
    if biz.get("proposal_number") is not None:
        ex["proposta"] = uma_linha(biz.get("proposal_number"))
    return ({"board_id": board, "card_id": cid, "de": mov["de"], "para": mov["para"], "_exibir": ex},
            uma_linha(f"HSGrowth Serviços · {ex['card']} — marcar como GANHO", 200))


async def _perder(ctx: dict, bot: str, args: dict) -> tuple[dict, str]:
    board = _quadro(args.get("board_id"))
    cid = _id(args.get("card_id"), "card_id")
    motivo = hgse.motivo_da_perda(args.get("motivo"))
    card, etapas = await _card(ctx, bot, board, cid)
    origem = next((e for e in etapas if e.get("id") == card.get("list_id")), None)
    if origem is None:
        raise ValueError("Não achei a etapa atual do card no quadro; não movo às cegas.")
    if hgse.terminal(origem):
        raise ValueError(_ENCERRADO)
    destino = next((e for e in etapas if e.get("is_lost_stage")), None) \
        or next((e for e in etapas if "perdido" in str(e.get("name") or "").lower()), None)
    if destino is None:
        raise ValueError("Não achei a etapa de Negócio Perdido no quadro.")
    ex = {**_exibir(card, board), "etapa_de": _nome_etapa(etapas, origem["id"]),
          "etapa_para": _nome_etapa(etapas, destino["id"])}
    return ({"board_id": board, "card_id": cid, "de": origem["id"], "para": destino["id"],
             "motivo": motivo, "_exibir": ex},
            uma_linha(f"HSGrowth Serviços · {ex['card']} — marcar como PERDIDO ({motivo})", 200))


# --- anexar proposta ------------------------------------------------------------------

async def _anexar(ctx: dict, bot: str, args: dict) -> tuple[dict, str]:
    board = _quadro(args.get("board_id"))
    cid = _id(args.get("card_id"), "card_id")
    numero = args.get("numero")
    if isinstance(numero, bool) or not isinstance(numero, int) or numero <= 0:
        raise ValueError("`numero` é o número da proposta no GestorHS (não o id).")
    if "gestorhs" not in (ctx.get("sistemas") or []):
        raise ValueError("O GestorHS não está ligado para mim, então não tenho de onde tirar o PDF da "
                         "proposta: anexe pela tela do card.")
    card, etapas = await _card(ctx, bot, board, cid)
    if _encerrado(card, etapas):
        raise ValueError(_ENCERRADO)
    prop = await _proposta(ctx, bot, numero)
    if prop is None:
        raise ValueError(f"A proposta {numero} não foi achada no GestorHS: confira o número ou anexe "
                         "pela tela do card.")
    link = prop.get("link_pdf")
    if not isinstance(link, str) or not link:
        raise ValueError(f"O GestorHS não deu o link do PDF da proposta {numero}: anexe pela tela do card.")
    try:
        # Baixa já aqui (só GET, link público): PDF que não baixa recusa antes do cartão.
        await acoes.baixar_pdf(link)
    except hsgrowth.ErroSistema as e:
        motivo = str(e).split(";")[0]
        raise ValueError(f"{motivo[:1].upper()}{motivo[1:]}: anexe pela tela do card.") from e
    ex = {**_exibir(card, board), "proposta": _exibir_proposta(prop)}
    avisos = []
    doc = await _doc_do_cliente(ctx, bot, card.get("client_id"))
    if hgse.mesmo_cliente(doc, _doc_da_proposta(prop)) is False:
        avisos.append(f"A proposta {numero} é de {uma_linha(prop.get('cliente_nome')) or 'outro cliente'}, "
                      "não do cliente do card")
    acts = await _atividades_do_card(ctx, bot, board, cid)
    atual = next((a for a in acts if a.get("category") == "arquivo"
                  and isinstance(a.get("activity_metadata"), dict)
                  and a["activity_metadata"].get("doc_slot") == "proposta"), None)
    if atual is not None:
        ex["substitui"] = uma_linha(atual.get("file_name")) or "o arquivo atual"
        avisos.append(f"substitui {ex['substitui']}, que está no slot Proposta")
    if avisos:
        ex["aviso"] = " · ".join(avisos)
    return ({"board_id": board, "card_id": cid, "numero": numero, "link_pdf": link,
             "nome_arquivo": f"Proposta {numero}.pdf", "_exibir": ex},
            uma_linha(f"HSGrowth Serviços · {ex['card']} — anexar a proposta {numero}", 200))


_PREPAROS = {"hsgrowth_servicos_registrar": _registrar, "hsgrowth_servicos_itens": _itens_op,
             "hsgrowth_servicos_ganhar": _ganhar, "hsgrowth_servicos_perder": _perder,
             "hsgrowth_servicos_anexar_proposta": _anexar}


async def preparar(ctx: dict, bot: str, nome: str, args: dict) -> tuple[dict, str]:
    """`(payload, resumo)` da ação `nome` (= nome da ferramenta). Só GET; recusa é `ValueError`."""
    if nome not in _PREPAROS:
        raise ValueError(f"Ferramenta desconhecida: {nome}.")
    return await _PREPAROS[nome](ctx, bot, args if isinstance(args, dict) else {})
