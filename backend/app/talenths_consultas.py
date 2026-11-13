"""O que o Guardi pode consultar no TalentHS — e só isso (13/11/2026).

Spec `docs/superpowers/specs/2026-11-13-guardi-talenths-design.md`. O Guardi lê
o TalentHS (RH: férias, ponto, metas, PDI, avaliações, cursos, benefícios,
salário) COMO o dono: quem decide o que ele vê é o TalentHS, pelo papel dele lá
(`user` vê o que é seu e o que a empresa toda vê; `manager` é o RH e vê a
empresa inteira). Aqui mora a outra metade, a mesma do DataCore e do DocsHS:
**o agente escolhe uma consulta desta lista, nunca um caminho.**

Fora de propósito: arquivo (download de documento, anexo de meta, vídeo),
prova/teste de outra pessoa, convites, `/auth/*` além do `/auth/me`. O
allowlist do TalentHS fecha o mesmo, do lado de lá.

⚠️ "Do time" no TalentHS é **a empresa inteira**, e só o RH vê: toda rota
`/team` filtra só por empresa — não existe recorte de "gestor e os seus".

Os filtros foram tirados do `/openapi.json` público do TalentHS em 13/11/2026 e
ficam DECLARADOS aqui: filtro novo numa rota de lá só chega ao Guardi entrando
neste arquivo. Puro, testado em `tests/test_guardi_talenths.py`.
"""
from __future__ import annotations

import re

from app.datacore_consultas import _ID, _escalar, texto_do_retorno

__all__ = ["CONSULTAS", "caminho_da_consulta", "params_da_consulta", "paginacao_local",
           "texto_do_retorno"]

# Paginação DO NOSSO LADO: nenhuma rota do TalentHS pagina, todas devolvem a
# lista inteira. Esses nomes nunca vão para lá.
_LOCAL = ("offset", "limite")
_INATIVOS = ("include_inactive",) + _LOCAL
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATAS = ("date", "start_date", "end_date")

