"""CRUD dos lembretes, usado pela tela e pelas ferramentas do Guardi.

⚠️ A tabela é escrita só pelo `service_role`, sem RLS: TODA consulta daqui
filtra por `user_id` explicitamente. Esquecer o filtro numa só dá a uma pessoa
o lembrete de outra.

`RegraInvalida` é recusa com mensagem pronta para a tela ou o agente; erro de
programação (campo desconhecido, `criado_por` fora do contrato) é `ValueError`.
"""
import json
from datetime import datetime

from app.agenda.regras import FUSO, TETO_ATIVOS, RegraInvalida, proximo, validar_regra

_COLUNAS = (
    "id::text AS id, user_id::text AS user_id, agent_id, titulo, instrucao, regra, proximo_em, "
    "ativo, criado_por, ultimo_disparo_em, ultimo_status, criado_em, atualizado_em"
)
_CAMPOS_EDITAVEIS = {"titulo", "regra", "instrucao", "ativo"}
_NAO_ACHOU = "Lembrete não encontrado."


def _titulo(valor) -> str:
    t = (valor or "").strip() if isinstance(valor, str) else ""
    if not 1 <= len(t) <= 200:
        raise RegraInvalida("O título deve ter de 1 a 200 caracteres.")
    return t


def _instrucao(valor) -> str | None:
    if valor is None:
        return None
    if not isinstance(valor, str):
        raise RegraInvalida("A instrução deve ser um texto.")
    i = valor.strip()
    if len(i) > 2000:
        raise RegraInvalida("A instrução deve ter no máximo 2000 caracteres.")
    return i or None


def _linha(row) -> dict:
    r = dict(row)
    if isinstance(r.get("regra"), str):
        r["regra"] = json.loads(r["regra"])
    p = r.get("proximo_em")
    if isinstance(p, datetime):
        r["proximo_em"] = p.astimezone(FUSO).isoformat()
    return r


async def _confere_teto(conn, user_id: str, exceto: str | None = None) -> None:
    """Teto de lembretes que ainda vão disparar.

    Único que já disparou segue `ativo` com `proximo_em` nulo; contá-lo faria quem
    usa lembretes de uma vez bater nos 30 depois de 30 disparos e o Guardi voltar
    a dizer que não tem onde guardar — o defeito que originou a feature.
    """
    sql = ("SELECT count(*) FROM public.lembretes "
           "WHERE user_id = $1::uuid AND ativo AND proximo_em IS NOT NULL")
    args: list = [user_id]
    if exceto is not None:
        sql += " AND id <> $2::uuid"
        args.append(exceto)
    n = await conn.fetchval(sql, *args)
    if (n or 0) >= TETO_ATIVOS:
        raise RegraInvalida(
            f"Você já tem {TETO_ATIVOS} lembretes ativos, que é o limite. Apague ou pause algum antes."
        )


async def guardi_de(conn, user_id: str) -> str | None:
    """O `agent_id` do bot pessoal da pessoa (`dono_id` é a definição de bot pessoal)."""
    return await conn.fetchval(
        "SELECT agent_id FROM public.agent_profiles WHERE dono_id = $1::uuid LIMIT 1", user_id
    )


async def criar(conn, user_id: str, agent_id: str, titulo: str, regra: dict,
                instrucao: str | None, criado_por: str, agora: datetime) -> dict:
    if criado_por not in ("pessoa", "guardi"):
        raise ValueError(f"criado_por inválido: {criado_por!r}")
    titulo = _titulo(titulo)
    instrucao = _instrucao(instrucao)
    regra = validar_regra(regra, agora)
    await _confere_teto(conn, user_id)
    quando = proximo(regra, agora)
    row = await conn.fetchrow(
        "INSERT INTO public.lembretes (user_id, agent_id, titulo, instrucao, regra, criado_por, proximo_em) "
        "VALUES ($1::uuid, $2, $3, $4, $5::text::jsonb, $6, $7) "
        f"RETURNING {_COLUNAS}",
        user_id, agent_id, titulo, instrucao, json.dumps(regra), criado_por, quando,
    )
    return _linha(row)


