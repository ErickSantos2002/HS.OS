import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-collector-token',
}

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const normalized = Number(value.replace(/[^0-9.-]+/g, ''))
    return Number.isFinite(normalized) ? normalized : fallback
  }
  return fallback
}

const toNullableString = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim().length > 0) return value
  return null
}

const toIsoString = (value: unknown, fallback: string | null = null): string | null => {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1e12 ? value : value * 1000
    const parsed = new Date(timestamp)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }

  return fallback
}

const getSnapshotTimestamp = (body: Record<string, unknown>, now: string): string => {
  return (
    toIsoString(body.timestamp) ||
    toIsoString(body.generated_at) ||
    toIsoString(body.generated_at_ms) ||
    now
  )
}

const extractCurrentGateway = (body: Record<string, unknown>) => {
  const gateway = (body.gateway && typeof body.gateway === 'object' ? body.gateway : {}) as Record<string, unknown>
  const status =
    toNullableString(gateway.status) ||
    (gateway.ok === false || gateway.gateway_ok === false ? 'offline' : 'online')

  return {
    status,
    version: toNullableString(gateway.version) || toNullableString(gateway.openclaw_version),
    uptime_seconds: gateway.uptime_seconds ?? gateway.uptime ?? null,
    latency_ms: gateway.latency_ms ?? gateway.latency ?? null,
  }
}

const extractCurrentUsage = (body: Record<string, unknown>, snapshotTimestamp: string) => {
  const sessions = (body.sessions && typeof body.sessions === 'object' ? body.sessions : {}) as Record<string, unknown>
  const costs = (body.costs && typeof body.costs === 'object' ? body.costs : {}) as Record<string, unknown>
  const tasks = (body.tasks && typeof body.tasks === 'object' ? body.tasks : {}) as Record<string, unknown>

  const succeeded = toNumber(tasks.succeeded)
  const timedOut = toNumber(tasks.timed_out ?? tasks.timedOut)
  const failed = toNumber(tasks.failed)
  const tasksTotal = succeeded + timedOut + failed

  return {
    date: snapshotTimestamp.split('T')[0],
    messages_total: toNumber(sessions.total ?? body.sessions_count),
    tokens_total: toNumber(costs.total_tokens ?? costs.tokens_total ?? costs.tokens?.total),
    cost_total: toNumber(costs.total_usd ?? costs.total_cost ?? costs.cost_total ?? costs.total),
    cache_hit_rate: toNumber(costs.cache_hit_rate ?? costs.tokens?.cacheHitRate),
    error_rate: tasksTotal > 0 ? failed / tasksTotal : 0,
    tool_calls: toNumber(body.tool_calls ?? body.toolCalls),
    collected_at: snapshotTimestamp,
  }
}

