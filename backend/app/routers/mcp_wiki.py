"""Servidor MCP que deixa o agente escrever e reler documentos em markdown.

**O buraco que isto fecha.** O conhecimento do agente tinha três lugares e
faltava justamente o documento de trabalho:

    · os sete arquivos — o que ele precisa saber SEMPRE, e custa contexto a cada
      sessão
    · as skills — procedimento que ele abre quando precisa
    · os artefatos — a página HTML que ele produz

Peça um documento hoje e ele sai como texto no chat, que morre na rolagem — ou
vira arquivo no workspace com nome fora dos sete canônicos, que **ninguém lê de
novo**. Três dias depois, "edita aquele documento" não tem a quem se referir: a
sessão é nova e não guarda a conversa.

`documento_listar` é o que faz esse cenário funcionar. Sem ele, as outras três
ferramentas são um poço sem fundo.

⚠️ **A wiki não pode virar lugar de instrução de agente.** Em 17/08/2026 o
`skill_workshop` foi tirado da `iris` e do `atlas` com um raciocínio que vale
igual aqui: *um agente que pode escrever a régua que o governa deixa de ser
governado por ela*. Se alguém puser "regras de atendimento" ou "como calcular X"
num documento e o agente puder editá-lo, a trava da porta da frente é contornada
pelos fundos.

Por isso o agente só escreve **no espaço dele** (`_ESPACO_AGENTES`), criado aqui
e separado do resto da wiki. Ele **lê** a wiki inteira; escrever, só ali. Assim
documento de trabalho e documento de regra ficam fisicamente separados, e a
separação é verificável — não depende de ninguém lembrar da convenção.

⚠️ **O gateway não informa qual agente está chamando** — o servidor MCP é global
e a conexão é uma só para todos. Por isso `agente` e `solicitante` são
parâmetros: o agente sabe os dois (o segundo sai da própria chave de sessão,
`agent:<id>:hsos-<user_id>`, o mesmo mecanismo do Diretório).
"""

import html as html_lib
import logging
import re
from html.parser import HTMLParser

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from app.database import sessao
from app.integracoes import exige_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/mcp", tags=["mcp"])

_PROTOCOLO = "2024-11-05"

# O espaço onde o agente pode escrever. Criado sob demanda na primeira escrita.
_ESPACO_AGENTES = "Documentos dos agentes"

# ⚠️ **A base guarda HTML, não markdown.** O editor da tela é o TipTap e grava
# `<p>…</p>`; o agente escreve markdown, e sem conversão o documento aparecia com
# `#`, `**` e `-` literais, tudo num parágrafo só. Foi assim que o briefing da
# manhã de 20/08/2026 chegou ilegível.
#
# A conversão fica aqui, na fronteira do agente, e não na hora de exibir: assim a
# coluna tem **um** formato só, e a pessoa consegue editar o documento do agente
# na tela normalmente, como se ela o tivesse escrito.
#
# `tables` e `fenced_code` entram porque os briefings usam os dois. `nl2br` NÃO
# entra: markdown de verdade trata quebra simples como continuação de parágrafo,
# e ligá-lo transformaria cada linha numa quebra forçada.
_EXTENSOES_MD = ["tables", "fenced_code", "sane_lists"]

# O que o TipTap sabe representar. Tag fora daqui ele descarta ao carregar, e o
# conteúdo dentro dela sumiria — melhor não gerar.
_TAGS_TIPTAP = ("h1", "h2", "h3", "p", "strong", "em", "u", "s", "ul", "ol", "li",
                "blockquote", "code", "pre", "hr", "br", "a", "table", "thead",
                "tbody", "tr", "th", "td", "img")


def _para_html(texto: str) -> str:
    """Markdown do agente → HTML que o editor da tela entende.

    Texto que já vem em HTML passa direto: o agente pode ter copiado um
    documento existente, e converter de novo escaparia as tags. Nos dois
    ramos, endereço que roda código sai antes de gravar (`_sem_endereco_perigoso`).
    """
    if not texto:
        return ""
    inicio = texto.lstrip()[:40].lower()
    if inicio.startswith("<") and any(f"<{t}" in inicio for t in _TAGS_TIPTAP):
        return _sem_endereco_perigoso(texto)
    import markdown as _md
    return _sem_endereco_perigoso(_md.markdown(texto, extensions=_EXTENSOES_MD))