async def listar(conn, user_id: str, de: datetime | None = None,
                 ate: datetime | None = None) -> list[dict]:
    """Ativos e pausados. Com `de`/`ate`: os únicos no intervalo e todos os recorrentes."""
    sql = f"SELECT {_COLUNAS} FROM public.lembretes WHERE user_id = $1::uuid"
    args: list = [user_id]
    if de is not None and ate is not None:
        sql += " AND (regra->>'tipo' <> 'unico' OR proximo_em BETWEEN $2 AND $3)"
        args += [de, ate]
    sql += " ORDER BY proximo_em NULLS LAST, criado_em"
    return [_linha(r) for r in await conn.fetch(sql, *args)]


async def editar(conn, user_id: str, id: str, agora: datetime, **campos) -> dict:
    extras = set(campos) - _CAMPOS_EDITAVEIS
    if extras:
        raise ValueError(f"campo(s) não editável(is): {', '.join(sorted(extras))}")
    atual = await conn.fetchrow(
        f"SELECT {_COLUNAS} FROM public.lembretes WHERE id = $1::uuid AND user_id = $2::uuid",
        id, user_id,
    )
    if not atual:
        raise RegraInvalida(_NAO_ACHOU)
    atual = _linha(atual)

    sets: dict = {}
    if "titulo" in campos:
        sets["titulo"] = _titulo(campos["titulo"])
    if "instrucao" in campos:
        sets["instrucao"] = _instrucao(campos["instrucao"])
    regra = atual["regra"]
    if "regra" in campos:
        regra = validar_regra(campos["regra"], agora)
        sets["regra"] = regra
    reativando = campos.get("ativo") is True and not atual["ativo"]
    if "ativo" in campos:
        if type(campos["ativo"]) is not bool:
            raise ValueError("ativo deve ser bool")
        sets["ativo"] = campos["ativo"]
    if "regra" in campos or reativando:
        quando = proximo(regra, agora)
        ativo_final = sets.get("ativo", atual["ativo"])
        if quando is None and ativo_final:
            raise RegraInvalida("Esse lembrete não tem próxima data: o horário já passou.")
        sets["proximo_em"] = quando
        # passou de "não contava" para "conta" (reativado, ou único encerrado que ganhou data)
        if ativo_final and quando is not None and (not atual["ativo"] or atual["proximo_em"] is None):
            await _confere_teto(conn, user_id, exceto=id)

    if not sets:
        return atual
    colunas, valores = [], []
    for nome, v in sets.items():
        valores.append(json.dumps(v) if nome == "regra" else v)
        cast = "::text::jsonb" if nome == "regra" else ""
        colunas.append(f"{nome} = ${len(valores) + 2}{cast}")
    mudou_ativo = "ativo" in campos and campos["ativo"] != atual["ativo"]
    if "regra" in campos or mudou_ativo:
        # ⚠️ Lembrete adiado mantém `turno_pendente_desde`: sem zerar, o novo
        # horário sairia sem recado (o disparador acharia que já saiu). Zerar
        # `disparando_em` tira a posse de uma reserva em curso — a conclusão
        # dela exige o carimbo e não grava por cima desta edição. `ativo` igual
        # ao atual é no-op: zerar ali reabriria um disparo em curso.
        colunas += ["turno_pendente_desde = NULL", "disparando_em = NULL"]
    row = await conn.fetchrow(
        f"UPDATE public.lembretes SET {', '.join(colunas)}, atualizado_em = now() "
        f"WHERE id = $1::uuid AND user_id = $2::uuid RETURNING {_COLUNAS}",
        id, user_id, *valores,
    )
    if not row:
        raise RegraInvalida(_NAO_ACHOU)
    return _linha(row)


async def apagar(conn, user_id: str, id: str) -> bool:
    r = await conn.fetchval(
        "DELETE FROM public.lembretes WHERE id = $1::uuid AND user_id = $2::uuid RETURNING 1",
        id, user_id,
    )
    return bool(r)
