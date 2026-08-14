"""Perfis de usuário — substitui as consultas diretas a `public.profiles`.

O RLS continua valendo: a leitura roda como `authenticated`, então as policies
herdadas decidem o que cada um enxerga. A escrita é limitada ao próprio perfil.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from app.auth.schemas import LIMITE_SENHA_BYTES
from app.auth.security import gerar_hash
from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.routers.schemas import PerfilOut, PerfilPatch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/profiles", tags=["profiles"])

_COLUNAS = """
    p.id::text AS id, p.email, p.full_name, p.avatar_url, p.status,
    to_char(p.last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS last_seen_at,
    p.custom_status, p.custom_status_emoji, p.departamento, p.cargo,
    to_char(p.custom_status_set_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS custom_status_set_at
"""

# Um usuário pode ter mais de uma linha em `user_roles`; vale o papel mais forte.
# O front fazia exatamente isto com um mapa e uma tabela de prioridade —
# `{ administrador: 1, member: 2, user: 3 }`, menor ganha. Aqui é ORDER BY + LIMIT 1.
_PAPEL = """
    COALESCE((
        SELECT r.role::text FROM public.user_roles r
         WHERE r.user_id = p.id
         ORDER BY CASE r.role::text
                    WHEN 'administrador' THEN 1
                    WHEN 'colaborador' THEN 2
                    ELSE 3
                  END
         LIMIT 1
    ), 'sem_papel') AS role
"""


@router.get("", response_model=list[PerfilOut])
async def listar(usuario: Usuario = Depends(usuario_atual)):
    """Usado pelas telas que montam listas de pessoas (membros de canal,
    menções, permissões de agente)."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p "
            f"ORDER BY p.full_name NULLS LAST, p.email"
        )
    return [PerfilOut(**dict(l)) for l in linhas]


@router.get("/me", response_model=PerfilOut)
async def meu_perfil(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1::uuid",
            usuario.id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
    return PerfilOut(**dict(linha))


@router.patch("/me", response_model=PerfilOut)
async def atualizar_meu_perfil(
    dados: PerfilPatch,
    usuario: Usuario = Depends(usuario_atual),
):
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")

    atribuicoes = ", ".join(f"{c} = ${i}" for i, c in enumerate(campos, start=1))

    # Mexer no status personalizado carimba quando foi posto — com `now()` do
    # SQL, não como parâmetro. O horário é do servidor: com o relógio do
    # navegador adiantado, "há 5 minutos" vira "daqui a 5 minutos" para quem vê.
    if "custom_status" in campos or "custom_status_emoji" in campos:
        atribuicoes += ", custom_status_set_at = now()"
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        # `RETURNING` não enxerga alias de tabela, e `_COLUNAS` passou a ser
        # qualificado com `p.` para conviver com a subconsulta do papel. Só o id
        # volta daqui; o resto é relido logo abaixo, já com o papel junto.
        atualizado = await conn.fetchval(
            f"UPDATE public.profiles SET {atribuicoes}, updated_at = now() "
            f"WHERE id = ${len(campos) + 1}::uuid RETURNING id",
            *campos.values(),
            usuario.id,
        )
        if atualizado is None:
            # A policy "Users update own profile" filtra por id = auth.uid(); zero
            # linhas aqui significa perfil inexistente, não falta de permissão.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1::uuid",
            usuario.id,
        )
    return PerfilOut(**dict(linha))


class PerfilAdminPatch(BaseModel):
    """O que um `administrador` muda no perfil de outra pessoa.

    Portado das escritas que a tela de usuários fazia direto no Supabase — não
    havia edge function para isto, o RLS é que segurava. A regra de quem pode
    era a policy mais o `isAdmin` do front; aqui é `exige_papel`.
    """

    role: str | None = None
    status: str | None = None
    # Vêm do cadastro do RH. Quem edita é o administrador, não a própria
    # pessoa: cargo e área são fato organizacional, não preferência — quem se
    # promove sozinho no perfil quebra a lista que o RH usa para conferir.
    departamento: str | None = Field(default=None, max_length=120)
    cargo: str | None = Field(default=None, max_length=120)


_PAPEIS = {"administrador", "colaborador"}
# Campos de texto que o administrador edita direto em `profiles`. Ficam numa
# lista para o UPDATE ser montado a partir dela — acrescentar um campo novo
# deixa de exigir mexer no SQL.
_CAMPOS_TEXTO = ("departamento", "cargo")
_STATUS_PERFIL = {"active", "inactive"}


@router.patch("/{user_id}", response_model=PerfilOut)
async def atualizar_perfil(
    user_id: str,
    dados: PerfilAdminPatch,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")
    if "role" in campos and campos["role"] not in _PAPEIS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Papel inválido. Use um de: {', '.join(sorted(_PAPEIS))}.",
        )
    if "status" in campos and campos["status"] not in _STATUS_PERFIL:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"status inválido. Use um de: {', '.join(sorted(_STATUS_PERFIL))}.",
        )

    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM public.profiles WHERE id = $1::uuid", user_id
        )
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")

        async with conn.transaction():
            if "role" in campos:
                # Apaga e insere, como o front fazia — `user_roles` admite mais
                # de uma linha por usuário, e trocar o papel é substituir o
                # conjunto, não editar uma linha. Numa transação porque o
                # intervalo entre o DELETE e o INSERT é um usuário sem papel
                # nenhum, e `has_role` negaria tudo nesse instante.
                await conn.execute(
                    "DELETE FROM public.user_roles WHERE user_id = $1::uuid", user_id
                )
                await conn.execute(
                    "INSERT INTO public.user_roles (user_id, role) "
                    "VALUES ($1::uuid, $2::public.app_role)",
                    user_id, campos["role"],
                )
                await _registrar_acesso(
                    conn, usuario.id, "change_role",
                    {"target_user": user_id, "new_role": campos["role"]},
                )

            for campo in _CAMPOS_TEXTO:
                if campo in campos:
                    # `btrim` + NULLIF aqui e não só na tela: "RH " e "RH" viram
                    # dois departamentos na hora de agrupar, e o espaço sobra
                    # sempre que alguém cola de planilha.
                    await conn.execute(
                        f"UPDATE public.profiles SET {campo} = NULLIF(btrim($2), ''), "
                        " updated_at = now() WHERE id = $1::uuid",
                        user_id, campos[campo] or "",
                    )

            if "status" in campos:
                await conn.execute(
                    "UPDATE public.profiles SET status = $2, updated_at = now() "
                    "WHERE id = $1::uuid",
                    user_id, campos["status"],
                )
                await _registrar_acesso(
                    conn, usuario.id,
                    "deactivate_user" if campos["status"] == "inactive" else "activate_user",
                    {"target_user": user_id},
                )

        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1::uuid",
            user_id,
        )
    return PerfilOut(**dict(linha))


