"""O status do perfil do HS.OS traduzido para o status do WorkAdventure.

O script do mapa aplica o resultado com `WA.player.setStatus(...)`, que aceita
`ONLINE`, `BUSY`, `DO_NOT_DISTURB` e `BACK_IN_A_MOMENT`. A tradução é pelo
`label` dos presets de `frontend/src/lib/user-status.ts`, copiados aqui
**literalmente**: se um label mudar lá, tem que mudar aqui, senão o status cai
em `ONLINE` em silêncio.
"""

_POR_LABEL = {
    "Em reunião": "BUSY",
    "Foco / DND": "DO_NOT_DISTURB",
    "Almoço": "BACK_IN_A_MOMENT",
    "Ausente": "BACK_IN_A_MOMENT",
}


def status_wa(label: str | None) -> str:
    """Status do WA para o `custom_status` do perfil; qualquer outro, ou nenhum, é `ONLINE`."""
    return _POR_LABEL.get((label or "").strip(), "ONLINE")
