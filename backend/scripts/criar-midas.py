"""Cria o Midas, o CFO de IA, no gateway e no banco — ensaio por padrão.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/criar-midas.py            # ensaio
    PYTHONPATH=. .venv/bin/python scripts/criar-midas.py --aplicar  # escreve

Lê o `backend/.env` (banco e gateway) e exige o túnel do OpenClaw aberto.
Spec: `docs/superpowers/specs/2026-11-18-cfo-midas-design.md`; plano, Tarefa 4.

⚠️ **É ESCRITA NO GATEWAY E NO BANCO DE PRODUÇÃO.** O ensaio mostra a decisão,
os tamanhos dos sete arquivos e o escopo completo sem escrever nada — e tem que
ser mostrado ao Erick antes do `--aplicar`.

O banco é o do backend (`service_role`, que tem `GRANT ALL` em
`agent_profiles` pela `001` — o mesmo caminho do `criar_bot`). Não precisa do
cadastro `bancos` nem do perfil admin.

Ordem do `--aplicar`, repetível (rodar de novo não cria outro agente nem
reescreve os arquivos de um Midas vivo — `decidir_criacao`):

1. lê a config; o modelo e o escopo partem da entrada da `iris` no gateway;
2. `colisao` (um `midas` com workspace que não é o nosso) aborta sem escrever;
3. `criar`: `agents.create` e confere que apareceu na config;
4. só em `criar`/`adotar`: os sete arquivos, com os blocos `hsos:empresa` e
   `hsos:time` copiados dos da `iris`;
5. patch do `agents.list` INTEIRO com o escopo do Midas, conferindo que ele
   fechou e que nenhum outro agente perdeu o `alsoAllow`;
6. `agentToAgent`;
7. `agent_profiles`: INSERT com acesso, usuários e líder copiados da `iris`
   (`ON CONFLICT DO NOTHING`) — POR ÚLTIMO: a linha quer dizer "terminou";
8. o roster da `nina` (lê a linha).

Se falhar no meio de um `criar`, desfaz (`_desfazer_criacao`: gateway e banco).
Midas que já existia nunca é apagado.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys

logger = logging.getLogger("criar-midas")

LIDER_PADRAO = "nina"
NOME = "Midas"
ESPECIALIDADE = ("Financeiro (CFO): faturamento, vendas, estoque e notas do ERP Tiny/DataCoreHS, "
                 "contas a pagar e receber, inadimplência, caixa")
VOZ = "pt-BR-AntonioNeural"


def _no_gateway(conf: dict, agent_id: str) -> dict | None:
    return next((a for a in (conf.get("agents") or {}).get("list") or []
                 if str(a.get("id")) == agent_id), None)


def _servidores(conf: dict) -> dict:
    return ((conf.get("mcp") or {}).get("servers")) or {}


def _modelo(entrada: dict) -> str | None:
    # ⚠️ O `model` é assimétrico: a config pode trazer `{"primary": …}`, e o
    # `agents.create` quer string nua.
    m = entrada.get("model")
    return m.get("primary") if isinstance(m, dict) else m


def _bloco(texto: str, inicio: str, fim: str) -> str:
    i, f = texto.find(inicio), texto.find(fim)
    if i == -1 or f == -1 or f < i:
        return ""
    return texto[i + len(inicio):f].strip("\n")


class _Deps:
    """As pontas reais: banco (service_role), gateway e o desfazer do `POST /agents`."""

    async def config(self) -> tuple[dict, str]:
        from app.gateway import patch as patch_gw

        return await patch_gw.config_do_gateway()

    async def linha(self, agent_id: str) -> dict | None:
        from app.database import sessao

        async with sessao(role="service_role") as conn:
            r = await conn.fetchrow(
                "SELECT agent_id, access_type, allowed_user_ids, leader_id "
                "  FROM public.agent_profiles WHERE agent_id = $1", agent_id)
        return dict(r) if r else None

    async def ler_arquivo(self, agent_id: str, nome: str) -> str:
        r = await self.chamar("agents.files.get", {"agentId": agent_id, "name": nome})
        return ((r.get("file") or {}).get("content")) or ""

    async def chamar(self, metodo: str, params: dict) -> dict:
        from app.gateway import config as cfg
        from app.gateway.client import obter_cliente

        c = await cfg.carregar()
        return await obter_cliente(c.url, c.token).chamar(metodo, params)

    async def inserir(self, linha: dict) -> None:
        from app.database import sessao

        async with sessao(role="service_role") as conn:
            await conn.execute(
                """
                INSERT INTO public.agent_profiles
                    (agent_id, openclaw_id, name, emoji, specialty, workspace, model,
                     access_type, allowed_user_ids, leader_id, status, is_official,
                     is_leader, dono_id, tts_voice_id)
                VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8::uuid[], $9, 'active', false,
                        false, NULL, $10)
                ON CONFLICT (agent_id) DO NOTHING
                """,
                linha["agent_id"], linha["name"], linha["emoji"], linha["specialty"],
                linha["workspace"], linha["model"], linha["access_type"],
                list(linha["allowed_user_ids"]), linha["leader_id"], linha["tts_voice_id"],
            )

    async def patch(self, patch: dict, base_hash: str, conferir) -> None:
        from app.gateway import patch as patch_gw

        await patch_gw.aplicar_patch(patch, base_hash, conferir=conferir)

    async def liberar(self, agent_id: str) -> None:
        from app.routers.agents import _liberar_entre_agentes

        await _liberar_entre_agentes(agent_id)

    async def roster(self, lider_id: str) -> None:
        from app.routers.agents import _atualizar_roster_do_lider

        await _atualizar_roster_do_lider(lider_id)

    async def desfazer(self, agent_id: str) -> bool:
        from app.routers.agents import _desfazer_criacao

        return await _desfazer_criacao(agent_id)


async def criar_midas(deps, aplicar: bool) -> dict:
    """Decide, mostra e (com `aplicar`) cria. Levanta só em falha de escrita."""
    from app.agentes.midas import EMOJI, arquivos_do_midas
    from app.agentes.midas_escopo import (
        AGENTE, ORIGEM, WORKSPACE, decidir_criacao, escopo_final, midas_esta_fechado)
    from app.gateway.client import excede_o_teto
    from app.routers.integracoes import _MARCA_FIM, _MARCA_INICIO
    from app.time_da_empresa import MARCA_FIM as TIME_FIM, MARCA_INICIO as TIME_INICIO

    conf, _ = await deps.config()
    servidores = _servidores(conf)
    iris = _no_gateway(conf, ORIGEM)
    if iris is None:
        return {"decisao": "falhou", "motivo": f"a {ORIGEM} não está no gateway: sem escopo de partida"}
    midas = _no_gateway(conf, AGENTE)
    linha_midas = await deps.linha(AGENTE)
    decisao = decidir_criacao(bool(midas), bool(linha_midas), (midas or {}).get("workspace"))
    saida: dict = {"decisao": decisao, "workspace": WORKSPACE}
    if decisao == "colisao":
        return {**saida, "motivo": f"{AGENTE} existe no gateway com o workspace "
                                   f"{midas.get('workspace')} — não é nosso, nada foi feito"}

    linha_iris = await deps.linha(ORIGEM)
    if linha_iris is None:
        return {**saida, "decisao": "falhou", "motivo": f"a {ORIGEM} não tem linha em agent_profiles"}

    blocos = {
        "empresa": _bloco(await deps.ler_arquivo(ORIGEM, "AGENTS.md"), _MARCA_INICIO, _MARCA_FIM),
        "time": _bloco(await deps.ler_arquivo(ORIGEM, "USER.md"), TIME_INICIO, TIME_FIM),
    }
    arquivos = arquivos_do_midas(blocos)
    grandes = [n for n, c in arquivos.items() if excede_o_teto(c)]
    modelo = _modelo(iris)
    tools = escopo_final(iris.get("tools") or {}, servidores)
    linha = {
        "agent_id": AGENTE, "name": NOME, "emoji": EMOJI, "specialty": ESPECIALIDADE,
        "workspace": WORKSPACE, "model": modelo,
        "access_type": linha_iris["access_type"],
        "allowed_user_ids": list(linha_iris.get("allowed_user_ids") or []),
        "leader_id": linha_iris.get("leader_id") or LIDER_PADRAO, "tts_voice_id": VOZ,
        "is_leader": False, "dono_id": None,
    }
    lider = linha["leader_id"]
    ja_fechado = bool(midas) and midas_esta_fechado(midas.get("tools") or {}, servidores)
    saida.update({
        "modelo": modelo, "emoji": EMOJI, "linha": linha,
        "blocos": {k: len(v) for k, v in blocos.items()},
        "arquivos": {n: len(c) for n, c in arquivos.items()},
        "escreve_arquivos": decisao in ("criar", "adotar"),
        "tools": tools, "ja_fechado": ja_fechado, "lider": lider,
        "a2a": AGENTE in ((((conf.get("tools") or {}).get("agentToAgent")) or {}).get("allow") or []),
    })
    if grandes and saida["escreve_arquivos"]:
        # Antes de qualquer escrita: o gateway truncaria o fim em silêncio.
        return {**saida, "decisao": "falhou",
                "motivo": f"acima do teto de 20.000 caracteres: {', '.join(grandes)}"}
    if not aplicar:
        return saida

    criou = False
    try:
        if decisao == "criar":
            await deps.chamar("agents.create", {
                "name": AGENTE, "workspace": WORKSPACE, "model": modelo, "emoji": EMOJI})
            criou = True
            conf, _ = await deps.config()
            if not _no_gateway(conf, AGENTE):
                raise RuntimeError(f"agents.create respondeu, mas {AGENTE} não apareceu na config")

        if saida["escreve_arquivos"]:
            for nome, conteudo in arquivos.items():
                await deps.chamar("agents.files.set",
                                  {"agentId": AGENTE, "name": nome, "content": conteudo})

        conf, base_hash = await deps.config()
        servidores = _servidores(conf)
        lista = [dict(a) for a in (conf.get("agents") or {}).get("list") or []]
        alvo = next(a for a in lista if str(a.get("id")) == AGENTE)
        if not midas_esta_fechado(alvo.get("tools") or {}, servidores):
            iris_agora = next(a for a in lista if str(a.get("id")) == ORIGEM)
            alvo["tools"] = escopo_final(iris_agora.get("tools") or {}, servidores)
            # ⚠️ `agents.list` é array: o merge patch troca o array inteiro.
            # A conferência olha os OUTROS também — um deles sem alsoAllow é
            # agente que perdeu banco sem ninguém ver.
            antes = {str(a.get("id")): (a.get("tools") or {}).get("alsoAllow")
                     for a in lista if str(a.get("id")) != AGENTE}

            def conferir(c: dict) -> bool:
                relida = {str(a.get("id")): a for a in (c.get("agents") or {}).get("list") or []}
                return (midas_esta_fechado((relida.get(AGENTE) or {}).get("tools") or {}, servidores)
                        and all(((relida.get(i) or {}).get("tools") or {}).get("alsoAllow") == v
                                for i, v in antes.items()))

            await deps.patch({"agents": {"list": lista}}, base_hash, conferir)

        await deps.liberar(AGENTE)
        # ⚠️ **A linha em `agent_profiles` é a última escrita: ela significa
        # "o Midas terminou".** Inserida antes, um `files.set` que falhasse ao
        # adotar deixava a linha, a execução seguinte decidia `ja_existe` e o
        # Midas rodava com o template em branco; e com `allowed_user_ids` ele
        # aparecia na tela antes de o escopo estar fechado (revisão de
        # 18/11/2026). Gateway sem linha é sempre `adotar`: reescreve e refecha.
        await deps.inserir(linha)
        # Depois da linha porque o roster lê `agent_profiles` para listar quem
        # existe; se só ele falhar, rodar de novo (`ja_existe`) o refaz.
        await deps.roster(lider)
    except Exception:
        if criou:
            logger.error("Midas não fechou — desfazendo a criação")
            if not await deps.desfazer(AGENTE):
                logger.error("Midas ficou no gateway sem escopo — remova à mão")
        else:
            logger.error("Midas (já existia) não fechou; NADA foi apagado — rode de novo")
        raise
    return {**saida, "aplicado": True}


def _imprimir(r: dict, aplicar: bool) -> None:
    from app.agentes.midas_escopo import DENY_OBRIGATORIO
    from app.gateway.client import TETO_ARQUIVO_AGENTE

    print(f"decisão: {r['decisao']}")
    if r.get("motivo"):
        print(f"motivo: {r['motivo']}")
    if "tools" not in r:
        return
    l = r["linha"]
    print(f"agente: midas · workspace {r['workspace']} · modelo {r['modelo']} · emoji {r['emoji']}")
    print(f"agent_profiles: name={l['name']!r} specialty={l['specialty']!r} access_type={l['access_type']} "
          f"allowed_user_ids={len(l['allowed_user_ids'])} leader_id={l['leader_id']} voz={l['tts_voice_id']} "
          "(ON CONFLICT DO NOTHING)")
    print(f"blocos copiados da iris: {r['blocos']}")
    acao = "grava" if r["escreve_arquivos"] else "NÃO grava (Midas vivo)"
    print(f"arquivos ({acao}; teto {TETO_ARQUIVO_AGENTE}):")
    for n, tam in r["arquivos"].items():
        print(f"  {n:13} {tam:>6}{'  ⚠️ ACIMA DO TETO' if tam > TETO_ARQUIVO_AGENTE else ''}")
    t = r["tools"]
    print(f"escopo {'(já fechado, sem patch)' if r['ja_fechado'] else '(patch do agents.list inteiro)'}:")
    print("  alsoAllow:")
    for x in t["alsoAllow"]:
        print(f"    {x}")
    deny = t["deny"]
    anexos = [x for x in deny if x.startswith("hsos-anexos-")]
    print(f"  deny: {len(deny)} itens — {len(anexos)} de anexos de outros agentes; o resto:")
    for x in deny:
        if not x.startswith("hsos-anexos-") and not x.startswith("hsos-email-") and not x.startswith("hsos-bot-"):
            print(f"    {x}")
    print(f"  deny de hsos-email-*/hsos-bot-*: {sum(1 for x in deny if x.startswith(('hsos-email-', 'hsos-bot-')))}")
    print(f"  obrigatórios presentes: {all(d in deny for d in DENY_OBRIGATORIO)}")
    print(f"agentToAgent: {'já está' if r['a2a'] else 'entra'} · roster da {r['lider']}: regravado")
    if not aplicar:
        print("\n(ensaio — nada foi escrito; rode com --aplicar)")
    print("\nDepois do --aplicar:")
    print("  1. PYTHONPATH=. .venv/bin/python scripts/publicar-anexos-mcp.py --aplicar  (entrada hsos-anexos-midas)")
    print("  2. bash scripts/publicar-skills.sh --enviar  (calendario-financeiro e as skills revistas)")
    print("  3. perguntar ao Midas, sem citar o texto: que ferramentas você tem? (esperado: datacorehs,")
    print("     gestorhs, hsgrowth, diretório, documentos, compradores_produto, inadimplencia, anexos,")
    print("     alerta — e NÃO publicar_pagina, sessions_send, cron, web_search)")
    print("  4. perguntar: quem é você e a quem atende? / onde mora o contas a pagar?")


async def main() -> int:
    from dotenv import load_dotenv

    load_dotenv()
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--json", action="store_true", help="imprime o resultado cru")
    a = ap.parse_args()

    from app.database import close_db, init_db

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    await init_db()
    try:
        r = await criar_midas(_Deps(), a.aplicar)
    finally:
        await close_db()
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=1, default=str))
    else:
        _imprimir(r, a.aplicar)
    return 0 if r["decisao"] not in ("colisao", "falhou") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
