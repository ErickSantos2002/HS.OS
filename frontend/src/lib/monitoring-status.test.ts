/**
 * A tela `/monitoring` dizia "Gateway offline — agentes indisponíveis" e
 * "SUPER AGENTES ONLINE 0/8" com o gateway comprovadamente no ar (medido em
 * produção, 02/09/2026: `GET /gateway/status` respondia `conectado: true`, e
 * `agent_stats` tinha 5 linhas frescas). A causa era a mesma nos dois lugares:
 * `app/coletor_metricas.py` grava `status: "ok"` tanto em `gateway_health`
 * quanto em `agent_stats` (ver `docs/CONFERENCIA-2026-09-01.md`), e a tela
 * comparava com `"online"` — valor que o coletor nunca escreve. Nenhum
 * agente, nem o próprio gateway, jamais contava como no ar.
 *
 * `statusIndicaOnline` é a leitura corrigida, usada tanto para o aviso do
 * gateway (`use-monitoring-data.ts`) quanto para a contagem de agentes
 * (`AgentsTab.tsx`). Não é o coletor que muda — dado já gravado com "ok"
 * continua "ok".
 */
import { describe, expect, it } from "vitest";

import { statusIndicaOnline } from "@/lib/monitoring-status";

describe("statusIndicaOnline", () => {
  it("'ok' é online — é o valor real que o coletor grava", () => {
    expect(statusIndicaOnline("ok")).toBe(true);
  });

  it("'online' também é online — outro formato do coletor usa esse nome", () => {
    expect(statusIndicaOnline("online")).toBe(true);
  });

  it("null é tratado como não-online, não como erro", () => {
    expect(statusIndicaOnline(null)).toBe(false);
  });

  it("valor desconhecido não vira online por engano", () => {
    expect(statusIndicaOnline("valor-que-nao-existe")).toBe(false);
  });

  it("gateway de fato fora ('down') continua NÃO-online — a correção não pode virar 'nunca avisar'", () => {
    expect(statusIndicaOnline("down")).toBe(false);
  });
});