async def _registrar_acesso(conn, autor_id: str, acao: str, metadata: dict) -> None:
    """Trilha em `access_logs`. O front gravava isto junto de cada mudança —
    quem mudou, o quê, em quem. Vai na mesma transação: log que some quando a
    escrita dá errado é pior que log nenhum, porque dá falsa confiança."""
    await conn.execute(
        "INSERT INTO public.access_logs (user_id, action, metadata) "
        "VALUES ($1::uuid, $2, $3::text::jsonb)",
        autor_id, acao, json.dumps(metadata),
    )


class ContaNovaIn(BaseModel):
    """Criação de conta pelo administrador.

    Substitui a edge `invite-user`, que mandava convite por e-mail
    (`inviteUserByEmail`) e deixava a conta pendente até a pessoa clicar no
    link. **Decisão do Erick (06/08/2026):** a HS não usa convite — o admin cria
    a conta, entrega as credenciais pelo canal interno e a pessoa já entra. Some
    a dependência de servidor de e-mail e o estado "pendente".
    """

    email: EmailStr
    nome: str = Field(min_length=1, max_length=200)
    senha: str = Field(min_length=8, max_length=LIMITE_SENHA_BYTES)
    # ⚠️ `colaborador`, não `sem_papel`: este valor vai direto para um
    # `::public.app_role`, e `sem_papel` não é do enum — é o rótulo que a
    # LEITURA usa para quem não tem linha em `user_roles`. Usá-lo aqui daria
    # "Papel inválido" em toda criação que não escolhesse papel.
    role: str = "colaborador"
    departamento: str | None = Field(default=None, max_length=120)
    cargo: str | None = Field(default=None, max_length=120)


@router.post("", response_model=PerfilOut, status_code=status.HTTP_201_CREATED)
async def criar_conta(
    dados: ContaNovaIn,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    if dados.role not in _PAPEIS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Papel inválido. Use um de: {', '.join(sorted(_PAPEIS))}.",
        )

    senha_hash = gerar_hash(dados.senha)

    async with sessao(role="service_role") as conn:
        async with conn.transaction():
            # `email_confirmed_at` preenchido na criação: não há fluxo de
            # confirmação por e-mail aqui, e deixar nulo faria a conta nascer
            # num estado que nada nesta instalação resolve.
            user_id = await conn.fetchval(
                """
                INSERT INTO auth.users (email, password_hash, email_confirmed_at)
                VALUES ($1, $2, now())
                ON CONFLICT (email) DO NOTHING
                RETURNING id
                """,
                dados.email, senha_hash,
            )
            if user_id is None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "Já existe uma conta com este e-mail."
                )
            await conn.execute(
                "INSERT INTO public.profiles (id, email, full_name, departamento, cargo) "
                "VALUES ($1, $2, $3, NULLIF(btrim($4), ''), NULLIF(btrim($5), ''))",
                user_id, dados.email, dados.nome,
                dados.departamento or "", dados.cargo or "",
            )
            await conn.execute(
                "INSERT INTO public.user_roles (user_id, role) "
                "VALUES ($1, $2::public.app_role)",
                user_id, dados.role,
            )
            await _registrar_acesso(
                conn, usuario.id, "create_user",
                {"target_user": str(user_id), "email": dados.email, "role": dados.role},
            )

        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1",
            user_id,
        )

    logger.info("Conta criada por %s: %s (%s)", usuario.id, dados.email, dados.role)
    return PerfilOut(**dict(linha))


