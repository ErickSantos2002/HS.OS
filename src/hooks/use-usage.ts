import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Uso MEDIDO dos agentes (task #19).
 *
 * Fonte: `usage_events` — um fato por evento medido, vindo do `usage` real
 * das respostas do LLM e da varredura de sessões do gateway. Substitui
 * `agent_token_snapshots`, que era alimentada por relato (ninguém media nada)
 * e por isso produzia rankings que não descreviam a realidade.
 *
 * Entrega as três camadas de leitura de uma vez: total (estratégico), por
 * modelo (tático — comparar LLMs) e por tarefa (operacional — "ontem gastou
 * mais, o quê?").
 */

export interface UsageRow {
  ts: string;
  agent_id: string;
  model: string | null;
  kind: "dm" | "channel" | "cron" | "subagent" | "command" | "unknown";
  label: string | null;
  total_tokens: number;
  input_tokens?: number;
  output_tokens?: number;
  /** Entrada servida de cache — custa uma fração do preço cheio. */
  cached_tokens?: number;
  cost_usd: number | null;
}

export interface UsageSlice {
  key: string;
  tokens: number;
  cost: number;
  /** Quantos tokens do fatia não têm custo conhecido — a tela precisa avisar. */
  tokensSemCusto: number;
  eventos: number;
}

export interface DayPoint {
  day: string;
  label: string;
  tokens: number;
  cost: number;
  porAgente: Record<string, number>;
}

export const KIND_LABEL: Record<string, string> = {
  dm: "Conversa",
  channel: "Canal",
  cron: "Rotina",
  subagent: "Sub-agente",
  command: "Comando",
  unknown: "Outro",
};

/** Rótulo de tarefa: o nome do cron/sub-agente, ou o tipo + agente. */
export function tarefaDe(r: UsageRow): string {
  return r.label ?? `${KIND_LABEL[r.kind] ?? r.kind} · ${r.agent_id}`;
}

function group(rows: UsageRow[], keyOf: (r: UsageRow) => string): UsageSlice[] {
  const map = new Map<string, UsageSlice>();
  for (const r of rows) {
    const key = keyOf(r);
    const cur = map.get(key) ?? { key, tokens: 0, cost: 0, tokensSemCusto: 0, eventos: 0 };
    cur.tokens += r.total_tokens;
    cur.eventos += 1;
    if (r.cost_usd == null) cur.tokensSemCusto += r.total_tokens;
    else cur.cost += Number(r.cost_usd);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

/** Agrega um conjunto de eventos nas dimensões da tela. */
export function agregar(rows: UsageRow[]) {
  return {
    tokens: rows.reduce((s, r) => s + r.total_tokens, 0),
    cost: rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
    tokensSemCusto: rows.reduce((s, r) => s + (r.cost_usd == null ? r.total_tokens : 0), 0),
    porAgente: group(rows, (r) => r.agent_id),
    porModelo: group(rows, (r) => r.model ?? "(não identificado)"),
    porTipo: group(rows, (r) => r.kind),
    porTarefa: group(rows, tarefaDe),
    eventos: rows.length,
  };
}

export interface Culpado {
  tarefa: string;
  agente: string;
  noDia: number;
  mediaOutrosDias: number;
  delta: number;
}

/**
 * Responde "por que este dia consumiu mais?" — compara cada tarefa do dia com
 * a própria média nos demais dias do período e devolve quem mais subiu.
 * É a diferença entre ver um pico e entender o pico.
 */
export function explicarDia(rows: UsageRow[], dia: string): Culpado[] {
  const doDia = rows.filter((r) => r.ts.slice(0, 10) === dia);
  const outros = rows.filter((r) => r.ts.slice(0, 10) !== dia);
  const qtdOutrosDias = new Set(outros.map((r) => r.ts.slice(0, 10))).size || 1;

  const somaPorTarefa = (rs: UsageRow[]) => {
    const m = new Map<string, { tokens: number; agente: string }>();
    for (const r of rs) {
      const k = tarefaDe(r);
      const cur = m.get(k) ?? { tokens: 0, agente: r.agent_id };
      cur.tokens += r.total_tokens;
      m.set(k, cur);
    }
    return m;
  };

  const noDia = somaPorTarefa(doDia);
  const base = somaPorTarefa(outros);

  return [...noDia.entries()]
    .map(([tarefa, v]) => {
      const media = (base.get(tarefa)?.tokens ?? 0) / qtdOutrosDias;
      return { tarefa, agente: v.agente, noDia: v.tokens, mediaOutrosDias: media, delta: v.tokens - media };
    })
    .filter((c) => c.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 8);
}

/**
 * @param desde primeiro dia do período (yyyy-mm-dd)
 * @param ate   último dia do período, inclusive (yyyy-mm-dd)
 *
 * Busca também o período ANTERIOR de mesmo tamanho: sem uma base de
 * comparação, "gastou 1,2M tokens" não diz se é muito ou pouco.
 */
export function useUsage(desde: string, ate: string) {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [rowsAnterior, setRowsAnterior] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const ini = new Date(`${desde}T00:00:00`);
      const fim = new Date(`${ate}T23:59:59.999`);
      const dias = Math.max(1, Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1);
      const iniAnterior = new Date(ini);
      iniAnterior.setDate(iniAnterior.getDate() - dias);

      const COLS = "ts, agent_id, model, kind, label, total_tokens, input_tokens, output_tokens, cached_tokens, cost_usd";
      const [atual, anterior] = await Promise.all([
        supabase.from("usage_events").select(COLS)
          .gte("ts", ini.toISOString()).lte("ts", fim.toISOString())
          .order("ts", { ascending: true }).limit(20000),
        supabase.from("usage_events").select("ts, total_tokens, cost_usd")
          .gte("ts", iniAnterior.toISOString()).lt("ts", ini.toISOString())
          .limit(20000),
      ]);

      if (cancelled) return;
      if (atual.error) {
        setError(atual.error.message);
        setRows([]);
      } else {
        setRows((atual.data ?? []) as UsageRow[]);
      }
      setRowsAnterior((anterior.data ?? []) as UsageRow[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [desde, ate]);

  return useMemo(() => {
    const tokens = rows.reduce((s, r) => s + r.total_tokens, 0);
    const cost = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    const tokensSemCusto = rows.reduce((s, r) => s + (r.cost_usd == null ? r.total_tokens : 0), 0);

    const porDiaMap = new Map<string, DayPoint>();
    for (const r of rows) {
      const day = r.ts.slice(0, 10);
      const cur = porDiaMap.get(day) ?? {
        day, label: `${day.slice(8, 10)}/${day.slice(5, 7)}`, tokens: 0, cost: 0, porAgente: {},
      };
      cur.tokens += r.total_tokens;
      cur.cost += Number(r.cost_usd) || 0;
      cur.porAgente[r.agent_id] = (cur.porAgente[r.agent_id] ?? 0) + r.total_tokens;
      porDiaMap.set(day, cur);
    }
    const porDia = [...porDiaMap.values()].sort((a, b) => a.day.localeCompare(b.day));

    const porAgente = group(rows, (r) => r.agent_id);
    const porModelo = group(rows, (r) => r.model ?? "(não identificado)");
    const porTipo = group(rows, (r) => r.kind);
    // A camada operacional: cada rotina/sub-agente com nome próprio.
    const porTarefa = group(rows, (r) =>
      r.label ?? `${KIND_LABEL[r.kind] ?? r.kind} · ${r.agent_id}`);

    const diaPico = porDia.reduce<DayPoint | null>(
      (max, d) => (!max || d.tokens > max.tokens ? d : max), null);

    // Comparação com o período anterior de mesmo tamanho.
    const tokensAnt = rowsAnterior.reduce((s, r) => s + r.total_tokens, 0);
    const custoAnt = rowsAnterior.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
    const variacao = (atual: number, ant: number) =>
      ant > 0 ? ((atual - ant) / ant) * 100 : null;

    // Cache: a métrica de eficiência mais importante desta plataforma. Entrada
    // servida de cache custa uma fração — quanto maior a fatia, mais barato
    // fica o mesmo trabalho.
    const cache = rows.reduce((s, r) => s + (r.cached_tokens ?? 0), 0);
    const entrada = rows.reduce((s, r) => s + (r.input_tokens ?? 0), 0);
    const taxaCache = entrada > 0 ? (cache / entrada) * 100 : 0;

    // Quando o consumo acontece — revela rotinas de madrugada e picos de uso.
    const porHoraMap = new Map<number, number>();
    for (const r of rows) {
      const h = new Date(r.ts).getHours();
      porHoraMap.set(h, (porHoraMap.get(h) ?? 0) + r.total_tokens);
    }
    const porHora = Array.from({ length: 24 }, (_, h) => ({
      hora: h,
      label: `${String(h).padStart(2, "0")}h`,
      tokens: porHoraMap.get(h) ?? 0,
    }));

    // As chamadas individuais mais pesadas: um único turno gigante costuma
    // ser conversa muito longa ou rotina mal dimensionada.
    const maiores = [...rows]
      .sort((a, b) => b.total_tokens - a.total_tokens)
      .slice(0, 10);

    const mediaPorChamada = rows.length ? tokens / rows.length : 0;

    return {
      loading, error, rows,
      total: { tokens, cost, tokensSemCusto },
      anterior: { tokens: tokensAnt, cost: custoAnt },
      variacaoTokens: variacao(tokens, tokensAnt),
      variacaoCusto: variacao(cost, custoAnt),
      cache: { tokens: cache, entrada, taxa: taxaCache },
      mediaPorChamada,
      porHora, maiores,
      /** true quando parte do consumo não tem preço conhecido — a tela avisa. */
      custoParcial: tokensSemCusto > 0,
      porDia, porAgente, porModelo, porTipo, porTarefa, diaPico,
      vazio: rows.length === 0,
    };
  }, [rows, rowsAnterior, loading, error]);
}