const extractCurrentAgentRows = (body: Record<string, unknown>, snapshotTimestamp: string) => {
  const sessions = (body.sessions && typeof body.sessions === 'object' ? body.sessions : {}) as Record<string, unknown>
  const costs = (body.costs && typeof body.costs === 'object' ? body.costs : {}) as Record<string, unknown>

  // Correct path: sessions.summary.by_agent (keys are real agent IDs: lia, milo, kira, ...)
  const summary = (sessions.summary && typeof sessions.summary === 'object'
    ? sessions.summary
    : {}) as Record<string, unknown>
  const byAgent =
    (summary.by_agent && typeof summary.by_agent === 'object' ? summary.by_agent : null) ||
    // Backward compatibility with older collector payloads
    (sessions.perAgent && typeof sessions.perAgent === 'object' ? sessions.perAgent : null) ||
    (sessions.per_agent && typeof sessions.per_agent === 'object' ? sessions.per_agent : null) ||
    (sessions.by_agent && typeof sessions.by_agent === 'object' ? sessions.by_agent : null) ||
    {}

  const costsPerAgent =
    (costs.perAgent && typeof costs.perAgent === 'object' ? costs.perAgent : null) ||
    (costs.per_agent && typeof costs.per_agent === 'object' ? costs.per_agent : null) ||
    {}

  const tokensPerAgent =
    (costs.tokens_per_agent && typeof costs.tokens_per_agent === 'object' ? costs.tokens_per_agent : null) ||
    (costs.tokensPerAgent && typeof costs.tokensPerAgent === 'object' ? costs.tokensPerAgent : null) ||
    {}

  return Object.keys(byAgent as Record<string, unknown>).map((agentId) => {
    const rawSessionEntry = (byAgent as Record<string, unknown>)[agentId]
    const sessionEntry = rawSessionEntry && typeof rawSessionEntry === 'object'
      ? (rawSessionEntry as Record<string, unknown>)
      : null
    const rawAgentCost = (costsPerAgent as Record<string, unknown>)[agentId]
    const agentCost = rawAgentCost && typeof rawAgentCost === 'object'
      ? (rawAgentCost as Record<string, unknown>)
      : null

    const sessionCount = toNumber(
      sessionEntry?.count ?? sessionEntry?.sessions ?? rawSessionEntry
    )
    const maxTotalTokens = toNumber(
      sessionEntry?.max_total_tokens ?? sessionEntry?.maxTotalTokens
    )
    const latestUpdatedAt = toIsoString(
      sessionEntry?.latest_updated_at ?? sessionEntry?.latestUpdatedAt ?? sessionEntry?.last_active ?? sessionEntry?.lastActive,
      snapshotTimestamp
    )
    const topSessionsRaw = sessionEntry?.top_sessions ?? sessionEntry?.topSessions ?? null
    const topSessions = Array.isArray(topSessionsRaw) ? topSessionsRaw : null

    // Extract userId from top_sessions entries (try first entry, then any)
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    let userId: string | null = null
    if (topSessions) {
      for (const entry of topSessions) {
        if (entry && typeof entry === 'object') {
          const candidate = (entry as Record<string, unknown>).userId
            ?? (entry as Record<string, unknown>).user_id
          if (typeof candidate === 'string' && UUID_RE.test(candidate)) {
            userId = candidate
            break
          }
        }
      }
    }

    return {
      agent_id: agentId,
      status: toNullableString(sessionEntry?.status) ?? 'online',
      model: toNullableString(sessionEntry?.model) ?? toNullableString(agentCost?.model),
      last_active: latestUpdatedAt,
      last_channel: toNullableString(sessionEntry?.last_channel ?? sessionEntry?.lastChannel),
      messages_today: sessionCount,
      tokens_today: toNumber(
        agentCost?.tokens_total ?? agentCost?.tokens ?? (tokensPerAgent as Record<string, unknown>)[agentId] ?? maxTotalTokens
      ),
      cost_today: toNumber(agentCost?.total_usd ?? agentCost?.cost_total ?? agentCost?.cost ?? rawAgentCost),
      errors_today: toNumber(sessionEntry?.errors_today ?? sessionEntry?.errors),
      session_count: sessionCount,
      max_total_tokens: maxTotalTokens,
      latest_updated_at: latestUpdatedAt,
      top_sessions: topSessions,
      user_id: userId,
      collected_at: snapshotTimestamp,
    }
  })
}

