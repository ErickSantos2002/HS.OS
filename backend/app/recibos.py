"""Visto por mensagem — as regras, sem banco (spec 2026-10-14).

Canal: uma linha em `recibos_mensagem` por mensagem × membro humano destinatário
(o autor e os agentes não entram). Agente: derivado de `conversations` e de
`agent_runs.pergunta_id` — não há tabela de recibo para ele.
"""
import re
from datetime import datetime, timedelta

# Mesma janela de `turno_em_curso`: run sem resposta passado disso é dado como
# perdido.
JANELA_DO_RUN = timedelta(minutes=30)

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def eh_uuid(valor: object) -> bool:
    return isinstance(valor, str) and bool(_UUID.match(valor))


def estado_no_canal(destinatarios: int, entregues: int, lidas: int) -> str:
    """O visto de uma mensagem de canal, a partir dos membros ATUAIS.

    Sem destinatário é "enviada": não há quem leia, e azul seria mentira.
    """
    if destinatarios <= 0:
        return "enviada"
    if lidas >= destinatarios:
        return "lida"
    if entregues >= destinatarios:
        return "entregue"
    return "enviada"


def estado_no_agente(tem_resposta_depois: bool, run_criado_em: datetime | None,
                     agora: datetime) -> str:
    """O visto de uma pergunta ao agente.

    ⚠️ Azul é "há resposta do agente depois", NÃO "o run tem `message_id`": o
    `/recuperar` grava resposta sem preencher o run.
    """
    if tem_resposta_depois:
        return "lida"
    if run_criado_em is None:
        return "enviada"
    if agora - run_criado_em > JANELA_DO_RUN:
        return "falhou"
    return "entregue"
