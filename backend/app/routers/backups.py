"""Registro de backup vindo de fora (26/11/2026).

O backup da VPS do gateway não alcança o Postgres (ele não aceita TLS e fica
no loopback da outra VPS), então avisa por aqui. O do banco grava direto, pelo
próprio container. Quem lê é `app/guardiao_backups.py`.

Segredo próprio (`BACKUP_REGISTRO_TOKEN` em `integration_secrets`), e não o de
outra integração: quem tem este token só consegue dizer "o backup rodou".
"""
from typing import Literal

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from app.database import sessao
from app.integracoes import exige_segredo

router = APIRouter(prefix="/backups", tags=["backups"])


class RegistroIn(BaseModel):
    # Só as origens que o guardião confere: um nome livre gravaria linha que
    # ninguém lê, e a `CHECK` da tabela recusaria com 500.
    origem: Literal["banco-hsos", "gateway"]
    ok: bool
    tamanho: int | None = None
    detalhe: str | None = None

    def detalhe_curto(self) -> str | None:
        # Vem de fora e vira texto de alerta: limitado aqui.
        return self.detalhe[:500] if self.detalhe else None


@router.post("/registro", status_code=status.HTTP_201_CREATED)
async def registrar(dados: RegistroIn,
                    _: None = Depends(exige_segredo("BACKUP_REGISTRO_TOKEN"))) -> dict:
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "INSERT INTO public.backups_execucao (origem, ok, tamanho, detalhe) "
            "VALUES ($1, $2, $3, $4)",
            dados.origem, dados.ok, dados.tamanho, dados.detalhe_curto())
    return {"registrado": True}
