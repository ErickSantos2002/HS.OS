// node --test vps-gateway/mcp-ponte/
//
// O que custaria errar aqui: o OpenClaw reconecta os 78 servidores a cada
// execução; se o cache misturar bots, a sessão de um recebe a lista de
// ferramentas de outro — e se não cachear, voltam os 20 s por mensagem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarPonte, TTL_MS } from "./server.mjs";

function api(respostas = {}) {
    const chamadas = [];
    const buscar = async (url, cabecalhos, corpo) => {
        chamadas.push({ url, corpo: JSON.parse(corpo) });
        const p = JSON.parse(corpo);
        if (respostas.falhar) throw new Error("rede fora");
        const result = p.method === "tools/list" ? { tools: [{ name: `de:${url}` }] } : { ok: p.method };
        return { status: 200, cabecalhos: { "content-type": "application/json" },
            corpo: JSON.stringify({ jsonrpc: "2.0", id: p.id, result }) };
    };
    return { buscar, chamadas };
}

const CAB = { "x-bridge-token": "t" };
const pedir = (ponte, caminho, method, id = 1, cab = CAB) =>
    ponte.atender({ caminho, cabecalhos: cab, corpo: JSON.stringify({ jsonrpc: "2.0", id, method, params: {} }) });

test("tools/list sai do cache na 2ª vez, com o id do pedido novo", async () => {
    const a = api();
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar });
    await pedir(ponte, "/mcp/anexos/x/sig", "tools/list", 1);
    const r = await pedir(ponte, "/mcp/anexos/x/sig", "tools/list", 99);
    assert.equal(a.chamadas.length, 1);
    assert.equal(JSON.parse(r.corpo).id, 99);
});

test("bots diferentes não dividem cache", async () => {
    const a = api();
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar });
    const r1 = await pedir(ponte, "/mcp/anexos/ana-bot/s1", "tools/list");
    const r2 = await pedir(ponte, "/mcp/anexos/rui-bot/s2", "tools/list");
    assert.notDeepEqual(JSON.parse(r1.corpo).result, JSON.parse(r2.corpo).result);
    assert.equal(a.chamadas.length, 2);
});

test("token diferente não aproveita o cache de outro", async () => {
    const a = api();
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar });
    await pedir(ponte, "/mcp/x/s", "tools/list", 1, { "x-bridge-token": "certo" });
    await pedir(ponte, "/mcp/x/s", "tools/list", 1, { "x-bridge-token": "outro" });
    assert.equal(a.chamadas.length, 2);
});

test("tools/call vai sempre para a API", async () => {
    const a = api();
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar });
    await pedir(ponte, "/mcp/x/s", "tools/call");
    await pedir(ponte, "/mcp/x/s", "tools/call");
    assert.equal(a.chamadas.length, 2);
});

test("pedidos simultâneos esperam a mesma busca", async () => {
    const a = api();
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar });
    await Promise.all(Array.from({ length: 20 }, (_, i) => pedir(ponte, "/mcp/x/s", "tools/list", i)));
    assert.equal(a.chamadas.length, 1);
});

test("vencido é buscado de novo; API fora serve o vencido", async () => {
    let t = 0;
    const respostas = {};
    const a = api(respostas);
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar, agora: () => t });
    await pedir(ponte, "/mcp/x/s", "tools/list");
    t = TTL_MS + 1;
    respostas.falhar = true;
    const r = await pedir(ponte, "/mcp/x/s", "tools/list");
    assert.equal(r.status, 200);
    assert.equal(a.chamadas.length, 2);
});

test("sem cache e API fora, o erro sobe", async () => {
    const ponte = criarPonte({ origem: "https://api", buscar: api({ falhar: true }).buscar });
    await assert.rejects(pedir(ponte, "/mcp/x/s", "tools/list"));
});

test("resposta de erro da API não entra no cache", async () => {
    let n = 0;
    const buscar = async (url, cab, corpo) => {
        n++;
        const p = JSON.parse(corpo);
        return { status: 404, cabecalhos: { "content-type": "application/json" }, corpo: '{"detail":"Not Found"}', id: p.id };
    };
    const ponte = criarPonte({ origem: "https://api", buscar });
    const r = await pedir(ponte, "/mcp/x/assinatura-errada", "tools/list");
    await pedir(ponte, "/mcp/x/assinatura-errada", "tools/list");
    assert.equal(r.status, 404);
    assert.equal(n, 2);
});

test("notificação responde 202 sem ir à API", async () => {
    const a = api();
    const ponte = criarPonte({ origem: "https://api", buscar: a.buscar });
    const r = await ponte.atender({ caminho: "/mcp/x/s", cabecalhos: CAB,
        corpo: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(r.status, 202);
    assert.equal(a.chamadas.length, 0);
});
