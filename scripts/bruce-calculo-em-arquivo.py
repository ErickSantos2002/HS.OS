"""Ensina o Bruce a calcular sobre CSV anexado DENTRO da sandbox (PK-06, 26/11/2026).

    cd backend
    .venv/bin/python ../scripts/bruce-calculo-em-arquivo.py            # ensaio
    .venv/bin/python ../scripts/bruce-calculo-em-arquivo.py --aplicar  # grava e relê

⚠️ **Por que existe:** em 24/11 a Lidisay mandou o export "Situação do
Fechamento dos Espelhos" do Flash — que a `relatorio_ponto` não cobre — e o
Bruce, para levar o CSV ao Python, procurou o próprio texto dentro do arquivo
da SESSÃO (`/root/.openclaw/agents/bruce/sessions/…jsonl`). Na sandbox esse
caminho não existe. O substituto é gravar o que a `ler_anexo` devolveu com a
ferramenta `write`, dentro do workspace, e conferir a contagem de linhas
contra o total que a `ler_anexo` informa — a cópia é do modelo, e é ali que
um número pode sair errado.

O definitivo é uma ferramenta `relatorio_espelhos` no molde da
`relatorio_ponto`, quando a Lidisay puder validar o que ela quer.

Bloco entre marcadores no `TOOLS.md`: rodar de novo substitui, não duplica.
Mede o teto do arquivo e o total dos sete antes de gravar.
"""
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

AGENTE = "bruce"
ARQUIVO = "TOOLS.md"
INICIO, FIM = "<!-- hsos:calculo-em-arquivo -->", "<!-- /hsos:calculo-em-arquivo -->"

BLOCO = f"""{INICIO}
## Calcular sobre um CSV anexado (sandbox)

Meu terminal roda isolado: só enxergo o meu workspace (`/workspace`) e o
`/tmp`. **Nunca procuro anexo dentro de arquivo de sessão** — não existe mais
para mim, e não é lugar de dado.

Quando um anexo pede conta que nenhuma ferramenta faz (ex.: "Situação do
Fechamento dos Espelhos" do Flash, que a `relatorio_ponto` não cobre), faço
assim **sempre — mesmo com poucas linhas**. Em 26/11, com 6 linhas, contei de
cabeça e escrevi "conferido" sem ter conferido nada: o número estava certo por
sorte, e é dado de RH.

1. `ler_anexo` em TODAS as páginas. A 1ª linha de cada página é o cabeçalho
   e se repete — guardo uma vez só.
2. `write` em `tmp/<nome>.tsv` com o cabeçalho e as linhas **exatamente** como
   vieram (separadas por tab). É rascunho de cálculo, não entrega: o aviso de
   "nunca escreva o arquivo no meu workspace" é sobre arquivo para a pessoa,
   que continua indo por `enviar_arquivo`.
3. ⚠️ **Antes de qualquer conta, confiro a cópia:** `exec` com python que
   conta as linhas de dados do `.tsv` e compara com o "de N" que a `ler_anexo`
   mostrou. Diferente → gravo de novo; não calculo sobre cópia errada.
4. Só então o python faz as contas, em `/workspace/tmp`. Os números saem do
   python, nunca de cabeça.
5. Na resposta, digo que conferi a contagem (ex.: "26 linhas lidas, 26 no
   arquivo").
{FIM}"""


def com_bloco(atual: str) -> str:
    padrao = re.compile(re.escape(INICIO) + r".*?" + re.escape(FIM), re.S)
    if padrao.search(atual):
        return padrao.sub(lambda _: BLOCO, atual)
    return atual.rstrip("\n") + "\n\n" + BLOCO + "\n"


async def principal(argv: list[str]) -> int:
    from app.gateway import config as cfg
    from app.gateway.client import obter_cliente, teto_do_agente
    from app.gateway.patch import config_do_gateway

    spec_rb = os.path.join(os.path.dirname(os.path.abspath(__file__)), "regras-base-especialistas.py")
    import importlib.util
    s = importlib.util.spec_from_file_location("rb", spec_rb)
    rb = importlib.util.module_from_spec(s)
    s.loader.exec_module(rb)

    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    parsed, _ = await config_do_gateway()

    async def conteudo(nome):
        r = await cli.chamar("agents.files.get", {"agentId": AGENTE, "name": nome})
        return ((r.get("file") or {}).get("content")) or ""

    lista = await cli.chamar("agents.files.list", {"agentId": AGENTE})
    nomes = [f["name"] for f in lista.get("files", []) if not f.get("missing")]
    tamanhos = {n: len(await conteudo(n)) for n in nomes}
    atual = await conteudo(ARQUIVO)
    novo = com_bloco(atual)
    teto, total = await teto_do_agente(cli, AGENTE), rb.teto_total(parsed, AGENTE)
    soma = sum(tamanhos.values()) - tamanhos.get(ARQUIVO, 0) + len(novo)
    linha = f"{AGENTE} {ARQUIVO} {len(atual)} → {len(novo)} (teto {teto}); sete {soma} (teto {total})"
    if len(novo) > teto or soma > total:
        print(f"❌ {linha} — passaria do teto, NÃO gravo")
        return 1
    if novo == atual:
        print(f"=  {linha} — já igual")
        return 0
    if "--aplicar" not in argv:
        print(f"~  {linha} — mudaria\n\n{BLOCO}\n\nEnsaio. Rode com --aplicar para gravar.")
        return 0
    await cli.chamar("agents.files.set", {"agentId": AGENTE, "name": ARQUIVO, "content": novo})
    ok = await conteudo(ARQUIVO) == novo
    print(f"{'✅' if ok else '❌'} {linha} — {'gravado e relido' if ok else 'FALHOU na releitura'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
