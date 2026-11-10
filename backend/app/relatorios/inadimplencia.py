"""Inadimplência para a `iris` — spec 2026-11-10-iris-inadimplencia.

⚠️ **Nada aqui calcula inadimplência.** Os números vêm prontos da API do
DataCore (`/inadimplencia/resumo`, `/indicadores`, `/empresas`), que é onde a
régua mora (`DataCore/backend/app/core/inadimplencia.py`: 30 dias de carência,
faixas, status de cobrança). Este módulo só formata, pagina e monta a planilha.
Uma segunda régua aqui foi exatamente o que fez o faturamento divergir por anos.
"""
from __future__ import annotations

import io
from typing import Awaitable, Callable

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

PAGINA = 1000          # o máximo que o DataCore aceita (`LIMITE_MAXIMO`)
TETO_DE_PAGINAS = 20   # 20 mil empresas: muito acima da base; só evita laço sem fim

_FAIXAS = {"atraso": "1 a 30 dias (atraso)", "31_60": "31 a 60 dias", "61_90": "61 a 90 dias",
           "90_mais": "mais de 90 dias"}

RODAPE = "Números do DataCoreHS (tela Inadimplência), posição de hoje — não recalcule."


def brl(v) -> str:
    return f"R$ {float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(fracao) -> str:
    if fracao is None:
        return "—"
    return f"{float(fracao) * 100:.1f}%".replace(".", ",")


def texto_do_resumo(r: dict, ind: dict | None) -> str:
    linhas = [
        f"**Inadimplente (mais de 30 dias): {brl(r['inadimplente'])}** — "
        f"{pct(r['inadimplencia_carteira'])} da carteira a receber "
        f"({brl(r['total_a_receber'])}), {r['empresas_inadimplentes']} empresas, "
        f"{r['titulos_inadimplentes']} títulos.",
        f"Em atraso (1 a 30 dias, ainda não é inadimplência): {brl(r['em_atraso'])}.",
        f"Vencido no total: {brl(r['total_vencido'])} em {r['titulos_vencidos']} títulos.",
        "",
        "Por faixa:",
    ]
    for f in r.get("faixas") or []:
        linhas.append(f"- {_FAIXAS.get(f['faixa'], f['faixa'])}: {brl(f['valor'])} "
                      f"({f['empresas']} empresas, {f['titulos']} títulos)")
    linhas += ["", f"Cobrança: {r['sem_contato']} empresas sem contato, {r['em_negociacao']} em "
                   f"negociação, {r['promessas_7_dias']} promessas nos próximos 7 dias, "
                   f"{r['promessas_quebradas']} promessas quebradas."]
    if r.get("recuperado") is not None:
        linhas.append(f"Recuperado: {brl(r['recuperado'])}.")
    if ind:
        uf = ind.get("ultimo_fechado")
        if uf:
            linhas.append(f"Taxa de inadimplência do último mês fechado ({uf['mes']}): {pct(uf['taxa'])}; "
                          f"média de 12 meses: {pct(ind.get('media_12_meses'))}.")
    linhas += ["", RODAPE]
    return "\n".join(linhas)


async def todas_as_empresas(buscar: Callable[[int], Awaitable[dict]]) -> list[dict]:
    """Todas as páginas de `/empresas`. `buscar(offset)` devolve a página."""
    itens: list[dict] = []
    for i in range(TETO_DE_PAGINAS):
        p = await buscar(i * PAGINA)
        lote = p.get("itens") or []
        itens += lote
        if not lote or len(itens) >= int(p.get("total") or 0):
            break
    return itens


_COLUNAS = [("Cliente", "nome", 40), ("CNPJ/CPF", "documento", 20), ("Filiais", "filiais", 8),
            ("Títulos", "titulos", 8), ("Valor devido", "valor_devido", 16),
            ("Inadimplente (>30 dias)", "valor_inadimplente", 20), ("Maior atraso (dias)", "maior_atraso", 12),
            ("Status da cobrança", "status", 18), ("Próxima data", "proxima_data", 14),
            ("Último contato", "ultimo_contato", 20)]