# ⚠️ PK-01 (24/11/2026): o agente escreve na wiki depois de ler e-mail e anexo
# de terceiros. Um `data-href="javascript:…"` no anexo vira, no "Baixar" de um
# administrador, código na origem do HS.OS com o token dele. O front recusa
# também (`enderecoSeguro`); aqui é a segunda ponta — não chega ao banco.
#
# Lista do que PASSA, não do que cai: esquema novo que rode código não precisa
# estar previsto. `mailto:`/`tel:` passam porque isto vale para todo link do
# documento, não só anexo e vídeo.
#
# ⚠️ O separador é `[\s/]`, não só espaço: o navegador aceita `<a/href=…>`, e a
# primeira versão deixava esse passar (revisão de segurança, 24/11/2026). Pela
# mesma revisão, atributos de evento (`on*`) saem inteiros e os outros
# atributos que carregam endereço entram na conferência.
#
# Não é um sanitizador completo, de propósito: uma lista de tags permitidas
# cortaria os `data-*` dos nós do TipTap (anexo, vídeo, YouTube, tabela) e
# quebraria documento de verdade. Se um dia o HTML gravado aqui for mostrado
# fora do editor sem passar por ele, aí é caso de `nh3` com a lista do TipTap.
_ATRIBUTO_DE_ENDERECO = re.compile(
    r"""([\s/](?:href|src|data-href|formaction|xlink:href|action|poster|background)\s*=\s*)"""
    r"""("[^"]*"|'[^']*'|[^\s>]+)""", re.I)
_ATRIBUTO_DE_EVENTO = re.compile(
    r"""[\s/]on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""", re.I)
_ESQUEMA = re.compile(r"^([a-z][a-z0-9+.\-]*):", re.I)
_ESQUEMAS_OK = {"http", "https", "mailto", "tel", "blob"}
_IMAGEM_EM_DATA = re.compile(r"^data:image/(png|jpe?g|gif|webp);", re.I)


def _endereco_ok(valor: str, atributo: str) -> bool:
    # O navegador decodifica entidade (`&#106;`) e ignora espaço e controle no
    # esquema (`java\tscript:`) — a conferência tem que ver o que ELE verá.
    limpo = re.sub(r"[\x00-\x20\x7f-\x9f]+", "", html_lib.unescape(valor))
    m = _ESQUEMA.match(limpo)
    if not m:
        # Sem esquema: relativo, âncora ou `//host` — que o navegador resolve
        # como http(s). Nenhum deles roda código.
        return True
    if m.group(1).lower() in _ESQUEMAS_OK:
        return True
    return atributo == "src" and bool(_IMAGEM_EM_DATA.match(limpo))


def _sem_endereco_perigoso(html: str) -> str:
    """Tira o atributo de endereço que rodaria código; o resto da tag fica.

    ⚠️ **Duas passadas, e a segunda é a que garante.** A primeira (regex por
    tag) não toca documento normal — os 338 da wiki saem byte a byte iguais. A
    segunda tokeniza com o `html.parser`, que lê atributo como o navegador
    (inclusive `title="x"href=…`, colado na aspa, que a primeira deixava passar
    — revisão de segurança de 24/11/2026). Se ainda sobrar atributo perigoso,
    o documento é REESCRITO pelo tokenizador sem ele. Só documento malicioso
    muda de formato.
    """
    filtrado = _primeira_passada(html)
    if _atributos_perigosos(filtrado):
        filtrado = _reescrever_sem_perigo(filtrado)
    return filtrado


_NOME_DE_ATRIBUTO_OK = re.compile(r"^[a-zA-Z_:][a-zA-Z0-9_:.\-]*$")
_ATRIBUTOS_DE_ENDERECO = {"href", "src", "data-href", "formaction", "xlink:href",
                          "action", "poster", "background"}


