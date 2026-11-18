"""Marcar conversa como não lida pela lista — regra pura (migração 039).

Spec: docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md.

A marca é da pessoa sobre a conversa inteira — canal (DM, grupo, canal, a
conversa pessoal) OU agente, exatamente um. Não é notificação: não soma em
contador nenhum, e só some quando a pessoa abre a conversa.
"""
from uuid import UUID

from app.dependencies import normalizar_agent_id


def alvo_da_marca(canal_id: str | None, agent_id: str | None) -> tuple[str, str]:
    """`("canal", uuid)` ou `("agente", id normalizado)`.

    `ValueError` com nenhum alvo, com os dois, ou com `canal_id` que não é uuid
    — a rota o converte em 400 antes de tocar o banco.
    """
    canal = (canal_id or "").strip()
    agente = normalizar_agent_id(agent_id) if agent_id and agent_id.strip() else ""
    if bool(canal) == bool(agente):
        raise ValueError("Informe exatamente um: canal_id ou agent_id.")
    if canal:
        try:
            UUID(canal)
        except ValueError:
            raise ValueError("canal_id inválido.") from None
        return ("canal", canal)
    return ("agente", agente)
