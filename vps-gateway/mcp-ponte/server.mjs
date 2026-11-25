#!/usr/bin/env node
// mcp-ponte — os MCP HTTP `hsos-*` atendidos no loopback da VPS do gateway.
// Ver docs/superpowers/specs/2026-11-25-mcp-ponte-design.md.
//
// ⚠️ O OpenClaw reconecta TODOS os servidores de `mcp.servers` a cada execução
// (o runtime de execução embutida é descartado no fim) — 78 HTTPS até a API
// pública, ~20 s por mensagem, só para ouvir `initialize` e `tools/list`, que
// não mudam entre execuções. Aqui os dois saem do cache; `tools/call` e o resto
// vão para a API, que continua conferindo token e assinatura em toda chamada.
//
// Sem dependência: só `node:`. Escuta SÓ no loopback — o `X-Bridge-Token` chega
// em cada pedido, vindo do `openclaw.json`, e quem alcança a porta já é root.

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const TTL_MS = Number(process.env.MCP_PONTE_TTL_MS || 5 * 60_000);
const LIMITE_CORPO = 8 * 1024 * 1024; // anexo em base64 passa por aqui no tools/call
const METODOS_EM_CACHE = new Set(["initialize", "tools/list"]);
// Só estes cabeçalhos vão à API: o resto (host, connection, content-length) é
// do salto local e quebraria o pedido lá.
const CABECALHOS_REPASSADOS = ["content-type", "accept", "x-bridge-token", "authorization",
    "mcp-session-id", "mcp-protocol-version", "last-event-id"];

export function criarPonte({ origem, buscar, agora = () => Date.now(), registrar = () => {} }) {
    const cache = new Map();      // chave → { resultado, em }
    const emVoo = new Map();      // chave → Promise do resultado

    function chaveDe(caminho, cabecalhos, metodo) {
        const auth = (cabecalhos["x-bridge-token"] || "") + "|" + (cabecalhos.authorization || "");
        const h = crypto.createHash("sha256").update(auth).digest("hex").slice(0, 16);
        return `${metodo}|${caminho}|${h}`;
    }

    async function buscarResultado(caminho, cabecalhos, pedido) {
        const r = await buscar(origem + caminho, cabecalhos, JSON.stringify(pedido));
        if (r.status !== 200 || !/json/i.test(r.cabecalhos["content-type"] || "")) {
            const e = new Error(`API respondeu ${r.status}`);
            e.resposta = r;
            throw e;
        }
        const corpo = JSON.parse(r.corpo);
        if (corpo.error || corpo.result === undefined) {
            const e = new Error("API respondeu erro JSON-RPC");
            e.resposta = r;
            throw e;
        }
        return corpo.result;
    }

    function buscarUmaVez(chave, caminho, cabecalhos, pedido) {
        if (!emVoo.has(chave)) {
            emVoo.set(chave, buscarResultado(caminho, cabecalhos, pedido)
                .then((resultado) => { cache.set(chave, { resultado, em: agora() }); return resultado; })
                .finally(() => emVoo.delete(chave)));
        }
        return emVoo.get(chave);
    }

    async function doCache(caminho, cabecalhos, pedido) {
        const chave = chaveDe(caminho, cabecalhos, pedido.method);
        const guardado = cache.get(chave);
        if (guardado) {
            // ⚠️ Vencido sai NA HORA e a busca vai em segundo plano. Com espera,
            // a 1ª mensagem depois de 5 min parados pagava as 78 buscas (9,3 s
            // medidos em 25/11) — e quase toda mensagem chega depois de 5 min.
            // O preço: ferramenta nova aparece na 2ª execução, não na 1ª.
            if (agora() - guardado.em >= TTL_MS) {
                buscarUmaVez(chave, caminho, cabecalhos, pedido).catch((e) =>
                    registrar(`não atualizei ${pedido.method} de ${caminho}: ${e.message}`));
            }
            return guardado.resultado;
        }
        return buscarUmaVez(chave, caminho, cabecalhos, pedido);
    }

    async function atender({ caminho, cabecalhos, corpo }) {
        let pedido = null;
        try { pedido = JSON.parse(corpo); } catch { /* vai para a API, que responde o erro */ }

        if (pedido && typeof pedido === "object" && !Array.isArray(pedido)) {
            if (pedido.id === undefined || pedido.id === null) {
                // Notificação: o backend devolve 202 sem corpo; não há o que repassar.
                if (typeof pedido.method === "string" && pedido.method.startsWith("notifications/")) {
                    return { status: 202, cabecalhos: { "content-type": "application/json" }, corpo: "{}" };
                }
            } else if (METODOS_EM_CACHE.has(pedido.method)) {
                try {
                    const resultado = await doCache(caminho, cabecalhos, pedido);
                    return {
                        status: 200, cabecalhos: { "content-type": "application/json" },
                        corpo: JSON.stringify({ jsonrpc: "2.0", id: pedido.id, result: resultado }),
                    };
                } catch (e) {
                    if (e.resposta) return e.resposta;
                    throw e;
                }
            }
        }
        return buscar(origem + caminho, cabecalhos, corpo);
    }

    return { atender, esquecer: () => { const n = cache.size; cache.clear(); return n; }, tamanho: () => cache.size };
}

