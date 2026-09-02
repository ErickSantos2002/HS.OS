/**
 * Quem responde quando alguém escreve num canal.
 *
 * ⚠️ **Este teste existe porque mencionar um agente num canal nunca funcionou
 * em produção, e a causa não estava aqui — estava no catálogo vazio.**
 * `getRespondingAgents` filtra os membros por `isOfficialAgentId`, que consulta
 * o catálogo carregado de `/agents`. O `fetchCatalog` guardava só quem viesse
 * com `isOfficial`, e `agent_profiles.is_official` é coluna herdada do schema
 * Supabase que **nada no backend jamais escreve**: `false` para os cinco
 * agentes da casa. Catálogo vazio → nenhum membro "oficial" → ninguém
 * responde, e a rota `/channels/{id}/agentes/{id}/responder` nunca era chamada.
 *
 * Medido em 02/09/2026: `GET /agents` devolveu os cinco agentes, todos com
 * `isOfficial: false`.
 *
 * O que se protege aqui é a regra de quem responde, com o catálogo populado —
 * que é o estado real depois da correção em `use-agent-catalog.ts`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { setAgentCatalog } from "@/lib/agent-catalog";
import { extractMentionedAgents, getRespondingAgents } from "@/lib/channel-agents";

const CATALOGO = [
  { id: "flow", name: "Flow", emoji: null, color: null, isLeader: false, sortOrder: 1 },
  { id: "nina", name: "Nina", emoji: null, color: null, isLeader: true, sortOrder: 0 },
];

describe("quem responde num canal", () => {
  beforeEach(() => setAgentCatalog(CATALOGO));

  it("responde ao agente mencionado pelo id", () => {
    expect(getRespondingAgents("@flow me ajuda", "private", ["flow"])).toEqual(["flow"]);
  });

  it("responde ao agente mencionado pelo nome", () => {
    expect(getRespondingAgents("@Flow me ajuda", "private", ["flow"])).toEqual(["flow"]);
  });

  it("aceita o id com o prefixo do gateway, que é como o membro é gravado", () => {
    // `channel_members.user_id` guarda tanto uuid de pessoa quanto agent_id, e
    // o id pode vir como `openclaw:flow`.
    expect(getRespondingAgents("@flow oi", "private", ["openclaw:flow"])).toEqual(["flow"]);
  });

  it("não aciona ninguém sem menção, num canal de grupo", () => {
    expect(getRespondingAgents("bom dia, gente", "private", ["flow"])).toEqual([]);
  });

  it("não aciona agente que não é membro do canal", () => {
    expect(getRespondingAgents("@nina oi", "private", ["flow"])).toEqual([]);
  });

  it("na DM com agente, responde sem precisar de menção", () => {
    expect(getRespondingAgents("oi", "dm", ["flow"])).toEqual(["flow"]);
  });

  it("com o catálogo VAZIO ninguém responde — era o estado de produção", () => {
    setAgentCatalog([]);
    expect(getRespondingAgents("@flow me ajuda", "private", ["flow"])).toEqual([]);
  });

  it("extractMentionedAgents não inventa menção onde não há", () => {
    expect(extractMentionedAgents("email flow@empresa.com", ["flow"])).toEqual([]);
  });
});