_NUMERICAS = {"filiais", "titulos", "valor_devido", "valor_inadimplente", "maior_atraso"}


def _texto_seguro(v) -> str | None:
    """Texto que começa com = + - @ (ou tab/CR) vira fórmula no Excel: o nome do
    cliente vem do cadastro do Tiny, digitado por gente. Apóstrofo na frente."""
    if v is None:
        return None
    t = str(v)
    return "'" + t if t[:1] in ("=", "+", "-", "@", "\t", "\r") else t


def planilha(empresas: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Inadimplência"
    for c, (titulo, _, larg) in enumerate(_COLUNAS, 1):
        cel = ws.cell(1, c, titulo)
        cel.font = Font(bold=True, color="FFFFFF")
        cel.fill = PatternFill("solid", fgColor="3D61FF")
        ws.column_dimensions[get_column_letter(c)].width = larg
    for lin, e in enumerate(empresas, 2):
        for c, (_, campo, _) in enumerate(_COLUNAS, 1):
            v = e.get(campo)
            cel = ws.cell(lin, c, v if campo in _NUMERICAS else _texto_seguro(v))
            if campo in ("valor_devido", "valor_inadimplente"):
                cel.number_format = 'R$ #,##0.00'
    ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def texto_da_lista(empresas: list[dict], nome_do_arquivo: str) -> str:
    total_dev = sum(float(e.get("valor_devido") or 0) for e in empresas)
    total_inad = sum(float(e.get("valor_inadimplente") or 0) for e in empresas)
    top = sorted(empresas, key=lambda e: float(e.get("valor_devido") or 0), reverse=True)[:10]
    linhas = "\n".join(f"{i}. {e.get('nome')} — {brl(e.get('valor_devido'))} devido, "
                       f"{brl(e.get('valor_inadimplente'))} inadimplente, maior atraso "
                       f"{e.get('maior_atraso')} dias" for i, e in enumerate(top, 1))
    return (f"Planilha **{nome_do_arquivo}** guardada em **Documentos** (não é link público).\n\n"
            f"**{len(empresas)} empresas · {brl(total_dev)} devido · {brl(total_inad)} inadimplente.**"
            f"\n\nAs 10 maiores:\n{linhas}\n\nA lista completa está na planilha. Não reescreva a "
            f"lista na resposta.\n\n{RODAPE}")


def pagina_html(empresas: list[dict]) -> str:
    """A lista como página, montada aqui — o modelo nunca escreve o HTML dela."""
    from html import escape
    linhas = "".join(
        f"<tr><td>{escape(str(e.get('nome') or ''))}</td><td>{escape(str(e.get('documento') or ''))}</td>"
        f"<td class=n>{brl(e.get('valor_devido'))}</td><td class=n>{brl(e.get('valor_inadimplente'))}</td>"
        f"<td class=n>{e.get('maior_atraso') or ''}</td><td>{escape(str(e.get('status') or ''))}</td></tr>"
        for e in empresas)
    return ("<!doctype html><html lang=pt-BR><meta charset=utf-8><title>Inadimplência</title>"
            "<style>body{font-family:sans-serif;background:#0a0a0a;color:#eee;padding:16px}"
            "table{border-collapse:collapse;width:100%}td,th{padding:6px 8px;border-bottom:1px solid #333}"
            "th{text-align:left;background:#3D61FF}.n{text-align:right}</style>"
            "<h1>Inadimplência — DataCoreHS</h1><table><tr><th>Cliente</th><th>CNPJ/CPF</th>"
            "<th>Devido</th><th>Inadimplente</th><th>Maior atraso</th><th>Status</th></tr>"
            f"{linhas}</table><p>{escape(RODAPE)}</p></html>")
