#!/usr/bin/env node
// banco-mcp — o MCP de banco persistente da VPS do gateway (PK-47).
//
// Substitui os 9 `npx -y @modelcontextprotocol/server-postgres <url>` que o
// OpenClaw subia POR SESSÃO. Ver
// docs/superpowers/specs/2026-11-24-banco-mcp-persistente-design.md.
//
// ⚠️ **A saída tem que ser byte a byte a do server-postgres 0.6.2.** Mesmo
// `pg` (8.23.0, fixado no package.json), mesmo corpo de tool, mesma
// serialização. As réguas das skills (`faturamento`) leem esse texto; um
// `numeric` que mudasse de cara mudaria número de briefing. O `comparar.mjs`
// confere isso contra o servidor antigo — rode-o antes de trocar versão.
//
// A URL do banco chega no cabeçalho `X-Banco-Url` de cada requisição — a
// entrada do `mcp.servers` a carrega. O serviço não guarda credencial nenhuma
// e não lê nada do disco. Por isso ele SÓ escuta no loopback: quem alcança a
// porta já é root na VPS e leria o `openclaw.json` de qualquer jeito.

import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pg from "pg";

const HOST = process.env.BANCO_MCP_HOST || "127.0.0.1";
const PORTA = Number(process.env.BANCO_MCP_PORTA || 18790);
const LIMITE_CORPO = 1024 * 1024; // 1 MB de JSON-RPC é muito SQL

// Um pool por URL, ociosa fecha em 10 s (padrão do `pg`). O teto é 20, não o
// padrão de 10: no desenho antigo CADA sessão tinha um pool de 10 só dela, e
// um teto compartilhado de 10 criaria fila onde antes não havia. O pool só abre
// o que usa, então o teto maior não abre conexão a mais.
const MAX_CONEXOES = 20;
const pools = new Map();

function rotulo(url) {
    try {
        const u = new URL(url);
        return `${u.hostname}:${u.port || 5432}${u.pathname}`;
    } catch {
        return "url-invalida";
    }
}

function poolDe(url) {
    let pool = pools.get(url);
    if (!pool) {
        pool = new pg.Pool({ connectionString: url, max: MAX_CONEXOES });
        // ⚠️ Sem isto, uma conexão ociosa que o banco derruba levanta `error`
        // no pool e MATA o processo. No servidor antigo era um processo por
        // sessão e ninguém notava; aqui derrubaria os 9 bancos de todo mundo.
        pool.on("error", (e) => console.warn(`[${rotulo(url)}] conexão ociosa caiu: ${e.message}`));
        pools.set(url, pool);
    }
    return pool;
}

// ⚠️ Nome, descrição e schema iguais aos do server-postgres 0.6.2. O agente vê
// a descrição; mudá-la é mudar o prompt de cinco agentes.
const TOOL_QUERY = {
    name: "query",
    description: "Run a read-only SQL query",
    inputSchema: {
        type: "object",
        properties: {
            sql: { type: "string" },
        },
    },
};

async function executar(url, sql) {
    const client = await poolDe(url).connect();
    const inicio = Date.now();
    try {
        await client.query("BEGIN TRANSACTION READ ONLY");
        // ⚠️ `extended` é a ÚNICA diferença deliberada para o servidor antigo:
        // o protocolo estendido recusa vários comandos numa string. Com o
        // simples, `COMMIT; <escrita>` saía da transação somente-leitura — o
        // furo conhecido do server-postgres. Uso legítimo não perde nada: com
        // vários comandos o antigo devolvia `rows` indefinido.
        const result = await client.query(
            typeof sql === "string" ? { text: sql, queryMode: "extended" } : sql,
        );
        console.log(`[${rotulo(url)}] ok ${Date.now() - inicio}ms ${result.rowCount ?? 0} linhas`);
        return {
            content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
            isError: false,
        };
    } catch (error) {
        console.log(`[${rotulo(url)}] erro ${Date.now() - inicio}ms: ${error.message}`);
        throw error;
    } finally {
        // O antigo não esperava o ROLLBACK. Aqui o pool é compartilhado entre
        // sessões, então a conexão só volta limpa.
        await client.query("ROLLBACK").catch((e) => console.warn(`[${rotulo(url)}] ROLLBACK falhou: ${e.message}`));
        client.release();
    }
}

function servidorPara(url) {
    // Sem `resources`: o antigo anunciava o schema como recurso, mas o
    // `toolFilter.include: ["query"]` já o escondia. Não anunciar poupa duas
    // listagens por sessão.
    const server = new Server(
        { name: "example-servers/postgres", version: "0.1.0" },
        { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [TOOL_QUERY] }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === "query") {
            return executar(url, request.params.arguments?.sql);
        }
        throw new Error(`Unknown tool: ${request.params.name}`);
    });
    return server;
}

function lerCorpo(req) {
    return new Promise((resolve, reject) => {
        let tamanho = 0;
        const partes = [];
        req.on("data", (p) => {
            tamanho += p.length;
            if (tamanho > LIMITE_CORPO) {
                reject(Object.assign(new Error("corpo grande demais"), { status: 413 }));
                req.destroy();
                return;
            }
            partes.push(p);
        });
        req.on("end", () => resolve(Buffer.concat(partes).toString("utf8")));
        req.on("error", reject);
    });
}

function responderErro(res, status, mensagem) {
    if (res.headersSent) return;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: mensagem }, id: null }));
}

const http_server = http.createServer(async (req, res) => {
    const caminho = (req.url || "").split("?")[0];

    if (req.method === "GET" && caminho === "/saude") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, bancos: pools.size }));
        return;
    }
    if (caminho !== "/mcp") return responderErro(res, 404, "Caminho desconhecido.");
    // Sem estado: não há sessão para abrir com GET (SSE) nem fechar com DELETE.
    if (req.method !== "POST") return responderErro(res, 405, "Só POST.");

    const url = req.headers["x-banco-url"];
    if (typeof url !== "string" || !/^postgres(ql)?:\/\//.test(url)) {
        return responderErro(res, 400, "Falta o cabeçalho X-Banco-Url com uma URL postgres://.");
    }

    let corpo;
    try {
        corpo = JSON.parse(await lerCorpo(req));
    } catch (e) {
        return responderErro(res, e.status || 400, e.status ? e.message : "JSON inválido.");
    }

    // Modo sem estado do SDK: um Server e um transporte por requisição. É
    // barato (não toca o banco) e dispensa guardar sessão entre chamadas — o
    // OpenClaw faz initialize, tools/list e tools/call como POSTs avulsos.
    const server = servidorPara(url);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
    });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, corpo);
    } catch (e) {
        console.error(`[${rotulo(url)}] falha no transporte: ${e.message}`);
        responderErro(res, 500, "Falha interna no banco-mcp.");
    }
});

http_server.listen(PORTA, HOST, () => console.log(`banco-mcp ouvindo em ${HOST}:${PORTA}`));

async function encerrar(sinal) {
    console.log(`banco-mcp recebeu ${sinal}, encerrando`);
    http_server.close();
    await Promise.allSettled([...pools.values()].map((p) => p.end()));
    process.exit(0);
}
process.on("SIGTERM", () => encerrar("SIGTERM"));
process.on("SIGINT", () => encerrar("SIGINT"));