def _atributo_perigoso(nome: str, valor: str | None) -> bool:
    nome = nome.lower()
    if nome.startswith("on"):
        return True
    return nome in _ATRIBUTOS_DE_ENDERECO and valor is not None and not _endereco_ok(valor, nome)


class _Olheiro(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.achados: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.achados += [n for n, v in attrs if _atributo_perigoso(n, v)]

    handle_startendtag = handle_starttag


def _atributos_perigosos(html: str) -> list[str]:
    """Os atributos perigosos que um tokenizador de verdade enxerga no HTML."""
    o = _Olheiro()
    o.feed(html)
    o.close()
    return o.achados


class _Reescrita(HTMLParser):
    """Reemite o HTML como o tokenizador o leu, sem atributo perigoso nem nome
    de atributo estranho (`a"b` sairia cru e o navegador o leria de outro
    jeito). Texto e entidades saem como entraram."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.saida: list[str] = []

    def _tag(self, tag, attrs, fecha):
        partes = [tag]
        for n, v in attrs:
            if not _NOME_DE_ATRIBUTO_OK.match(n) or _atributo_perigoso(n, v):
                continue
            partes.append(n if v is None else f'{n}="{html_lib.escape(v, quote=True)}"')
        self.saida.append(f"<{' '.join(partes)}{' /' if fecha else ''}>")

    def handle_starttag(self, tag, attrs):
        self._tag(tag, attrs, False)

    def handle_startendtag(self, tag, attrs):
        self._tag(tag, attrs, True)

    def handle_endtag(self, tag):
        self.saida.append(f"</{tag}>")

    def handle_data(self, data):
        self.saida.append(data)

    def handle_entityref(self, name):
        self.saida.append(f"&{name};")

    def handle_charref(self, name):
        self.saida.append(f"&#{name};")

    def handle_comment(self, data):
        self.saida.append(f"<!--{data}-->")

    def handle_decl(self, decl):
        self.saida.append(f"<!{decl}>")


def _reescrever_sem_perigo(html: str) -> str:
    r = _Reescrita()
    r.feed(html)
    r.close()
    return "".join(r.saida)


def _primeira_passada(html: str) -> str:
    def trocar(m: re.Match) -> str:
        atributo = m.group(1).strip(" \t\n\r\f/").split("=")[0].strip().lower()
        valor = m.group(2)
        if valor[:1] in "\"'":
            valor = valor[1:-1]
        if _endereco_ok(valor, atributo):
            return m.group(0)
        # Mantém o separador: `<a/href=…>` vira `<a/>`, não `<a>` colado no próximo.
        return m.group(1)[0]
    def limpar_tag(tag: str) -> str:
        sem_evento = _ATRIBUTO_DE_EVENTO.sub(lambda m: m.group(0)[0], tag)
        return _ATRIBUTO_DE_ENDERECO.sub(trocar, sem_evento)

    # ⚠️ Só DENTRO de tag de abertura. Sobre o HTML inteiro, "veja onde = aqui"
    # no texto casava com `on*=` e perdia palavras.
    #
    # ⚠️ Varredura à mão, LINEAR, e não regex de tag: a regex
    # `<[a-z](?:"[^"]*"|'[^']*'|[^'">])*>` com aspa sem fechar repetida (`<a "`
    # × 50 mil) varria até o fim a partir de cada `<a` — passou de 60 s no
    # teste (revisão de segurança, 24/11/2026). Excluir `<` da classe resolveria
    # o tempo, mas uma tag com `<` dentro de valor entre aspas deixaria de casar
    # e passaria SEM filtro.
    partes: list[str] = []
    i, n = 0, len(html)
    while i < n:
        inicio = html.find("<", i)
        if inicio < 0 or inicio + 1 >= n:
            partes.append(html[i:])
            break
        partes.append(html[i:inicio])
        if not html[inicio + 1].isalpha():
            partes.append("<")
            i = inicio + 1
            continue
        j, aspa = inicio + 1, ""
        while j < n:
            c = html[j]
            if aspa:
                if c == aspa:
                    aspa = ""
            elif c in "\"'":
                aspa = c
            elif c == ">":
                break
            j += 1
        if j >= n:
            # Tag que não fecha: o navegador trata o resto como dentro dela —
            # atributo, não conteúdo. Filtra o resto como tag e acaba.
            partes.append(limpar_tag(html[inicio:]))
            break
        partes.append(limpar_tag(html[inicio:j + 1]))
        i = j + 1
    return "".join(partes)

_FERRAMENTAS = [
    {
        "name": "documento_listar",
        "description": (
            "Lista os documentos da base de conhecimento, do mais recente para o "
            "mais antigo. **Comece por aqui** quando pedirem para editar, "
            "continuar ou consultar um documento: você não guarda memória da "
            "conversa de dias atrás, e é esta lista que liga 'aquele documento' "
            "a um id."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "busca": {
                    "type": "string",
                    "description": "Filtra por pedaço do título. Vazio traz todos.",
                    "maxLength": 120,
                },
                "limite": {"type": "integer", "minimum": 1, "maximum": 100},
            },
        },
    },
    {
        "name": "documento_ler",
        "description": (
            "O conteúdo completo de um documento, pelo id que veio do "
            "`documento_listar`. Leia antes de editar: editar sem ler substitui "
            "o que você não viu."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "Id do documento."}},
            "required": ["id"],
        },
    },
    {
        "name": "documento_criar",
        "description": (
            "Salva um documento novo em markdown na base de conhecimento, onde "
            "ele fica disponível depois que esta conversa acabar. Use quando "
            "pedirem um documento, relatório ou anotação para guardar — não para "
            "responder uma pergunta, que vai no chat mesmo."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "titulo": {"type": "string", "maxLength": 200},
                "conteudo": {"type": "string", "maxLength": 200_000},
                "agente": {
                    "type": "string",
                    "description": "Seu próprio id (ex.: `nina`). O gateway não informa.",
                    "maxLength": 60,
                },
                "solicitante": {
                    "type": "string",
                    "description": (
                        "O id da pessoa que pediu — o que vem depois de `hsos-` "
                        "na sua chave de sessão. É quem fica como dono do "
                        "documento. Sem pessoa do outro lado, omita."
                    ),
                },
            },
            "required": ["titulo", "conteudo", "agente"],
        },
    },
    {
        "name": "documento_editar",
        "description": (
            "Substitui o conteúdo de um documento existente. Só funciona nos "
            "documentos do espaço dos agentes — o resto da base você lê, mas não "
            "altera."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "conteudo": {"type": "string", "maxLength": 200_000},
                "titulo": {"type": "string", "maxLength": 200,
                           "description": "Opcional: só se o título mudar."},
                "agente": {"type": "string", "maxLength": 60},
            },
            "required": ["id", "conteudo", "agente"],
        },
    },
]


def _resposta(ident, resultado=None, erro=None):
    corpo = {"jsonrpc": "2.0", "id": ident}
    corpo["error" if erro else "result"] = erro or resultado
    return JSONResponse(corpo)


def _texto(msg: str, erro: bool = False):
    return {"content": [{"type": "text", "text": msg}], "isError": erro}


async def _um_administrador(conn) -> str | None:
    """Um administrador, para ser dono do que não tem dono natural."""
    return await conn.fetchval(
        "SELECT r.user_id::text FROM public.user_roles r "
        " WHERE r.role = 'administrador' ORDER BY r.user_id LIMIT 1"
    )


async def _espaco_dos_agentes(conn) -> str | None:
    """O id do espaço onde o agente escreve, criando-o na primeira vez.

    ⚠️ `wiki_spaces.created_by` é NOT NULL, então o espaço precisa de dono. Fica
    com um **administrador**: ele é um contêiner da instalação, não de quem por
    acaso pediu o primeiro documento.
    """
    espaco = await conn.fetchval(
        "SELECT id::text FROM public.wiki_spaces WHERE name = $1", _ESPACO_AGENTES
    )
    if espaco:
        return espaco
    admin = await _um_administrador(conn)
    if not admin:
        return None
    return await conn.fetchval(
        "INSERT INTO public.wiki_spaces (name, description, created_by) "
        "VALUES ($1, $2, $3::uuid) RETURNING id::text",
        _ESPACO_AGENTES,
        "Documentos escritos pelos agentes a pedido de alguém. "
        "Só aqui eles podem escrever; o resto da base eles apenas leem.",
        admin,
    )


async def _dono(conn, solicitante: str | None) -> str | None:
    """Valida o id da pessoa. Id inventado vira `None` em vez de erro.

    O documento é de quem pediu — decisão do Erick em 17/08/2026. Mas o id chega
    por parâmetro, e parâmetro pode vir errado: preso a uma pessoa que não
    existe, o documento ficaria órfão de um jeito difícil de notar. Sem dono é
    um estado honesto; com dono errado, não.
    """
    if not solicitante:
        return None
    try:
        return await conn.fetchval(
            "SELECT id::text FROM public.profiles WHERE id = $1::uuid", solicitante
        )
    except Exception:  # noqa: BLE001 — uuid malformado
        return None


@router.post("/wiki")
async def mcp_wiki(
    request: Request,
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Endpoint MCP da base de conhecimento. Mesmo transporte e segredo do alerta."""
    try:
        corpo = await request.json()
    except Exception:
        return _resposta(None, erro={"code": -32700, "message": "JSON inválido."})

    metodo, ident = corpo.get("method"), corpo.get("id")
    params = corpo.get("params") or {}

    # Notificação (sem `id`) não leva resposta — responder quebra o handshake.
    if ident is None:
        return JSONResponse({}, status_code=status.HTTP_202_ACCEPTED)

    if metodo == "initialize":
        return _resposta(ident, {
            "protocolVersion": _PROTOCOLO,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "hsos-documentos", "version": "1.0.0"},
        })

    if metodo == "tools/list":
        return _resposta(ident, {"tools": _FERRAMENTAS})

    if metodo != "tools/call":
        return _resposta(ident, erro={"code": -32601, "message": f"Método desconhecido: {metodo}"})

    nome = params.get("name")
    args = params.get("arguments") or {}

    async with sessao(role="service_role") as conn:
        if nome == "documento_listar":
            busca = str(args.get("busca") or "").strip()
            limite = min(int(args.get("limite") or 20), 100)
            linhas = await conn.fetch(
                """
                SELECT d.id::text AS id, d.title, s.name AS espaco,
                       to_char(d.updated_at AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') AS atualizado,
                       length(d.content) AS tamanho
                  FROM public.wiki_documents d
                  LEFT JOIN public.wiki_spaces s ON s.id = d.space_id
                 WHERE ($1 = '' OR d.title ILIKE '%' || $1 || '%')
                 ORDER BY d.updated_at DESC LIMIT $2
                """,
                busca, limite,
            )
            if not linhas:
                return _resposta(ident, _texto(
                    "Nenhum documento" + (f' com "{busca}" no título.' if busca else " na base ainda.")
                ))
            linhas_txt = "\n".join(
                f"· {l['title']} — id `{l['id']}` · {l['espaco'] or 'sem espaço'} · "
                f"{l['tamanho']} caracteres · atualizado em {l['atualizado']}"
                for l in linhas
            )
            return _resposta(ident, _texto(f"{len(linhas)} documento(s):\n{linhas_txt}"))

        if nome == "documento_ler":
            try:
                linha = await conn.fetchrow(
                    "SELECT title, content FROM public.wiki_documents WHERE id = $1::uuid",
                    str(args.get("id") or ""),
                )
            except Exception:  # noqa: BLE001
                linha = None
            if linha is None:
                return _resposta(ident, _texto(
                    "Documento não encontrado. Use `documento_listar` para pegar o id certo.",
                    erro=True,
                ))
            return _resposta(ident, _texto(f"# {linha['title']}\n\n{linha['content']}"))

        # ⚠️ **Fora dos ramos de propósito: as DUAS ferramentas de escrita usam.**
        # Em `f4b9502` esta linha ficou dentro do ramo do `documento_criar` e o
        # `documento_editar` passou a referenciá-la — `UnboundLocalError`, que
        # o FastAPI transforma em 500 sem corpo. Resultado: o `documento_editar`
        # NUNCA funcionou desde aquele commit, e o agente só descobria ao tentar.
        # Encontrado em 20/08/2026 quando o `atlas` reportou "Internal Server
        # Error" ao corrigir dois erros de digitação num briefing.
        agente = str(args.get("agente") or "").strip() or "desconhecido"

        if nome == "documento_criar":
            titulo = str(args.get("titulo") or "").strip()
            conteudo = _para_html(str(args.get("conteudo") or "").strip())
            if not titulo or not conteudo:
                return _resposta(ident, _texto(
                    "Faltou `titulo` ou `conteudo`.", erro=True))

            espaco = await _espaco_dos_agentes(conn)
            if not espaco:
                return _resposta(ident, _texto(
                    "Não há administrador cadastrado para ser dono do espaço dos "
                    "documentos. Avise o TI.", erro=True))

            # ⚠️ `wiki_documents.created_by` é NOT NULL: documento sem dono não
            # existe. O dono é quem pediu; sem pessoa do outro lado (cron, teste,
            # disparo automático) cai no administrador — e a resposta DIZ isso,
            # senão o documento apareceria como se o admin o tivesse pedido.
            dono = await _dono(conn, args.get("solicitante"))
            recaiu = dono is None
            if recaiu:
                dono = await _um_administrador(conn)
            if not dono:
                return _resposta(ident, _texto(
                    "Sem `solicitante` válido e sem administrador cadastrado — "
                    "não há a quem atribuir o documento.", erro=True))

            novo = await conn.fetchval(
                """
                INSERT INTO public.wiki_documents
                       (space_id, title, content, created_by, updated_by, agent_id)
                VALUES ($1::uuid, $2, $3, $4::uuid, $4::uuid, $5)
                RETURNING id::text
                """,
                espaco, titulo, conteudo, dono, agente or None,
            )
            logger.info("Documento %s criado por %s para %s%s", novo, agente, dono,
                        " (recaiu no admin)" if recaiu else "")
            aviso = ("" if not recaiu else
                     " Como não veio `solicitante`, ficou no nome do administrador.")
            return _resposta(ident, _texto(
                f'Documento "{titulo}" salvo na base de conhecimento (id `{novo}`). '
                "Ele fica disponível depois desta conversa — para retomá-lo, use "
                f"`documento_listar`.{aviso}"
            ))

        if nome == "documento_editar":
            conteudo = _para_html(str(args.get("conteudo") or "").strip())
            titulo = str(args.get("titulo") or "").strip()
            if not conteudo:
                return _resposta(ident, _texto("Faltou `conteudo`.", erro=True))

            espaco = await _espaco_dos_agentes(conn)
            try:
                atual = await conn.fetchrow(
                    "SELECT title, space_id::text AS space_id FROM public.wiki_documents "
                    " WHERE id = $1::uuid",
                    str(args.get("id") or ""),
                )
            except Exception:  # noqa: BLE001
                atual = None
            if atual is None:
                return _resposta(ident, _texto(
                    "Documento não encontrado. Use `documento_listar`.", erro=True))
            # ⚠️ A trava que impede o agente de reescrever a régua que o governa.
            if atual["space_id"] != espaco:
                return _resposta(ident, _texto(
                    f'"{atual["title"]}" está fora do espaço dos agentes: você pode '
                    "lê-lo, mas não alterá-lo. Documento de regra é editado por "
                    "pessoa, pela tela.",
                    erro=True,
                ))
            await conn.execute(
                "UPDATE public.wiki_documents SET agent_id = $4, content = $2, "
                "       title = COALESCE(NULLIF($3,''), title), updated_at = now() "
                " WHERE id = $1::uuid",
                str(args.get("id")), conteudo, titulo, agente or None,
            )
            return _resposta(ident, _texto(
                f'Documento "{titulo or atual["title"]}" atualizado.'))

    return _resposta(ident, erro={"code": -32601, "message": f"Ferramenta desconhecida: {nome}"})
