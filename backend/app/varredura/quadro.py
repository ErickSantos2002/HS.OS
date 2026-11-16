"""Formatação (pura) do que a Nina lê: as varreduras do dia, de todos os Guardis.

⚠️ A Nina repassa isto ao CEO. Quem ficou sem varredura aparece NO TOPO e com o
motivo: se sumisse da lista, "zero pendências" seria lido como "tudo em dia".
O corte em 12.000 caracteres existe porque o retorno de ferramenta entra no
contexto do modelo; o aviso manda pedir por pessoa em vez de truncar calado.
"""
import re
import unicodedata

from app.varredura.regras import FUSO, SISTEMAS

TETO_RETORNO = 12_000
TETO_RESUMO_LISTA = 600
# Piso do resumo por pessoa quando a equipe é grande: abaixo disso não diz nada.
PISO_RESUMO_LISTA = 120
AVISO_CORTE = "(lista cortada: peça por pessoa)"

_MOTIVO = {
    "sem_registro": "o Guardi não registrou",
    "pulada": "pulada (a pessoa estava conversando com o Guardi, ou fora do horário)",
    "erro": "erro no disparo",
    "sem_varredura": "nenhuma varredura hoje",
    "agendada": "ainda em andamento",
    "rodando": "ainda em andamento",
}


def normalizar(t: str) -> str:
    sem = unicodedata.normalize("NFD", t or "")
    return "".join(c for c in sem if not unicodedata.combining(c)).casefold().strip()


def achar_pessoas(linhas: list[dict], consulta: str) -> list[dict]:
    """Casa por e-mail exato, ou por prefixo do nome completo / de qualquer palavra seguinte
    (ex.: 'lara' e 'cocri' casam 'Lara Cocri'; 'lara co' também)."""
    q = normalizar(consulta)
    if not q:
        return []
    achadas = []
    for l in linhas:
        if q == normalizar(l.get("email") or ""):
            return [l]
        palavras = normalizar(l.get("nome") or "").split()
        if any(" ".join(palavras[i:]).startswith(q) for i in range(len(palavras))):
            achadas.append(l)
    return achadas


def _entregue(l: dict) -> bool:
    return l["status"] in ("entregue", "nada_novo")


def _totais(linhas: list[dict]) -> list[str]:
    soma: dict[str, int] = {}
    for l in linhas:
        if not _entregue(l) or not isinstance(l.get("numeros"), dict):
            continue
        for sis, val in l["numeros"].items():
            if isinstance(val, dict):
                for k, v in val.items():
                    if isinstance(v, (int, float)) and not isinstance(v, bool):
                        soma[f"{sis}.{k}"] = soma.get(f"{sis}.{k}", 0) + v
    return [f"- {k}: {soma[k]}" for k in sorted(soma)]


def _numeros(n) -> str:
    if not isinstance(n, dict) or not n:
        return ""
    partes = []
    for sis, val in n.items():
        if sis == "falhas":
            partes.append("não conseguiu ler: " + ", ".join(val))
        elif isinstance(val, dict):
            partes.append(f"{sis}: " + ", ".join(f"{k}={v}" for k, v in val.items()))
    return "; ".join(partes)


AVISO_SEM_PAGINA = ("NUNCA publique isto em página (publicar_pagina gera link público): traz "
                    "cliente, remetente e assunto de e-mail de cada pessoa. Responda só no chat.")


def _nao_ligados(l: dict) -> str:
    """O que este Guardi não tem — escolha da empresa, não falha de leitura.

    ⚠️ No 1º quadro (16/11/2026) a Nina leu "CRM não ligado" como falha e fez
    disso o destaque nº 1. Só sabe o que não está ligado quem tem `sistemas`.
    """
    if "sistemas" not in l:
        return ""
    fora = sorted(SISTEMAS - set(l.get("sistemas") or []))
    return f"não ligados a este Guardi (não é falha): {', '.join(fora)}" if fora else ""


def formatar_equipe(linhas: list[dict], pessoa: str | None, teto: int = TETO_RETORNO) -> str:
    entregues = [l for l in linhas if _entregue(l)]
    sem = [l for l in linhas if not _entregue(l)]
    # ⚠️ A Nina gosta de montar painel (na 1ª conversa real, 16/11/2026, fez HTML
    # dentro da mensagem). `publicar_pagina` geraria link PÚBLICO com remetente e
    # assunto de e-mail — a proibição vai no próprio retorno, que ela lê sempre.
    out = [AVISO_SEM_PAGINA,
           f"{len(entregues)} de {len(linhas)} entregues (varreduras do dia)."]
    if not pessoa and len(linhas) > 1:
        # ⚠️ No 1º quadro (16/11/2026) 7 de 23 pessoas sumiram do texto ao CEO.
        out += ["", f"Pessoas ({len(linhas)}): " + ", ".join(l["nome"] for l in linhas) + ".",
                f"Escreva UMA linha para CADA uma dessas {len(linhas)} pessoas, mesmo que seja "
                "\"sem pendência\" — não omita ninguém. \"Não ligado\" não é falha: não o cite "
                "como problema."]
    tot = _totais(linhas)
    if tot:
        out += ["", "Totais (soma de quem entregou):"] + tot
    if sem:
        out += ["", "Sem varredura (NÃO invente número para essas pessoas; diga que ficaram sem):"]
        out += [f"- {l['nome']} — {_MOTIVO.get(l['status'], l['status'])}" for l in sem]
    cabeca = "\n".join(out)
    cortou = False
    corpo = []
    # ⚠️ O espaço é DIVIDIDO entre todos: com 600 fixos, 23 pessoas passavam dos
    # 12.000 e o fim da ordem alfabética era cortado (16/11/2026).
    fixas = []
    for l in entregues:
        hora = l["hora"].astimezone(FUSO).strftime("%H:%M") if hasattr(l.get("hora"), "astimezone") else (l.get("hora") or "")
        sec = [f"\n## {l['nome']} — {l.get('cargo') or 'sem cargo'}" + (f" ({hora})" if hora else "")]
        n = _numeros(l.get("numeros"))
        if n:
            sec.append(n)
        fora = _nao_ligados(l)
        if fora:
            sec.append(fora)
        fixas.append(sec)
    # O que sobra depois do cabeçalho e das partes fixas (nome, números, não
    # ligados) é dividido igualmente entre os resumos — medido, não estimado.
    limite = TETO_RESUMO_LISTA
    if not pessoa and entregues:
        fixo = sum(len("\n".join(s)) + 2 for s in fixas) + 2 * len(entregues)  # +"\n" e "…"
        sobra = teto - len(cabeca) - len(AVISO_CORTE) - 2 - fixo
        limite = max(PISO_RESUMO_LISTA, min(TETO_RESUMO_LISTA, sobra // len(entregues)))
    for l, sec in zip(entregues, fixas):
        resumo = l.get("resumo") or ""
        if not pessoa and len(resumo) > limite:
            resumo = resumo[:limite] + "…"
        if resumo:
            sec = sec + [resumo]
        corpo.append("\n".join(sec))
    texto = cabeca
    for sec in corpo:
        if len(texto) + len(sec) + 1 + len(AVISO_CORTE) + 1 > teto:
            cortou = True
            break
        texto += "\n" + sec
    if cortou or len(texto) > teto:
        texto = texto[:teto - len(AVISO_CORTE) - 1] + "\n" + AVISO_CORTE
    return texto
