/**
 * A tela `/monitoring` dizia "Gateway offline — agentes indisponíveis" e
 * "SUPER AGENTES ONLINE 0/8" com o gateway comprovadamente no ar (medido em
 * produção, 02/09/2026: `GET /gateway/status` respondia `conectado: true`, e
 * `agent_stats` tinha 5 linhas frescas). A causa: `gateway_health` e
 * `agent_stats` têm dois escritores com vocabulários diferentes —
 * `app/coletor_metricas.py` grava "ok"/"down", `app/routers/coletor.py`
 * (push da VPS) grava "online"/"offline" — e a tela comparava só com
 * `"online"`, ignorando o primeiro. Ver `@/lib/monitoring-status` para os
 * dois escritores, com arquivo e linha.
 *
 * `statusIndicaOnline` é a leitura corrigida, usada tanto para o aviso do
 * gateway (`use-monitoring-data.ts`) quanto para a contagem de agentes
 * (`AgentsTab.tsx`). Não é o coletor que muda — dado já gravado continua
 * gravado como está.
 */
import { describe, expect, it } from "vitest";

import { statusIndicaOnline, corContagemAgentesOnline } from "@/lib/monitoring-status";

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

describe("corContagemAgentesOnline", () => {
  it("todos online e gateway confirmadamente no ar — verde", () => {
    expect(corContagemAgentesOnline(5, 5, true)).toBe("text-success");
  });

  it("nem todos online e gateway no ar — vermelho", () => {
    expect(corContagemAgentesOnline(3, 5, true)).toBe("text-destructive");
  });

  it(
    "gateway confirmadamente OFFLINE não pode mostrar verde, mesmo com " +
      "5/5 — são linhas da última coleta boa, não status atual (ver " +
      "backend/app/coletor_metricas.py)",
    () => {
      expect(corContagemAgentesOnline(5, 5, false)).toBe("text-warning");
    },
  );

  it("gateway offline com contagem zerada também degrada, não vira destrutivo", () => {
    expect(corContagemAgentesOnline(0, 5, false)).toBe("text-warning");
  });

  it("nunca houve coleta (gatewayOnline null) segue a régua normal de online/offline", () => {
    expect(corContagemAgentesOnline(0, 0, null)).toBe("text-destructive");
  });
});
