#!/usr/bin/env node
// Para cada entrada `hsos-*` do openclaw.json: `initialize` e `tools/list`
// pela ponte == direto pela API. Nunca imprime URL nem token, só o nome.
// Sai com 1 se qualquer um divergir.
//
//   ssh root@2.24.85.122 'node /opt/mcp-ponte/comparar.mjs'
import fs from "node:fs";

const PONTE = process.env.MCP_PONTE || "http://127.0.0.1:18791";
const cfg = JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG || "/root/.openclaw/openclaw.json", "utf8"));
const servidores = Object.entries(cfg.mcp.servers).filter(([, s]) => /\/mcp\//.test(s.url || "") && !/127\.0\.0\.1:18790/.test(s.url));

async function rpc(url, headers, method, id) {
    const r = await fetch(url, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params: method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "comparar", version: "0" } } : {} }),
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(headers || {}) } });
    return { status: r.status, corpo: await r.json().catch(() => null) };
}

let ruins = 0;
for (const [nome, s] of servidores) {
    const caminho = new URL(s.url).pathname;
    const direto = s.url.includes("127.0.0.1:18791") ? new URL(caminho, "https://hsosapi.healthsafetytech.com").href : s.url;
    for (const metodo of ["initialize", "tools/list"]) {
        const [a, b] = await Promise.all([rpc(direto, s.headers, metodo, 7), rpc(PONTE + caminho, s.headers, metodo, 7)]);
        const igual = a.status === b.status && JSON.stringify(a.corpo) === JSON.stringify(b.corpo);
        if (!igual) { ruins++; console.log(`DIFERENTE ${nome} ${metodo} (${a.status} × ${b.status})`); }
    }
}
console.log(ruins ? `❌ ${ruins} divergência(s) em ${servidores.length} servidores` : `✅ ${servidores.length} servidores iguais pela ponte e pela API`);
process.exit(ruins ? 1 : 0);
