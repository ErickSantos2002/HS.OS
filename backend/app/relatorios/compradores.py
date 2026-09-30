"""
Relatório: quem comprou um produto — DataCoreHS (ERP Tiny)

⚠️ **Existe porque o modelo não consegue escrever a lista.** Em 30/09/2026 o
CEO pediu "todas as empresas, inclusive as que compraram 1 unidade" de Phoebus.
A Iris apurou certo (137 empresas, 757 unidades), mas ao escrever a tabela bateu
no teto de saída do modelo (8.192 tokens) e o turno inteiro se perdeu — três
vezes seguidas, com a Nina culpando "contexto estourado". Lista longa escrita por
LLM também é cara, lenta e sujeita a erro de digitação. Aqui a lista sai do banco
direto para a planilha; o agente só recebe o resumo.

⚠️ **A régua é a da skill `faturamento`** (`backend/skills/faturamento/SKILL.md`,
seção "Produto: unidades, compradores e devolução"). Mudou lá, muda aqui — as
âncoras dos testes são as mesmas da skill, para as duas não divergirem em
silêncio:

  1. CFOP da NOTA em `CFOP_VALIDOS`, lido de `tiny.configuracoes`.
  2. `descricao_situacao` = Emitida DANFE e `valor_nota` > 0.
  3. Nenhum marcador de `MARCADORES_INVALIDOS`.
  4. Item pelo nome EXATO — `ILIKE` traz fonte, placa e impressora junto.
  5. Devolução (CFOP 1202/2202) só é abatida quando a venda que ela cita nas
     `observacoes` AINDA conta na régua. Se a origem já saiu por marcador,
     abater de novo conta a mesma devolução duas vezes — o erro de 30/09, em que
     "bruto cheio − devoluções" deu 230 Phoebus em 2025 no lugar de 217.

Valor é o do ITEM (`itens_nota.valor_total`), não o da nota: a nota tem frete e
outros produtos.
"""
import io
import re
import unicodedata
from collections import defaultdict
from datetime import date

import psycopg
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

MODOS = ("raiz_cnpj", "nome")

HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
HEADER_FONT = Font(color="FFFFFF", bold=True)
TITULO_FONT = Font(bold=True, size=14)

# A nota de devolução cita a de origem em texto livre: "faturado na DANFE de
# venda 006031", "faturado na NF de venda 4743", "nota de Remessa de Saída DANFE
# 5542". O número vem depois de DANFE/NF, com até ~25 caracteres no meio.
_REF = re.compile(r"(?:DANFE|NF)[^0-9]{0,25}(\d{3,6})", re.IGNORECASE)

# Sufixos societários que fazem a mesma empresa parecer duas quando se agrupa
# por nome ("NACIONAL GAS BUTANO DISTRIBUIDORA LTDA" × "... LTDA.").
_SUFIXOS = {"SA", "S", "A", "LTDA", "ME", "EPP", "EIRELI", "CIA"}


def referencia_da_devolucao(observacoes: str | None) -> str | None:
    """O número (com 6 dígitos) da nota que a devolução diz estar devolvendo."""
    m = _REF.search(observacoes or "")
    return m.group(1).zfill(6) if m else None


def normalizar_nome(nome: str | None) -> str:
    """Maiúsculas, sem acento, sem pontuação e sem sufixo societário."""
    s = unicodedata.normalize("NFKD", nome or "").encode("ascii", "ignore").decode()
    palavras = re.sub(r"[^A-Za-z0-9 ]", " ", s).upper().split()
    return " ".join(p for p in palavras if p not in _SUFIXOS)


def chave_de_grupo(cpf_cnpj: str | None, nome: str | None, modo: str) -> str:
    """A que "empresa" uma nota pertence.

    `raiz_cnpj`: os 8 primeiros dígitos juntam filiais (a Nacional Gás tem 25
    CNPJs). CPF fica inteiro — pessoa não tem filial. Sem documento, cai no nome.
    `nome`: só o nome normalizado. `consolidar` NÃO usa este modo sozinho — ver
    o comentário de lá.
    """
    if modo == "nome":
        return "nome:" + normalizar_nome(nome)
    dig = re.sub(r"\D", "", cpf_cnpj or "")
    if len(dig) == 14:
        return "cnpj:" + dig[:8]
    if len(dig) == 11:
        return "cpf:" + dig
    return "nome:" + normalizar_nome(nome)