# chave → (caminho, o que é e quem vê, filtros aceitos, filtros obrigatórios).
# `{id}` pede `id`. "RH" = papel manager ou master_admin no TalentHS.
CONSULTAS: dict[str, tuple[str, str, tuple[str, ...], tuple[str, ...]]] = {
    "eu": ("/auth/me", "quem o seu dono é no TalentHS: perfil e papel (user = colaborador, "
           "manager = RH)", (), ()),
    "meu_perfil": ("/profiles/me", "o perfil do seu dono (cargo, departamento, admissão)", (), ()),
    "pessoas": ("/profiles", "as pessoas da empresa (nome, cargo, departamento)",
                ("company_id",) + _LOCAL, ()),
    "pessoa": ("/profiles/{id}", "uma pessoa pelo user_id", (), ()),
    "colaboradores": ("/collaborators", "colaboradores com papel e desligamento — só o RH. "
                      "`status`: active, inactive ou all", ("status", "company_id") + _LOCAL, ()),
    "departamentos": ("/departments", "os departamentos (ids)", ("company_id",) + _LOCAL, ()),
    "empresa": ("/companies/presentation", "a apresentação da empresa", (), ()),
    "regras_internas": ("/companies/internal-rules", "as regras internas da empresa", (), ()),
    "cultura": ("/culture", "missão, visão, valores", (), ()),
    "aniversarios": ("/communications/birthdays", "aniversariantes", _LOCAL, ()),
    "tempo_de_casa": ("/communications/milestones", "quem completa tempo de casa", _LOCAL, ()),
    "comunicados": ("/communications/announcements", "os comunicados publicados", _LOCAL, ()),
    "notificacoes": ("/notifications", "as notificações do seu dono no TalentHS", _LOCAL, ()),
    "tipos_de_ausencia": ("/absences/types", "os tipos de ausência (férias, folga…)", (), ()),
    "minhas_ausencias": ("/absences/my", "os pedidos de férias e ausência do seu dono, com a "
                         "situação de cada um", _LOCAL, ()),
    "ausencias_do_time": ("/absences/team", "todos os pedidos de ausência da empresa — só o RH",
                          _LOCAL, ()),
    "calendario_de_ausencias": ("/absences/calendar", "quem está ausente (ausências aprovadas "
                                "da empresa)", _LOCAL, ()),
    # Leituras da escrita (spec 2026-11-13-guardi-talenths-escrita): o id do
    # evento para `editar_evento` e o do modelo para `atribuir_onboarding`.
    "eventos": ("/calendar/events", "os eventos do calendário da empresa, com o id de cada um",
                _LOCAL, ()),
    "modelos_de_onboarding": ("/onboarding/templates", "os modelos de checklist de integração, com as "
                              "tarefas — só o RH", _LOCAL, ()),
    "calendario": ("/calendar/feed", "o calendário da empresa (eventos; o RH vê também as "
                   "ausências)", _LOCAL, ()),
    "meu_ponto_hoje": ("/timeclock/my/today", "as batidas de hoje do seu dono e o resumo do dia",
                       (), ()),
    "meu_ponto": ("/timeclock/my", "as batidas do seu dono num período (AAAA-MM-DD)",
                  ("start_date", "end_date") + _LOCAL, ()),
    "ponto_do_time": ("/timeclock/team", "as batidas da empresa — só o RH. `date` ou "
                      "`start_date`/`end_date` (AAAA-MM-DD), `user_id` para uma pessoa",
                      ("date", "user_id", "start_date", "end_date") + _INATIVOS, ()),
    "ajustes_de_ponto": ("/timeclock/requests", "pedidos de ajuste de ponto pendentes — só o RH",
                         _LOCAL, ()),
    "ciclos_de_metas": ("/goals/cycles", "os ciclos de metas (o id para `metas`)", (), ()),
    "metas": ("/goals/overview", "as metas do ciclo com o progresso; `month` de 1 a 12",
              ("cycle_id", "month") + _LOCAL, ("cycle_id",)),
    "meta": ("/goals/{id}", "uma meta: plano e realizado mês a mês", (), ()),
    "comentarios_da_meta": ("/goals/{id}/comments", "os comentários de uma meta", _LOCAL, ()),
    "meu_pdi": ("/pdi/my", "o PDI do seu dono, com as ações", (), ()),
    "pdi_do_time": ("/pdi/team", "os PDIs da empresa — só o RH", _INATIVOS, ()),
    "ciclos_de_avaliacao": ("/evaluations/cycles", "os ciclos de avaliação (o id para as outras)",
                            (), ()),
    "comportamentos": ("/evaluations/behaviors", "os comportamentos avaliados", (), ()),
    "minha_avaliacao": ("/evaluations/my", "a avaliação do seu dono num ciclo",
                        ("cycle_id",), ("cycle_id",)),
    "notas_da_avaliacao": ("/evaluations/scores", "as notas de uma pessoa num ciclo — só o RH",
                           ("cycle_id", "evaluated_user_id"), ("cycle_id", "evaluated_user_id")),
    "status_das_avaliacoes": ("/evaluations/team-status", "quem já avaliou e foi avaliado no "
                              "ciclo — só o RH", ("cycle_id",) + _INATIVOS, ("cycle_id",)),
    "nove_box": ("/evaluations/9box", "a matriz 9-box do ciclo — só o RH",
                 ("cycle_id",) + _INATIVOS, ("cycle_id",)),
    "meus_feedbacks": ("/feedbacks/my", "os pedidos de feedback para o seu dono e se ele já "
                       "respondeu", _LOCAL, ()),
    "feedbacks": ("/feedbacks", "os pedidos de feedback da empresa — só o RH", _LOCAL, ()),
    "respostas_do_feedback": ("/feedbacks/{id}/responses", "as respostas de um pedido de "
                              "feedback — só o RH", _LOCAL, ()),
    "cursos": ("/learning/catalog", "o catálogo da Universidade", _LOCAL, ()),
    "meus_cursos": ("/learning/my", "os cursos do seu dono e o progresso", _LOCAL, ()),
    "minhas_trilhas": ("/learning/my-tracks", "as trilhas do seu dono em andamento", _LOCAL, ()),
    "cursos_do_time": ("/learning/team", "os cursos da empresa por pessoa — só o RH",
                       _INATIVOS, ()),
    "trilhas_do_time": ("/learning/team-tracks", "as trilhas da empresa por pessoa — só o RH",
                        _INATIVOS, ()),
    "workshops": ("/workshops", "os workshops, com a inscrição do seu dono", _LOCAL, ()),
    "meus_videos": ("/videos/mine", "os vídeos do seu dono", _LOCAL, ()),
    "meu_onboarding": ("/onboarding/my", "o checklist de integração do seu dono", (), ()),
    "onboarding_do_time": ("/onboarding/team", "a integração de cada pessoa — só o RH",
                           _INATIVOS, ()),
    "beneficios": ("/benefits/catalog", "os benefícios oferecidos", _LOCAL, ()),
    "meus_beneficios": ("/benefits/my", "os benefícios ativos do seu dono", _LOCAL, ()),
    "beneficios_do_time": ("/benefits/team", "os benefícios por pessoa — só o RH", _LOCAL, ()),
    "beneficios_de_uma_pessoa": ("/benefits/employee/{id}", "os benefícios de uma pessoa "
                                 "(id = user_id) — só o RH", _LOCAL, ()),
    "resumo_de_beneficios": ("/benefits/summary", "o resumo dos benefícios — só o RH", (), ()),
    "trilhas_de_carreira": ("/career/tracks", "as trilhas de carreira", _LOCAL, ()),
    "minha_carreira": ("/career/my", "a carreira do seu dono", (), ()),
    "carreira_do_time": ("/career/team", "a carreira de cada pessoa — só o RH", _INATIVOS, ()),
    "referencias_salariais": ("/salary/references", "as referências salariais (o id para as "
                              "outras) — só o RH", _LOCAL, ()),
    "tabela_salarial": ("/salary/table", "a tabela salarial de uma referência — só o RH",
                        ("reference_id",) + _LOCAL, ("reference_id",)),
    "posicionamento_salarial": ("/salary/positioning", "onde cada pessoa está na tabela — só o "
                                "RH", ("reference_id",) + _LOCAL, ("reference_id",)),
    "pesquisas": ("/surveys", "as pesquisas (o RH vê também as encerradas)", _LOCAL, ()),
    "resultado_da_pesquisa": ("/surveys/{id}/results", "o resultado de uma pesquisa — só o RH",
                              (), ()),
    "meus_documentos": ("/documents/my", "os documentos do RH para o seu dono (só a lista; o "
                        "arquivo se abre no TalentHS)", _LOCAL, ()),
    "testes_disponiveis": ("/tests/available", "os testes que o seu dono pode fazer", _LOCAL, ()),
    "minhas_tentativas": ("/tests/my-attempts", "as tentativas de teste do seu dono e a nota",
                          _LOCAL, ()),
    "relatorio_colaboradores": ("/reports/collaborators", "relatório de colaboradores — só o RH",
                                _INATIVOS, ()),
    "relatorio_ausencias": ("/reports/absences", "relatório de ausências — só o RH", _LOCAL, ()),
    "relatorio_beneficios": ("/reports/benefits", "relatório de benefícios — só o RH", _LOCAL, ()),
    "relatorio_pdi": ("/reports/pdi", "relatório de PDI — só o RH", _LOCAL, ()),
    "relatorio_cursos": ("/reports/learning", "relatório da Universidade — só o RH", _LOCAL, ()),
}

