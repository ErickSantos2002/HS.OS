#!/usr/bin/env node
// Compara o banco-mcp com o server-postgres antigo, consulta por consulta.
//
//   node comparar.mjs --antigo <dist/index.js do server-postgres> \
//        (--url postgres://… | --config /root/.openclaw/openclaw.json) [--novo http://127.0.0.1:18790/mcp]
//
// Com `--config`, lê as URLs das entradas `banco-*` (formato antigo, `args`, ou
// novo, cabeçalho `X-Banco-Url`) ali mesmo — a credencial não sai da máquina.
//
// ⚠️ Nunca imprime linha de tabela: só OK/DIFERENTE e o tamanho. Na VPS a
// saída vai para o terminal de quem roda, e os bancos têm dado de cliente.
//
// Sai com código 1 se qualquer comparação divergir.

import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function arg(nome) {
    const i = process.argv.indexOf(`--${nome}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const ANTIGO = arg("antigo");
const NOVO = arg("novo") || "http://127.0.0.1:18790/mcp";
if (!ANTIGO) {
    console.error("Falta --antigo <caminho do dist/index.js do server-postgres>");
    process.exit(2);
}

function alvos() {
    if (arg("url")) return [["url", arg("url")]];
    const c = JSON.parse(fs.readFileSync(arg("config"), "utf8"));
    return Object.entries(c.mcp.servers)
        .filter(([nome]) => nome.startsWith("banco-"))
        .map(([nome, s]) => [nome, s.headers?.["X-Banco-Url"] ?? s.args?.[2]]);
}

// Tipos que o driver converte — é aqui que uma troca de driver ou de fuso
// apareceria. `now()` fica de fora de propósito: muda entre as duas chamadas.
const FIXAS = [
    ["tipos", `SELECT 1.50::numeric AS n, 12345678901234::bigint AS b, 7::int AS i,
        3.25::float8 AS f, '2026-11-24'::date AS d,
        '2026-11-24 13:45:10.123'::timestamp AS ts,
        '2026-11-24 13:45:10.123-03'::timestamptz AS tz,
        '{"a":1,"b":[1,2]}'::jsonb AS j, NULL AS nulo, true AS v,
        'çãé'::text AS t, '{1,2}'::int[] AS arr, interval '1 day 2 hours' AS iv,
        'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid AS u, 1e-7::numeric AS pequeno`],
    ["vazio", "SELECT 1 WHERE false"],
    ["catalogo", "SELECT table_schema, table_name FROM information_schema.tables ORDER BY 1, 2 LIMIT 20"],
    ["erro-sintaxe", "SELEC 1"],
    ["escrita-recusada", "CREATE TABLE banco_mcp_teste (x int)"],
    ["tabela-inexistente", "SELECT * FROM nao_existe_banco_mcp"],
];

// Só no novo: tem que recusar. É o furo que o `queryMode: extended` fecha.
const SO_NOVO_RECUSA = ["multi-comando", "COMMIT; SELECT 1"];

async function chamar(cliente, sql) {
    try {
        const r = await cliente.callTool({ name: "query", arguments: { sql } });
        return { ok: true, isError: r.isError, texto: r.content?.[0]?.text };
    } catch (e) {
        return { ok: false, code: e.code, mensagem: e.message };
    }
}

function igual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function resumo(r) {
    return r.ok ? `${r.texto?.length ?? 0} chars` : `erro ${r.code}: ${r.mensagem}`;
}

let divergencias = 0;

for (const [nome, url] of alvos()) {
    if (!url) {
        console.log(`${nome}: sem URL, pulado`);
        continue;
    }
    const antigo = new Client({ name: "comparar", version: "1" });
    // ⚠️ `env` inteiro, não o padrão do SDK: o padrão NÃO repassa `TZ`, e o
    // `pg` converte `date`/`timestamp` no fuso do processo. Sem isto o antigo
    // roda no fuso da máquina e o novo no do serviço, e a comparação acusa
    // diferença que é do comparador — foi o primeiro resultado, em 24/11/2026.
    await antigo.connect(new StdioClientTransport({
        command: process.execPath, args: [ANTIGO, url], stderr: "ignore", env: { ...process.env },
    }));
    const novo = new Client({ name: "comparar", version: "1" });
    await novo.connect(new StreamableHTTPClientTransport(new URL(NOVO), {
        requestInit: { headers: { "X-Banco-Url": url } },
    }));

    const ferrA = (await antigo.listTools()).tools;
    const ferrN = (await novo.listTools()).tools;
    const ok = igual(ferrA, ferrN);
    if (!ok) divergencias++;
    console.log(`${nome} · tools/list: ${ok ? "OK" : "DIFERENTE"}`);
    if (!ok) console.log("   antigo:", JSON.stringify(ferrA), "\n   novo:  ", JSON.stringify(ferrN));

    // Tabelas reais com os tipos que importam, até 4. O texto não é impresso.
    const lista = await chamar(novo, `SELECT DISTINCT c.table_schema, c.table_name
        FROM information_schema.columns c JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND c.data_type IN ('numeric', 'date', 'timestamp without time zone', 'timestamp with time zone', 'jsonb', 'json')
        ORDER BY 1, 2 LIMIT 4`);
    const tabelas = lista.ok ? JSON.parse(lista.texto) : [];
    const reais = tabelas.map((t) => [
        `tabela ${t.table_schema}.${t.table_name}`,
        `SELECT * FROM "${t.table_schema}"."${t.table_name}" LIMIT 5`,
    ]);

    for (const [rotulo, sql] of [...FIXAS, ...reais]) {
        const a = await chamar(antigo, sql);
        const n = await chamar(novo, sql);
        const mesmo = igual(a, n);
        if (!mesmo) divergencias++;
        console.log(`${nome} · ${rotulo}: ${mesmo ? "OK" : "DIFERENTE"} (${resumo(n)})`);
        if (!mesmo) console.log(`   antigo: ${resumo(a)}\n   novo:   ${resumo(n)}`);
    }

    const [rot, sql] = SO_NOVO_RECUSA;
    const m = await chamar(novo, sql);
    const recusou = !m.ok;
    if (!recusou) divergencias++;
    console.log(`${nome} · ${rot}: ${recusou ? "RECUSADO (certo)" : "ACEITO (ERRADO)"} (${resumo(m)})`);

    await antigo.close();
    await novo.close();
}

console.log(divergencias ? `\n${divergencias} divergência(s).` : "\nTudo idêntico.");
process.exit(divergencias ? 1 : 0);