def consolidar(vendas: list[dict], devolucoes: list[dict], modo: str) -> dict:
    """Junta vendas e devoluções abatidas por empresa. Função pura — é o que os
    testes exercitam.

    `vendas`: {numero, data, cpf_cnpj, nome, quantidade, valor}
    `devolucoes`: as mesmas chaves + `decisao` ("abater" ou o motivo de não
    abater). Só as `abater` mexem nos totais; as outras vão para a aba de
    conferência, com o porquê.
    """
    grupos: dict[str, dict] = {}

    # ⚠️ **"nome" começa pela raiz e só então junta por nome.** Agrupar direto
    # pelo nome SEPARA filiais que o cadastro grafou diferente — medido em
    # 30/09/2026: 153 "empresas" de Phoebus contra 137 por raiz, o contrário de
    # "juntar a mesma empresa". Aqui duas raízes viram uma só quando algum nome
    # normalizado delas coincide (união, então A~B e B~C juntam os três).
    pai: dict[str, str] = {}

    def raiz(k):
        while pai.setdefault(k, k) != k:
            k = pai[k]
        return k

    if modo == "nome":
        dono_do_nome: dict[str, str] = {}
        for linha in (*vendas, *devolucoes):
            k = raiz(chave_de_grupo(linha.get("cpf_cnpj"), linha.get("nome"), "raiz_cnpj"))
            n = normalizar_nome(linha.get("nome"))
            if n in dono_do_nome:
                a = raiz(dono_do_nome[n])
                if a != k:
                    pai[a] = k
            else:
                dono_do_nome[n] = k

    def grupo(linha):
        k = chave_de_grupo(linha.get("cpf_cnpj"), linha.get("nome"), "raiz_cnpj")
        if modo == "nome":
            k = raiz(k)
        g = grupos.get(k)
        if g is None:
            g = grupos[k] = {"chave": k, "nomes": defaultdict(int),
                             "documentos": set(), "notas": set(), "brutas": 0,
                             "valor_bruto": 0.0, "devolvidas": 0,
                             "valor_devolvido": 0.0, "primeira": None, "ultima": None}
        if linha.get("cpf_cnpj"):
            g["documentos"].add(linha["cpf_cnpj"])
        g["nomes"][linha.get("nome") or "(sem nome)"] += 1
        return g

    por_ano: dict[int, dict] = defaultdict(lambda: {"brutas": 0, "valor_bruto": 0.0,
                                                    "devolvidas": 0, "valor_devolvido": 0.0})
    for v in vendas:
        g = grupo(v)
        g["notas"].add(v["numero"])
        g["brutas"] += int(v["quantidade"])
        g["valor_bruto"] += float(v["valor"])
        d = v["data"]
        g["primeira"] = d if g["primeira"] is None or d < g["primeira"] else g["primeira"]
        g["ultima"] = d if g["ultima"] is None or d > g["ultima"] else g["ultima"]
        a = por_ano[d.year]
        a["brutas"] += int(v["quantidade"])
        a["valor_bruto"] += float(v["valor"])

    for dv in devolucoes:
        if dv.get("decisao") != "abater":
            continue
        g = grupo(dv)
        g["devolvidas"] += int(dv["quantidade"])
        g["valor_devolvido"] += float(dv["valor"])
        a = por_ano[dv["data"].year]
        a["devolvidas"] += int(dv["quantidade"])
        a["valor_devolvido"] += float(dv["valor"])

    linhas = []
    for g in grupos.values():
        # O nome que mais aparece no grupo, não o da primeira nota — senão a
        # empresa aparece com o nome de uma filial ("JSL S/A. - Parauapebas").
        g["nome"] = min(g.pop("nomes").items(), key=lambda kv: (-kv[1], len(kv[0])))[0]
        g["liquidas"] = g["brutas"] - g["devolvidas"]
        g["valor_liquido"] = round(g["valor_bruto"] - g["valor_devolvido"], 2)
        linhas.append(g)
    linhas.sort(key=lambda g: (-g["liquidas"], -g["valor_liquido"], g["nome"]))

    return {
        "linhas": linhas,
        "por_ano": dict(sorted(por_ano.items())),
        "empresas": len(linhas),
        "brutas": sum(g["brutas"] for g in linhas),
        "devolvidas": sum(g["devolvidas"] for g in linhas),
        "liquidas": sum(g["liquidas"] for g in linhas),
        "valor_liquido": round(sum(g["valor_liquido"] for g in linhas), 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Banco
# ─────────────────────────────────────────────────────────────────────────────

_REGUA = """
WITH cfg AS (SELECT string_to_array(lower(replace(valor, ' ', '')), ',') AS cfops
               FROM tiny.configuracoes WHERE chave = 'CFOP_VALIDOS'),
     mk  AS (SELECT string_to_array(lower(valor), ',') AS ruins
               FROM tiny.configuracoes WHERE chave = 'MARCADORES_INVALIDOS'),
     conta AS (
  SELECT nf.id FROM tiny.notas_fiscais nf, cfg, mk
   WHERE lower(btrim(nf.descricao_situacao)) = 'emitida danfe'
     AND nf.valor_nota > 0
     AND lower(substring(nf.natureza_operacao FROM '\\d{4}')) = ANY(cfg.cfops)
     AND NOT EXISTS (SELECT 1 FROM tiny.marcadores m, unnest(mk.ruins) r(txt)
                      WHERE m.id_nota = nf.id
                        AND lower(m.descricao) LIKE '%%' || btrim(r.txt) || '%%'))
"""

_VENDAS = _REGUA + """
SELECT nf.numero, nf.data_emissao AS data, c.cpf_cnpj, c.nome,
       i.quantidade, i.valor_total AS valor
  FROM conta
  JOIN tiny.notas_fiscais nf ON nf.id = conta.id
  JOIN tiny.itens_nota i ON i.id_nota = nf.id
  LEFT JOIN tiny.clientes c ON c.id = nf.id_cliente
 WHERE upper(btrim(i.descricao)) = upper(btrim(%(produto)s))
   AND nf.data_emissao BETWEEN %(inicio)s AND %(fim)s
"""

# A origem pode ser de um ano anterior ao período pedido: a régua da origem é
# conferida sem filtro de data. O que decide o ano do abatimento é a data da
# DEVOLUÇÃO.
_DEVOLUCOES = _REGUA + """
SELECT nf.numero, nf.data_emissao AS data, c.cpf_cnpj, c.nome,
       i.quantidade, i.valor_total AS valor, nf.observacoes,
       ARRAY(SELECT lpad(o.numero, 6, '0') FROM conta
               JOIN tiny.notas_fiscais o ON o.id = conta.id) AS contadas
  FROM tiny.notas_fiscais nf
  JOIN tiny.itens_nota i ON i.id_nota = nf.id
  LEFT JOIN tiny.clientes c ON c.id = nf.id_cliente
 WHERE upper(btrim(i.descricao)) = upper(btrim(%(produto)s))
   AND lower(btrim(nf.descricao_situacao)) = 'emitida danfe'
   AND substring(nf.natureza_operacao FROM '\\d{4}') IN ('1202', '2202')
   AND nf.data_emissao BETWEEN %(inicio)s AND %(fim)s
"""


def _decidir(ref: str | None, contadas: set[str]) -> str:
    if ref is None:
        return "não cita a nota de origem — não abatida"
    if ref not in contadas:
        return f"origem {ref} já fora da régua — não abatida (contaria duas vezes)"
    return "abater"


def _fetch(cur, sql, params):
    cur.execute(sql, params)
    cols = [c.name for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def apurar(dsn: str, produto: str, inicio: date, fim: date,
           abater_devolucoes: bool = True, modo: str = "raiz_cnpj") -> dict:
    """Busca no DataCoreHS e consolida. Síncrono (psycopg): rodar em thread."""
    p = {"produto": produto, "inicio": inicio, "fim": fim}
    with psycopg.connect(dsn, connect_timeout=15) as conn, conn.cursor() as cur:
        vendas = _fetch(cur, _VENDAS, p)
        devolucoes = _fetch(cur, _DEVOLUCOES, p) if abater_devolucoes else []
    contadas = set(devolucoes[0]["contadas"]) if devolucoes else set()
    for d in devolucoes:
        d["referencia"] = referencia_da_devolucao(d.pop("observacoes"))
        d.pop("contadas", None)
        d["decisao"] = _decidir(d["referencia"], contadas)
    r = consolidar(vendas, devolucoes, modo)
    r["devolucoes"] = devolucoes
    return r


# ─────────────────────────────────────────────────────────────────────────────
# Planilha
# ─────────────────────────────────────────────────────────────────────────────

def _cabecalho(ws, linha, titulos):
    for i, t in enumerate(titulos, 1):
        c = ws.cell(row=linha, column=i, value=t)
        c.fill, c.font = HEADER_FILL, HEADER_FONT
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _larguras(ws, larguras):
    for i, w in enumerate(larguras, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def gerar(dsn: str, produto: str, inicio: date, fim: date,
          abater_devolucoes: bool = True, modo: str = "raiz_cnpj") -> tuple[bytes, str, dict]:
    """Apura e devolve (bytes do .xlsx, nome do arquivo, resumo)."""
    r = apurar(dsn, produto, inicio, fim, abater_devolucoes, modo)
    agrup = "raiz de CNPJ (filiais juntas)" if modo == "raiz_cnpj" else \
            "nome normalizado (aproximação: junta raízes diferentes do mesmo nome)"

    wb = Workbook()
    ws = wb.active
    ws.title = "Resumo"
    ws["A1"] = f"Compradores de {produto}"
    ws["A1"].font = TITULO_FONT
    info = [
        ("Período", f"{inicio:%d/%m/%Y} a {fim:%d/%m/%Y}"),
        ("Empresas", r["empresas"]),
        ("Unidades vendidas", r["brutas"]),
        ("Unidades devolvidas (abatidas)", r["devolvidas"]),
        ("Unidades líquidas", r["liquidas"]),
        ("Valor líquido (R$)", r["valor_liquido"]),
        ("Agrupamento", agrup),
        ("Régua", "NF-e Emitida DANFE, CFOP de venda (CFOP_VALIDOS), sem marcador "
                  "de cancelamento/recusa; item pelo nome exato; valor do item."),
        ("Devolução", "abatida só quando a venda de origem ainda conta na régua"
                      if abater_devolucoes else "não abatida (pedido assim)"),
        ("Fonte", f"DataCoreHS / ERP Tiny — gerado em {date.today():%d/%m/%Y}"),
    ]
    for i, (k, v) in enumerate(info, 3):
        ws.cell(row=i, column=1, value=k).font = Font(bold=True)
        ws.cell(row=i, column=2, value=v)
    _larguras(ws, [32, 90])

    ws = wb.create_sheet("Compradores")
    _cabecalho(ws, 1, ["#", "Empresa", "Documento(s)", "Nº de CNPJs/CPFs", "Notas",
                       "Un. vendidas", "Un. devolvidas", "Un. líquidas",
                       "Valor líquido (R$)", "Primeira compra", "Última compra"])
    for n, g in enumerate(r["linhas"], 1):
        docs = sorted(g["documentos"])
        ws.append([n, g["nome"], ", ".join(docs[:5]) + (" …" if len(docs) > 5 else ""),
                   len(docs), len(g["notas"]), g["brutas"], g["devolvidas"],
                   g["liquidas"], g["valor_liquido"], g["primeira"], g["ultima"]])
    ws.append([])
    ws.append(["", "TOTAL", "", "", "", r["brutas"], r["devolvidas"], r["liquidas"],
               r["valor_liquido"]])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True)
    _larguras(ws, [5, 48, 40, 10, 8, 10, 10, 10, 16, 13, 13])
    ws.freeze_panes = "A2"

    ws = wb.create_sheet("Por ano")
    _cabecalho(ws, 1, ["Ano", "Un. vendidas", "Un. devolvidas", "Un. líquidas",
                       "Valor líquido (R$)"])
    for ano, a in r["por_ano"].items():
        ws.append([ano, a["brutas"], a["devolvidas"], a["brutas"] - a["devolvidas"],
                   round(a["valor_bruto"] - a["valor_devolvido"], 2)])
    _larguras(ws, [8, 12, 12, 12, 18])

    ws = wb.create_sheet("Devoluções")
    _cabecalho(ws, 1, ["Nota", "Data", "Cliente", "Unidades", "Valor (R$)",
                       "Nota de origem", "Decisão"])
    for d in r["devolucoes"]:
        ws.append([d["numero"], d["data"], d["nome"], int(d["quantidade"]),
                   float(d["valor"]), d["referencia"] or "—", d["decisao"]])
    _larguras(ws, [10, 12, 44, 10, 14, 14, 60])

    buf = io.BytesIO()
    wb.save(buf)
    slug = re.sub(r"[^a-z0-9]+", "-", normalizar_nome(produto).lower()).strip("-")
    nome = f"compradores_{slug}_{inicio:%Y%m%d}-{fim:%Y%m%d}.xlsx"
    resumo = {k: r[k] for k in ("empresas", "brutas", "devolvidas", "liquidas",
                                "valor_liquido")}
    resumo["top"] = [(g["nome"], g["liquidas"], g["valor_liquido"])
                     for g in r["linhas"][:10]]
    resumo["abatidas"] = [d["numero"] for d in r["devolucoes"] if d["decisao"] == "abater"]
    return buf.getvalue(), nome, resumo
