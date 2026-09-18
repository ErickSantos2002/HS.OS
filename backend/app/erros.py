"""Erro não tratado vira 500 com CORS — e com rastro no log.

⚠️ **Um 500 sem `Access-Control-Allow-Origin` chega no navegador como queda de
rede.** O `fetch` rejeita antes de a aplicação ver o status, `api.ts` classifica
como `status === 0` e a tela mostra "Não foi possível falar com o servidor.".
Quem investiga vai olhar rede, firewall e túnel — foi exatamente o que aconteceu
em 18/09/2026, por três rodadas, enquanto o defeito era uma coluna faltando no
banco (`column "seq_depois" does not exist`, a migração `016` não aplicada em
produção). O DevTools mostrava o 500; a aplicação, não.

⚠️ **`@app.exception_handler(Exception)` NÃO resolve isso.** É a tentativa
óbvia e ela falha em silêncio: no Starlette esse handler é atendido pelo
`ServerErrorMiddleware`, que a pilha monta **acima** do `CORSMiddleware` —

    ServerErrorMiddleware   ← o handler de Exception mora aqui
      CORSMiddleware        ← quem acrescenta os cabeçalhos
        ExceptionMiddleware
          rotas

então a resposta de erro sai por fora do CORS, sem cabeçalho nenhum, igual a
antes. O que resolve é capturar a exceção **por dentro** do CORS, que é o que
o middleware daqui faz — e por isso a ordem de registro em
`instalar_tratamento_de_erros` é o miolo da correção, não um detalhe.

**O que vai para a tela e o que fica no log.** A mensagem do Postgres não desce
para o navegador: numa rota de conector ela carrega nome de tabela, e às vezes
o valor recebido. Mas esconder o detalhe sem deixar rastro só troca um cego por
outro — então cada 500 ganha uma **referência curta**, que aparece nos dois
lados: na tela, para a pessoa repetir; no log, junto do traceback completo.
"""
import logging
from uuid import uuid4

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger(__name__)


class ErroInternoMiddleware(BaseHTTPMiddleware):
    """Captura o que escapou das rotas e responde JSON — de dentro do CORS.

    Só trata `http`: o `BaseHTTPMiddleware` repassa `websocket` e `lifespan`
    sozinho, então o `/ws` não passa por aqui.
    """

    async def dispatch(self, request: Request, seguir) -> Response:
        try:
            return await seguir(request)
        except Exception:
            referencia = uuid4().hex[:8]
            # `exception` e não `error`: sem o traceback a referência não leva
            # a lugar nenhum, e foi a falta dele que fez o defeito de 18/09
            # existir só na tela de quem tentou.
            logger.exception(
                "500 em %s %s — ref %s",
                request.method, request.url.path, referencia,
            )
            return JSONResponse(
                status_code=500,
                content={
                    "detail": (
                        "Erro interno no servidor. Se puder, mande esta "
                        f"referência a quem cuida do sistema (ref: {referencia})."
                    )
                },
            )


def instalar_tratamento_de_erros(app: FastAPI, origens: list[str]) -> None:
    """Monta o CORS por fora e a captura de erro por dentro.

    ⚠️ **A ordem das duas chamadas é a correção.** O `add_middleware` do
    Starlette faz `insert(0, ...)`, ou seja **o último registrado fica por
    fora**. Registrar o CORS depois é o que põe a resposta de erro dentro do
    alcance dele; inverter as duas linhas devolve o defeito sem quebrar teste
    nenhum que não seja o de cabeçalho.
    """
    app.add_middleware(ErroInternoMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(set(origens)),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