function buscarHttps(agente) {
    return (url, cabecalhos, corpo) => new Promise((resolver, rejeitar) => {
        const h = {};
        for (const k of CABECALHOS_REPASSADOS) if (cabecalhos[k]) h[k] = cabecalhos[k];
        h["content-length"] = Buffer.byteLength(corpo);
        const req = https.request(url, { method: "POST", headers: h, agent: agente, timeout: 120_000 }, (res) => {
            const partes = [];
            res.on("data", (p) => partes.push(p));
            res.on("end", () => resolver({
                status: res.statusCode,
                cabecalhos: Object.fromEntries(Object.entries(res.headers)
                    .filter(([k]) => ["content-type", "mcp-session-id"].includes(k))),
                corpo: Buffer.concat(partes).toString("utf8"),
            }));
            res.on("error", rejeitar);
        });
        req.on("timeout", () => req.destroy(new Error("tempo esgotado falando com a API")));
        req.on("error", rejeitar);
        req.end(corpo);
    });
}

function iniciar() {
    const HOST = process.env.MCP_PONTE_HOST || "127.0.0.1";
    const PORTA = Number(process.env.MCP_PONTE_PORTA || 18791);
    const ORIGEM = process.env.MCP_PONTE_ORIGEM || "https://hsosapi.healthsafetytech.com";
    // Conexão persistente: o TLS até a API custa ~0,25 s, e era pago a cada um
    // dos 78 servidores de cada execução.
    const agente = new https.Agent({ keepAlive: true, maxSockets: 32 });
    const ponte = criarPonte({ origem: ORIGEM, buscar: buscarHttps(agente),
        registrar: (m) => console.warn(m) });

    http.createServer((req, res) => {
        const responder = (s, corpo, cab = { "content-type": "application/json" }) => {
            res.writeHead(s, cab); res.end(corpo);
        };
        if (req.method === "GET" && req.url === "/saude") {
            return responder(200, JSON.stringify({ ok: true, cache: ponte.tamanho() }));
        }
        if (req.method === "POST" && req.url === "/esquecer") {
            return responder(200, JSON.stringify({ esquecidos: ponte.esquecer() }));
        }
        if (req.method !== "POST" || !req.url.startsWith("/mcp/")) {
            return responder(404, JSON.stringify({ detail: "Not Found" }));
        }
        const partes = [];
        let tamanho = 0;
        req.on("data", (p) => {
            tamanho += p.length;
            if (tamanho > LIMITE_CORPO) { req.destroy(); return; }
            partes.push(p);
        });
        req.on("end", async () => {
            try {
                const r = await ponte.atender({
                    caminho: req.url, cabecalhos: req.headers,
                    corpo: Buffer.concat(partes).toString("utf8"),
                });
                responder(r.status, r.corpo, r.cabecalhos);
            } catch (e) {
                console.warn(`falha repassando ${req.url.replace(/\/[0-9a-f]{32,}$/, "/<assinatura>")}: ${e.message}`);
                responder(502, JSON.stringify({ jsonrpc: "2.0", id: null,
                    error: { code: -32603, message: "mcp-ponte não alcançou a API do HS.OS." } }));
            }
        });
    }).listen(PORTA, HOST, () => console.log(`mcp-ponte em http://${HOST}:${PORTA} → ${ORIGEM}`));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) iniciar();