class SenhaAdminIn(BaseModel):
    senha: str = Field(min_length=8, max_length=LIMITE_SENHA_BYTES)


@router.post("/{user_id}/senha", status_code=status.HTTP_204_NO_CONTENT)
async def definir_senha(
    user_id: str,
    dados: SenhaAdminIn,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    """O administrador define a senha de outra pessoa.

    **Não pede a senha atual, e isso é a diferença em relação a
    `/auth/trocar-senha`.** Lá quem troca é o dono da conta, e conferir a atual
    impede que quem senta numa máquina destravada tome a conta. Aqui quem troca
    é o administrador, que por definição não sabe a senha do outro — exigi-la
    tornaria a rota inútil.

    O que autoriza é o papel, e por isso ele é a única defesa: `exige_papel`
    não é detalhe de organização aqui, é o controle de acesso inteiro.

    Decisão de 14/08/2026, do Erick: **a Health & Safety é empresa fechada e
    quem define senha é o administrador.** As pessoas entram pelo FortiPAM, que
    guarda a credencial — colaborador trocando a própria senha por fora
    dessincronizaria o cofre, que é a origem da verdade. Por isso
    `/auth/trocar-senha` passou a exigir `administrador` também.

    Marca o perfil como `active` na mesma transação, como fazia a troca da
    própria senha: senha definida e perfil pendente é um estado que só confunde.
    """
    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM auth.users WHERE id = $1::uuid", user_id
        )
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")

        async with conn.transaction():
            await conn.execute(
                "UPDATE auth.users SET password_hash = $2, updated_at = now() "
                " WHERE id = $1::uuid",
                user_id, gerar_hash(dados.senha),
            )
            await conn.execute(
                "UPDATE public.profiles SET status = 'active', updated_at = now() "
                " WHERE id = $1::uuid AND status IS DISTINCT FROM 'active'",
                user_id,
            )

    # A senha nunca entra no log — nem truncada. O que importa registrar é quem
    # mexeu em quem.
    logger.info("Senha definida por %s para %s", usuario.id, user_id)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_conta(
    user_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    """Apaga a conta e o que depende dela.

    Portado de `delete-user`. A ordem das exclusões não é estilo: **não há
    cascade a partir de `auth.users` neste projeto** — o comentário da edge diz
    isso com todas as letras — então as tabelas dependentes têm que sair antes,
    senão a FK barra a última linha.

    A edge limpava `user_roles`, `channel_members` e `profiles`. Mantido igual:
    se alguma outra FK barrar, o erro sobe em vez de a conta sumir pela metade.
    """
    if user_id == usuario.id:
        # Vinha da edge. Sem isto, um administrador sozinho apaga a si mesmo e a
        # instalação fica sem administrador nenhum.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Você não pode excluir a própria conta."
        )

    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval(
            "SELECT 1 FROM auth.users WHERE id = $1::uuid", user_id
        )
        if not existe:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Usuário não encontrado.")

        async with conn.transaction():
            await conn.execute(
                "DELETE FROM public.user_roles WHERE user_id = $1::uuid", user_id
            )
            await conn.execute(
                # ⚠️ `channel_members.user_id` é **text**, não uuid — um canal
                # também tem agente como membro, e `agent_id` é texto. Comparar
                # com `$1::uuid` dá "operator does not exist: text = uuid". O
                # `.eq()` do Supabase mandava string e escondia a diferença.
                "DELETE FROM public.channel_members WHERE user_id = $1", user_id
            )
            await conn.execute("DELETE FROM public.profiles WHERE id = $1::uuid", user_id)
            await conn.execute("DELETE FROM auth.users WHERE id = $1::uuid", user_id)
            await _registrar_acesso(
                conn, usuario.id, "delete_user", {"deleted_user": user_id}
            )

    logger.info("Conta %s excluída por %s", user_id, usuario.id)


@router.post("/me/presenca", status_code=status.HTTP_204_NO_CONTENT)
async def bater_presenca(usuario: Usuario = Depends(usuario_atual)):
    """Marca que a pessoa está online agora. Chamado em intervalo pela tela.

    Nunca falha para quem chamou: presença é enfeite, e um erro aqui não pode
    aparecer como problema no meio de uma conversa. O `use-presence` já tratava
    assim do lado do navegador.
    """
    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            await conn.execute(
                "UPDATE public.profiles SET last_seen_at = now() WHERE id = $1::uuid",
                usuario.id,
            )
    except Exception as e:  # noqa: BLE001
        logger.debug("Presença de %s não gravada: %s", usuario.id, e)


@router.get("/{user_id}", response_model=PerfilOut)
async def obter(user_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Perfil de outra pessoa. O RLS decide o que se enxerga."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1::uuid",
            user_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
    return PerfilOut(**dict(linha))