# O que a pessoa diria ao Guardi para chegar a esta consulta — só para a tela
# "Capacidade" (`app/capacidade.py`). Opcional: sem exemplo, a tela mostra só o
# rótulo. O agente não lê isto: ele lê a descrição acima.
EXEMPLOS: dict[str, str] = {
    "minhas_ausencias": "quais ausências eu pedi?",
    "calendario_de_ausencias": "quem está de férias esta semana?",
    "ausencias_do_time": "quais pedidos de ausência estão pendentes?",
    "meu_ponto_hoje": "como está o meu ponto hoje?",
    "meu_pdi": "como está o meu PDI?",
    "meus_cursos": "quais cursos eu estou fazendo?",
    "meus_beneficios": "quais benefícios eu tenho?",
    "aniversarios": "quem faz aniversário este mês?",
    "comunicados": "quais são os comunicados recentes?",
}


def caminho_da_consulta(chave: str, ident: str | None) -> str:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja talenths_consultas.")
    caminho = CONSULTAS[chave][0]
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


def _valor(k: str, v):
    if k in _DATAS:
        if not isinstance(v, str) or not _DATA.match(v):
            raise ValueError(f"`{k}` é uma data AAAA-MM-DD.")
        return v
    if k == "month":
        return _inteiro(k, v, 1, 12)
    if k in ("offset",):
        return _inteiro(k, v, 0)
    if k == "limite":
        return _inteiro(k, v, 1)
    if k == "include_inactive":
        if not isinstance(v, bool) and str(v).lower() not in ("true", "false"):
            raise ValueError("`include_inactive` é true ou false.")
        return v if isinstance(v, bool) else str(v).lower() == "true"
    if k == "status" and v not in ("active", "inactive", "all"):
        raise ValueError("`status` é active, inactive ou all.")
    if k in ("cycle_id", "reference_id", "user_id", "evaluated_user_id", "company_id") \
            and not _ID.match(str(v)):
        raise ValueError(f"`{k}` inválido.")
    return v


def params_da_consulta(chave: str, parametros: dict | None) -> list[tuple[str, str]]:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja talenths_consultas.")
    if parametros is not None and not isinstance(parametros, dict):
        raise ValueError("Filtros: um objeto nome → valor.")
    parametros = parametros or {}
    _, _, aceitos, obrigatorios = CONSULTAS[chave]
    faltam = [k for k in obrigatorios if parametros.get(k) in (None, "")]
    if faltam:
        raise ValueError(f"A consulta {chave} precisa de {', '.join(faltam)}.")
    saida: list[tuple[str, str]] = []
    for k, v in parametros.items():
        if k not in aceitos:
            validos = ", ".join(aceitos) if aceitos else "nenhum"
            raise ValueError(f"A consulta {chave} não aceita o filtro {k!r}. Válidos: {validos}.")
        if isinstance(v, (list, dict)):
            raise ValueError(f"O filtro {k} aceita um valor só.")
        saida.append((k, _escalar(_valor(k, v))))
    return saida


def paginacao_local(params: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], int, int | None]:
    """Separa `offset`/`limite` (já validados) do que vai ao TalentHS."""
    resto, offset, limite = [], 0, None
    for k, v in params:
        if k == "offset":
            offset = int(v)
        elif k == "limite":
            limite = int(v)
        else:
            resto.append((k, v))
    return resto, offset, limite
