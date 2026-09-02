/**
 * Leitura do status que `app/coletor_metricas.py` grava em `gateway_health` e
 * `agent_stats`: os dois campos usam o mesmo vocabulário ("ok" no sucesso,
 * "down" quando o gateway não respondeu — ver `docs/CONFERENCIA-2026-09-01.md`).
 * A tela `/monitoring` comparava com `"online"`, valor que o coletor nunca
 * escreve. Resultado, medido em produção em 02/09/2026 com o gateway
 * comprovadamente no ar: o aviso "Gateway offline" fixo e "SUPER AGENTES
 * ONLINE 0/8" com os 5 agentes trazendo `status = 'ok'`.
 *
 * A correção é aqui, na leitura — não no que o coletor grava (dado já
 * gravado com "ok"/"down" não pode virar outra coisa).
 */
export function statusIndicaOnline(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalizado = status.trim().toLowerCase();
  return normalizado === "ok" || normalizado === "online" || normalizado === "active";
}
