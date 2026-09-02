/**
 * `gateway_health` e `agent_stats` têm DOIS escritores, com vocabulários
 * diferentes — não é um vocabulário único com uma variação decorativa:
 *
 * - `backend/app/coletor_metricas.py` (coletor em processo): grava "ok"
 *   (l. 195) e "down" (l. 305); em `agent_stats`, o que o gateway devolver,
 *   senão "ok" (l. 157).
 * - `backend/app/routers/coletor.py` (push vindo da VPS): grava
 *   "online"/"offline" em `gateway_health` (l. 135, 437) e "online" em
 *   `agent_stats` (l. 204, 270, 465).
 *
 * Ou seja, o ramo `=== "online"` é o caminho vivo do segundo coletor, não
 * retrocompatibilidade morta. A tela `/monitoring` comparava só com
 * `"online"` e ignorava o primeiro coletor; resultado, medido em produção em
 * 02/09/2026 com o gateway comprovadamente no ar: o aviso "Gateway offline"
 * fixo e "SUPER AGENTES ONLINE 0/8" com os 5 agentes trazendo `status = 'ok'`.
 *
 * A correção é aqui, na leitura — não no que os coletores gravam (dado já
 * gravado não pode virar outra coisa, e os dois vocabulários continuam
 * vivos, cada um no seu caminho).
 */
export function statusIndicaOnline(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalizado = status.trim().toLowerCase();
  return normalizado === "ok" || normalizado === "online";
}

/**
 * Classe de cor do contador "Super agentes Online" (`AgentsTab.tsx`).
 *
 * `agent_stats` só recebe linha quando a coleta dá certo — no caminho de
 * falha o coletor grava `gateway_health.status = "down"` e manda `[]` de
 * agentes (`backend/app/coletor_metricas.py`), então com o gateway
 * comprovadamente fora as linhas que sobram no banco são as da ÚLTIMA
 * coleta boa, todas "ok". Sem este caso a tela mostrava ao mesmo tempo a
 * faixa "Gateway offline — agentes indisponíveis" e o contador em
 * `text-success` — duas afirmações contraditórias no mesmo card. Aqui o
 * contador degrada para "text-warning" (não afirma saudável, mas também não
 * grita "erro" por um dado que só está desatualizado).
 */
export function corContagemAgentesOnline(
  onlineCount: number,
  totalAgents: number,
  gatewayOnline: boolean | null,
): string {
  if (gatewayOnline === false) return "text-warning";
  return totalAgents > 0 && onlineCount === totalAgents ? "text-success" : "text-destructive";
}