const extractCurrentCronRows = (body: Record<string, unknown>, snapshotTimestamp: string) => {
  const crons = (body.crons && typeof body.crons === 'object' ? body.crons : {}) as Record<string, unknown>
  const jobs =
    (Array.isArray(crons.jobs) ? crons.jobs : null) ||
    (Array.isArray(crons.list) ? crons.list : null) ||
    (Array.isArray(body.cron) ? body.cron : null) ||
    []

  return jobs
    .filter((job): job is Record<string, unknown> => typeof job === 'object' && job !== null)
    .map((job) => ({
      id: String(job.id ?? job.name ?? `cron-${Math.random().toString(36).slice(2, 8)}`),
      name: toNullableString(job.name),
      agent: toNullableString(job.agent ?? job.agent_id),
      cron_expression: toNullableString(job.cronExpression ?? job.cron_expression ?? job.expression ?? job.schedule),
      status: toNullableString(job.status) ?? (job.enabled === false ? 'disabled' : 'ok'),
      enabled: typeof job.enabled === 'boolean' ? job.enabled : true,
      last_run: toIsoString(job.lastRun ?? job.last_run),
      next_run: toIsoString(job.nextRun ?? job.next_run),
      prompt: toNullableString(job.prompt ?? job.description),
      collected_at: snapshotTimestamp,
    }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Validate token
  const expectedToken = Deno.env.get('COLLECTOR_API_TOKEN')
  const authHeader = req.headers.get('Authorization')
  const collectorToken = req.headers.get('X-Collector-Token')
  const providedToken = collectorToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null)

  if (!providedToken || providedToken !== expectedToken) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const body = await req.json()
    const now = new Date().toISOString()
    const errors: string[] = []
    const snapshotTimestamp = getSnapshotTimestamp(body, now)

    console.log('Received body keys:', Object.keys(body))

    // Support current collector format (gateway/sessions/costs/crons/tasks),
    // older flat VPS format, and the original structured format.
    const hasCurrentCollectorShape =
      body.gateway !== undefined ||
      body.sessions !== undefined ||
      body.costs !== undefined ||
      body.crons !== undefined ||
      body.tasks !== undefined
    const isLegacyVpsFormat = body.sessions_count !== undefined || body.gateway_ok !== undefined
    const isOriginalStructuredFormat = body.agents !== undefined || body.cron !== undefined || body.health !== undefined || body.usage !== undefined

    if (hasCurrentCollectorShape && !isOriginalStructuredFormat) {
      const gatewayRow = {
        ...extractCurrentGateway(body),
        collected_at: snapshotTimestamp,
      }
      console.log('About to insert gateway_health:', JSON.stringify(gatewayRow))
      const { error: gatewayErr } = await supabase.from('gateway_health').insert(gatewayRow)
      if (gatewayErr) {
        console.error('Erro ao gravar gateway_health:', gatewayErr)
        errors.push(`gateway_health: ${gatewayErr.message}`)
      } else {
        console.log('gateway_health gravado com sucesso')
      }

      const usageRow = extractCurrentUsage(body, snapshotTimestamp)
      console.log('About to upsert usage_daily:', JSON.stringify(usageRow))
      const { error: usageErr } = await supabase
        .from('usage_daily')
        .upsert(usageRow, { onConflict: 'date' })
      if (usageErr) {
        console.error('Erro ao gravar usage_daily:', usageErr)
        errors.push(`usage_daily: ${usageErr.message}`)
      } else {
        console.log('usage_daily gravado com sucesso')
      }

      const agentRows = extractCurrentAgentRows(body, snapshotTimestamp)
      console.log('About to upsert agent_stats count:', agentRows.length, 'sample:', JSON.stringify(agentRows[0] ?? null))
      if (agentRows.length > 0) {
        const { error: agentErr } = await supabase.from('agent_stats').upsert(agentRows, { onConflict: 'agent_id' })
        if (agentErr) {
          console.error('Erro ao gravar agent_stats:', agentErr)
          errors.push(`agent_stats: ${agentErr.message}`)
        } else {
          console.log('agent_stats gravado com sucesso:', agentRows.length)
        }
      } else {
        console.log('Nenhuma linha preparada para agent_stats')
      }

      const cronRows = extractCurrentCronRows(body, snapshotTimestamp)
      console.log('About to upsert cron_jobs count:', cronRows.length, 'sample:', JSON.stringify(cronRows[0] ?? null))
      if (cronRows.length > 0) {
        const { error: cronErr } = await supabase.from('cron_jobs').upsert(cronRows, { onConflict: 'id' })
        if (cronErr) {
          console.error('Erro ao gravar cron_jobs:', cronErr)
          errors.push(`cron_jobs: ${cronErr.message}`)
        } else {
          console.log('cron_jobs gravado com sucesso:', cronRows.length)
        }
      } else {
        console.log('Nenhuma linha preparada para cron_jobs')
      }

      console.log(`Current collector format processed: agents=${agentRows.length}, crons=${cronRows.length}, errors=${errors.length}, snapshot=${snapshotTimestamp}`)
    } else if (isLegacyVpsFormat) {
      // === VPS latest.json format ===
      // Possible fields: sessions_count, sessions (per-agent), crons_count, crons (array),
      // gateway_ok, version, tasks, costs, tokens, agents (array), cron (array)

      // 1. Gateway health
      const healthStatus = body.gateway_ok ? 'online' : 'offline'
      const version = body.version ?? body.gateway_version ?? null
      const gatewayRow = {
        status: healthStatus,
        version: version,
        uptime_seconds: body.uptime_seconds ?? body.uptime ?? null,
        latency_ms: body.latency_ms ?? body.latency ?? null,
        collected_at: snapshotTimestamp,
      }
      console.log('About to insert gateway_health:', JSON.stringify(gatewayRow))
      const { error: healthErr } = await supabase.from('gateway_health').insert(gatewayRow)
      if (healthErr) {
        console.error('Erro ao gravar gateway_health:', healthErr)
        errors.push(`gateway_health: ${healthErr.message}`)
      } else {
        console.log('gateway_health gravado com sucesso')
      }

      // 2. Usage daily — extract costs and tokens from nested or flat fields
      const snapshotDate = snapshotTimestamp.split('T')[0]
      const costTotal = body.costs?.total ?? body.cost?.total ?? body.cost_total ?? 0
      const tokensTotal = body.tokens?.total ?? body.tokens_total ?? 0
      const cacheHitRate = body.tokens?.cacheHitRate ?? body.cache_hit_rate ?? 0
      const toolCalls = body.toolCalls?.total ?? body.tool_calls ?? 0
      const tasksTotal = (body.tasks?.succeeded || 0) + (body.tasks?.failed || 0) + (body.tasks?.timed_out || 0)
      const errorRate = body.tasks?.failed ? (body.tasks.failed / Math.max(1, tasksTotal)) : 0

      const usageRow = {
        date: snapshotDate,
        messages_total: body.sessions_count ?? 0,
        tokens_total: tokensTotal,
        cost_total: costTotal,
        cache_hit_rate: cacheHitRate,
        error_rate: errorRate,
        tool_calls: toolCalls,
        collected_at: snapshotTimestamp,
      }
      console.log('About to upsert usage_daily:', JSON.stringify(usageRow))
      const { error: usageErr } = await supabase
        .from('usage_daily')
        .upsert(usageRow, { onConflict: 'date' })
      if (usageErr) {
        console.error('Erro ao gravar usage_daily:', usageErr)
        errors.push(`usage_daily: ${usageErr.message}`)
      } else {
        console.log('usage_daily gravado com sucesso')
      }

      // 3. Agent stats — from agents array OR sessions per-agent breakdown
      const agentsArray = body.agents || []
      const sessionsPerAgent = body.sessions || {}
      const costsPerAgent = body.costs?.perAgent ?? body.costs?.per_agent ?? {}
      const tokensPerAgent = body.tokens?.perAgent ?? body.tokens?.per_agent ?? {}
      const errorsPerAgent = body.errors?.perAgent ?? body.errors?.per_agent ?? {}

      if (Array.isArray(agentsArray) && agentsArray.length > 0) {
        const rows = agentsArray.map((a: Record<string, unknown>) => ({
          agent_id: a.id || a.agent_id,
          status: a.status ?? 'online',
          model: a.model ?? null,
          last_active: a.lastActive || a.last_active || null,
          last_channel: a.lastChannel || a.last_channel || null,
          messages_today: a.messagesToday ?? a.messages_today ?? a.sessions ?? 0,
          tokens_today: a.tokensToday ?? a.tokens_today ?? 0,
          cost_today: a.costToday ?? a.cost_today ?? 0,
          errors_today: a.errorsToday ?? a.errors_today ?? 0,
          collected_at: snapshotTimestamp,
        }))
        console.log('About to upsert agent_stats count:', rows.length, 'sample:', JSON.stringify(rows[0] ?? null))
        const { error } = await supabase.from('agent_stats').upsert(rows, { onConflict: 'agent_id' })
        if (error) {
          console.error('Erro ao gravar agent_stats:', error)
          errors.push(`agent_stats: ${error.message}`)
        } else {
          console.log('agent_stats gravado com sucesso:', rows.length)
        }
      } else if (Object.keys(sessionsPerAgent).length > 0) {
        // Generate agent_stats from sessions breakdown: { lia: 1392, kira: 181, ... }
        const rows = Object.entries(sessionsPerAgent).map(([agentId, sessions]) => ({
          agent_id: agentId,
          status: 'online',
          model: null,
          last_active: snapshotTimestamp,
          last_channel: null,
          messages_today: sessions as number,
          tokens_today: (tokensPerAgent as Record<string, number>)[agentId] ?? 0,
          cost_today: (costsPerAgent as Record<string, number>)[agentId] ?? 0,
          errors_today: (errorsPerAgent as Record<string, number>)[agentId] ?? 0,
          collected_at: snapshotTimestamp,
        }))
        console.log('About to upsert agent_stats count:', rows.length, 'sample:', JSON.stringify(rows[0] ?? null))
        const { error } = await supabase.from('agent_stats').upsert(rows, { onConflict: 'agent_id' })
        if (error) {
          console.error('Erro ao gravar agent_stats:', error)
          errors.push(`agent_stats: ${error.message}`)
        } else {
          console.log('agent_stats gravado com sucesso:', rows.length)
        }
      } else {
        console.log('Nenhuma linha preparada para agent_stats')
      }

      // 4. Cron jobs — from cron or crons array
      // Support: body.crons.jobs (VPS format), body.crons (array), body.cron (array)
      const rawCrons = body.crons || body.cron || []
      const cronArray = Array.isArray(rawCrons) ? rawCrons : (rawCrons?.jobs ?? rawCrons?.list ?? [])
      if (Array.isArray(cronArray) && cronArray.length > 0) {
        const rows = cronArray.map((c: Record<string, unknown>) => ({
          id: c.id || c.name || `cron-${Math.random().toString(36).slice(2, 8)}`,
          name: c.name ?? null,
          agent: c.agent ?? c.agent_id ?? null,
          cron_expression: c.cronExpression || c.cron_expression || c.expression || c.schedule || null,
          status: c.status ?? null,
          enabled: c.enabled ?? true,
          last_run: c.lastRun || c.last_run || null,
          next_run: c.nextRun || c.next_run || null,
          prompt: c.prompt ?? c.description ?? null,
          collected_at: snapshotTimestamp,
        }))
        console.log('About to upsert cron_jobs count:', rows.length, 'sample:', JSON.stringify(rows[0] ?? null))
        const { error } = await supabase.from('cron_jobs').upsert(rows, { onConflict: 'id' })
        if (error) {
          console.error('Erro ao gravar cron_jobs:', error)
          errors.push(`cron_jobs: ${error.message}`)
        } else {
          console.log('cron_jobs gravado com sucesso:', rows.length)
        }
      } else {
        console.log('Nenhuma linha preparada para cron_jobs')
      }

      console.log(`VPS format processed: agents=${agentsArray.length || Object.keys(sessionsPerAgent).length}, crons=${cronArray.length}, errors=${errors.length}, snapshot=${snapshotTimestamp}`)
    } else {
      // === Structured format (original) ===
      const { agents, cron, health, usage } = body
      const ts = snapshotTimestamp

      if (Array.isArray(agents) && agents.length > 0) {
        const rows = agents.map((a: Record<string, unknown>) => ({
          agent_id: a.id || a.agent_id,
          status: a.status ?? null,
          model: a.model ?? null,
          last_active: a.lastActive || a.last_active || null,
          last_channel: a.lastChannel || a.last_channel || null,
          messages_today: a.messagesToday ?? a.messages_today ?? 0,
          tokens_today: a.tokensToday ?? a.tokens_today ?? 0,
          cost_today: a.costToday ?? a.cost_today ?? 0,
          errors_today: a.errorsToday ?? a.errors_today ?? 0,
          collected_at: ts,
        }))
        console.log('About to upsert agent_stats count:', rows.length, 'sample:', JSON.stringify(rows[0] ?? null))
        const { error } = await supabase.from('agent_stats').upsert(rows, { onConflict: 'agent_id' })
        if (error) {
          console.error('Erro ao gravar agent_stats:', error)
          errors.push(`agent_stats: ${error.message}`)
        } else {
          console.log('agent_stats gravado com sucesso:', rows.length)
        }
      } else {
        console.log('Nenhuma linha preparada para agent_stats')
      }

      if (Array.isArray(cron) && cron.length > 0) {
        const rows = cron.map((c: Record<string, unknown>) => ({
          id: c.id,
          name: c.name ?? null,
          agent: c.agent ?? null,
          cron_expression: c.cronExpression || c.cron_expression || c.expression || null,
          status: c.status ?? null,
          enabled: c.enabled ?? true,
          last_run: c.lastRun || c.last_run || null,
          next_run: c.nextRun || c.next_run || null,
          prompt: c.prompt ?? null,
          collected_at: ts,
        }))
        console.log('About to upsert cron_jobs count:', rows.length, 'sample:', JSON.stringify(rows[0] ?? null))
        const { error } = await supabase.from('cron_jobs').upsert(rows, { onConflict: 'id' })
        if (error) {
          console.error('Erro ao gravar cron_jobs:', error)
          errors.push(`cron_jobs: ${error.message}`)
        } else {
          console.log('cron_jobs gravado com sucesso:', rows.length)
        }
      } else {
        console.log('Nenhuma linha preparada para cron_jobs')
      }

      if (health && typeof health === 'object') {
        const gatewayRow = {
          status: health.status ?? null,
          version: health.version ?? null,
          uptime_seconds: health.uptimeSeconds ?? health.uptime_seconds ?? null,
          latency_ms: health.latencyMs ?? health.latency_ms ?? null,
          collected_at: ts,
        }
        console.log('About to insert gateway_health:', JSON.stringify(gatewayRow))
        const { error } = await supabase.from('gateway_health').insert(gatewayRow)
        if (error) {
          console.error('Erro ao gravar gateway_health:', error)
          errors.push(`gateway_health: ${error.message}`)
        } else {
          console.log('gateway_health gravado com sucesso')
        }
      } else {
        console.log('Nenhuma linha preparada para gateway_health')
      }

      if (usage && typeof usage === 'object') {
        const date = usage.date || ts.split('T')[0]
        const usageRow = {
          date,
          messages_total: usage.messages?.total ?? usage.messages_total ?? 0,
          tokens_total: usage.tokens?.total ?? usage.tokens_total ?? 0,
          cost_total: usage.cost?.total ?? usage.cost_total ?? 0,
          cache_hit_rate: usage.tokens?.cacheHitRate ?? usage.cache_hit_rate ?? 0,
          error_rate: usage.errors?.rate ?? usage.error_rate ?? 0,
          tool_calls: usage.toolCalls?.total ?? usage.tool_calls ?? 0,
          collected_at: ts,
        }
        console.log('About to upsert usage_daily:', JSON.stringify(usageRow))
        const { error } = await supabase.from('usage_daily').upsert(usageRow, { onConflict: 'date' })
        if (error) {
          console.error('Erro ao gravar usage_daily:', error)
          errors.push(`usage_daily: ${error.message}`)
        } else {
          console.log('usage_daily gravado com sucesso')
        }
      } else {
        console.log('Nenhuma linha preparada para usage_daily')
      }
    }

    if (errors.length > 0) {
      console.error('Partial errors:', errors)
      return new Response(JSON.stringify({ success: false, errors, timestamp: now }), {
        status: 207,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, timestamp: now }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('collect-agent-stats error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
