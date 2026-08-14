#!/usr/bin/env python3
"""Confere os sete arquivos de um agente contra a realidade.

    python scripts/auditar-agente.py iris

⚠️ **A primeira versão desta auditoria passou um agente quebrado.** Ela conferia
que o `TOOLS.md` "cita a ferramenta de consulta" e que "manda usar LIMIT" — e a
`iris` passou nos dois com um arquivo que citava um schema errado (`public` em
vez de `tiny`) e duas tabelas que não existem. Onze de onze, e o agente não
funcionava.

O defeito era de método: **conferir a forma do texto não diz nada sobre a
verdade dele.** Toda checagem aqui compara o arquivo com o estado ao vivo —
as ferramentas que o agente realmente tem, os schemas que o banco realmente
expõe, o modelo que ele realmente tem configurado.
"""
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
from app.gateway.client import ErroGateway, obter_cliente  # noqa: E402

SETE = ("SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "USER.md",
        "MEMORY.md", "HEARTBEAT.md")

INGLES = ("You are", "Your role", "You should", "Who You Are", "Core Identity",
          "About Your Human", "Local Notes")

SEGREDO = re.compile(
    r"(senha|password|passwd)\s*[:=]\s*\S{4,}|sk-[A-Za-z0-9_-]{12,}"
    r"|postgresql://[^:]+:[^@]{4,}@", re.I)


class Auditoria:
    def __init__(self):
        self.falhas: list[str] = []

    def checa(self, ok, rotulo, detalhe=""):
        print(f"   {'✅' if ok else '❌'} {rotulo}" + ("" if ok else f" — {detalhe}"))
        if not ok:
            self.falhas.append(rotulo)


async def main(agente: str):
    cli = obter_cliente("ws://127.0.0.1:18789", os.environ.get("OPENCLAW_ADMIN_TOKEN", ""))
    a = Auditoria()

    # ── O estado ao vivo, que é com o que os arquivos serão comparados ──
    r = await cli.chamar("config.get", {})
    parsed = ((r.get("payload") or r).get("parsed")) or {}
    perfil = next((x for x in (parsed.get("agents") or {}).get("list") or []
                   if x.get("id") == agente), None)
    if perfil is None:
        print(f"❌ agente `{agente}` não existe no gateway."); return 1

    ferramentas = list(((perfil.get("tools") or {}).get("alsoAllow")) or [])
    modelo = perfil.get("model")
    servidores = list(((parsed.get("mcp") or {}).get("servers")) or {})

    print(f"=== {agente} — estado ao vivo ===")
    print(f"   modelo     : {modelo}")
    print(f"   workspace  : {perfil.get('workspace')}")
    print(f"   ferramentas: {ferramentas or '(nenhuma)'}")

    arquivos = {}
    for n in SETE:
        try:
            f = await cli.chamar("agents.files.get", {"agentId": agente, "name": n})
            arquivos[n] = ((f.get("payload") or f).get("file") or {}).get("content") or ""
        except ErroGateway:
            arquivos[n] = ""

    print("\n=== conteúdo ===")
    for n, c in arquivos.items():
        print(f"   {n:14} {len(c):6}")

    print("\n=== o agente funciona? ===")
    # Modelo nulo não aparece em lugar nenhum até alguém tentar conversar.
    a.checa(bool(modelo), "tem modelo configurado", "model nulo — não responde nada")
    a.checa(all(arquivos.values()), "nenhum arquivo vazio",
            f"vazios: {[n for n, c in arquivos.items() if not c]}")
    ingles = {n: [p for p in INGLES if p in c] for n, c in arquivos.items()}
    ingles = {n: v for n, v in ingles.items() if v}
    a.checa(not ingles, "sem template em inglês", str(ingles))
    com_segredo = [n for n, c in arquivos.items() if SEGREDO.search(c)]
    a.checa(not com_segredo, "nenhuma credencial em arquivo", str(com_segredo))

    print("\n=== o TOOLS.md corresponde às ferramentas de verdade? ===")
    tools = arquivos["TOOLS.md"]
    # Toda ferramenta citada no arquivo tem que existir; e toda ferramenta que
    # o agente tem deveria estar documentada.
    # ⚠️ O agente enxerga a ferramenta SEM o prefixo `mcp__` — foi assim que a
    # `iris` a invocou (`banco-datacorehs__query`). A config guarda com. Comparar
    # cru dá falso positivo, e foi o que aconteceu na primeira execução desta
    # auditoria.
    def nu(nome: str) -> str:
        return nome[len("mcp__"):] if nome.startswith("mcp__") else nome

    citadas = {nu(x) for x in re.findall(r"(?:mcp__)?[\w-]+__\w+", tools)}
    reais = {nu(x) for x in ferramentas}
    inventadas = {c for c in citadas if c not in reais and "__" in c}
    a.checa(not inventadas, "não cita ferramenta que não tem", str(sorted(inventadas)))
    faltando = reais - citadas
    a.checa(not faltando, "documenta as ferramentas que tem", str(sorted(faltando)))

    # ── A parte que a primeira auditoria não fazia: perguntar ao banco ──
    print("\n=== o schema descrito existe? ===")
    bancos = [x for x in reais if x.startswith("banco-")]
    if not bancos:
        print("   (sem conector de banco — nada a conferir)")
    for x in bancos:
        servidor = x.rsplit("__", 1)[0]
        a.checa(servidor in servidores, f"servidor {servidor} existe no gateway",
                "está no alsoAllow e não em mcp.servers — o agente vê a tool e ela não conecta")

    # Schema citado no texto. A auditoria não tem a credencial do agente para
    # perguntar ao banco, então isto fica como aviso — não como aprovação.
    # Só o literal — heurística mais larga trazia "columns", "tables" e o texto
    # em volta da palavra "schema", que não são schema nenhum.
    schemas = set(re.findall(r"table_schema\s*=\s*'(\w+)'", tools))
    schemas |= set(re.findall(r"\bschema[^\w`]{0,12}`(\w+)`", tools, re.I))
    if schemas:
        print(f"   schemas citados: {sorted(schemas)}")
        print("   ⚠️ a auditoria não abre o banco do agente — confira se batem.")

    print("\n=== regras que todo agente herda ===")
    soul = arquivos["SOUL.md"].lower()
    for termo, rotulo in [("identidade", "SOUL: mantém a identidade"),
                          ("escopo", "SOUL: não sai do escopo"),
                          ("avisar_administrador", "SOUL: sabe avisar o administrador")]:
        a.checa(termo in soul, rotulo, f"não achei '{termo}'")
    # A ferramenta de alerta tem que existir de fato, não só ser citada.
    a.checa(any("alerta" in t for t in reais), "tem a ferramenta de alerta",
            "o SOUL manda avisar e ele não tem como")

    usuario = arquivos["USER.md"]
    a.checa("hsos-" in usuario and "diretorio" in usuario.lower(),
            "USER.md ensina a resolver quem fala", "não menciona hsos- + diretorio")
    a.checa(any("diretorio" in t for t in reais), "tem o conector do Diretório",
            "o USER.md manda consultar e ele não tem a ferramenta")

    print(f"\n{'✅ conforme' if not a.falhas else f'⚠️ {len(a.falhas)} ponto(s) a rever'}")
    for x in a.falhas:
        print("   ·", x)
    return 1 if a.falhas else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("uso: python scripts/auditar-agente.py <id-do-agente>"); sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
