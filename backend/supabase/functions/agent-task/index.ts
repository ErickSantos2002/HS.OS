// Loop Architecture — CRUD for agent_tasks (autonomous long-running tasks) — v5 (async export_agent branch)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getIntegrationSecret } from "../_shared/integration-secret.ts";
import { getGatewayConfig } from "../_shared/gateway-config.ts";

const supportedActions = [
  "create",
  "checkpoint",
  "resume",
  "complete",
  "fail",
  "list",
  "get",
  "pause",
  "delete",
] as const;

const actionAliases: Record<string, (typeof supportedActions)[number]> = {
  remove: "delete",
  destroy: "delete",
  cancel: "pause",
  stop: "pause",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * B8 (segurança): agentes chamando via o secret compartilhado (isServiceCall)
 * mantêm autonomia total sobre qualquer task — intencional, é assim que o
 * orquestrador coordena os demais agentes. A restrição é só para USUÁRIOS
 * HUMANOS (JWT): hoje qualquer pessoa logada (inclusive o papel mínimo 'user')
 * consegue apagar/falhar/pausar a task de qualquer pessoa, sem checagem nenhuma.
 *
 * A tela de Tasks é um painel COMPARTILHADO de equipe (sem role gate na rota,
 * tasks de agente ficam com created_by=null) — checar "dono da tarefa"
 * quebraria o uso normal de time. Em vez disso, exige papel 'member' ou
 * 'super_admin' (bloqueia só o papel mínimo 'user', que não deveria gerenciar
 * o Loop Architecture de qualquer forma).
 */
async function assertHumanCanMutateTask(
  supabase: ReturnType<typeof createClient>,
  isServiceCall: boolean,
  userId: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (isServiceCall) return { ok: true };
  if (!userId) return { ok: false, status: 401, error: "Unauthorized" };

  const { data: role } = await supabase.rpc("get_user_role", { _user_id: userId });
  if (role === "super_admin" || role === "member") return { ok: true };

  return { ok: false, status: 403, error: "Você não tem permissão para modificar tarefas." };
}

/**
 * Dispara a skill superagent-onboards no gateway para uma lista de agentes.
 *
 * Existe como função separada porque `create` e `resume` fazem exatamente a
 * mesma coisa — muda só QUAIS agentes entram na lista. Na criação são todos; ao
 * retomar, só os que ainda não terminaram. É isso que dá utilidade ao checkpoint
 * por agente: antes, o progresso era gravado e ninguém lia, então retomar
 * significava refazer do zero o onboarding de quem já tinha passado.
 *
 * Lança em caso de falha; quem chama decide o que fazer — `create` marca a task
 * como failed em segundo plano, `resume` devolve o erro para a tela.
 */
async function runOnboardingSkill(
  supabase: ReturnType<typeof createClient>,
  params: {
    taskId: string;
    executorId: string;
    agents: string[];
    lovableProjectUrl: string;
    resuming?: boolean;
  },
): Promise<void> {
  const { url: rawUrl, token } = await getGatewayConfig(supabase);
  const url = (rawUrl ?? "").replace(/\/$/, "");
  if (!url) throw new Error("Gateway não configurado (vps_config.gateway_url vazio).");
  if (!token) {
    throw new Error("Gateway sem token (vps_config.admin_token vazio ou OPENCLAW_ADMIN_TOKEN não definido).");
  }

  // Ao retomar, o aviso explícito importa: sem ele a skill pode reprocessar
  // agentes que já foram, porque o prompt sozinho não distingue as duas
  // situações.
  const header = params.resuming
    ? `RUN_SKILL superagent-onboards (RETOMANDO — faça APENAS os agentes listados abaixo, os demais já foram concluídos)\n`
    : `RUN_SKILL superagent-onboards\n`;

  const prompt =
    header +
    `task_id: ${params.taskId}\n` +
    `selected_agents: ${JSON.stringify(params.agents)}\n` +
    `lovable_project_url: ${params.lovableProjectUrl}\n\n` +
    `Reporte progresso chamando agent-task action:checkpoint com ` +
    `progress:[{agent_id,status}] a cada agente concluído, e ` +
    `action:complete ao terminar.`;

  const r = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: `openclaw:${params.executorId}`,
      stream: false,
      messages: [
        {
          role: "system",
          content: "Você é a Lia. Execute a skill superagent-onboards imediatamente com os parâmetros fornecidos.",
        },
        { role: "user", content: prompt },
      ],
      metadata: {
        task_id: params.taskId,
        trigger_skill: "superagent-onboards",
        selected_agents: params.agents,
        lovable_project_url: params.lovableProjectUrl,
        resuming: !!params.resuming,
      },
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Gateway HTTP ${r.status}: ${txt.slice(0, 200)}`);
  }
}

async function scheduleAgentTurn(params: {
  gatewayUrl: string;
  gatewayToken: string;
  agentId: string;
  message: string;
  jobName: string;
  timeoutSeconds?: number;
}) {
  const res = await fetch(`${params.gatewayUrl}/api/v1/admin/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.gatewayToken}`,
    },
    body: JSON.stringify({
      id: params.jobName,
      method: "cron.add",
      params: {
        name: params.jobName,
        schedule: { kind: "at", at: new Date(Date.now() + 3000).toISOString() },
        sessionTarget: "isolated",
        agentId: params.agentId,
        payload: {
          kind: "agentTurn",
          message: params.message,
          timeoutSeconds: params.timeoutSeconds ?? 300,
        },
        deleteAfterRun: true,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway RPC ${res.status}: ${text.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: accept user JWT OR service-role/webhook secret so agents (via gateway) can call.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const agentSecret = (await getIntegrationSecret(supabase, "AGENT_REPLY_WEBHOOK_SECRET")) ?? "";

    let userId: string | null = null;
    const isServiceCall = !!token && (token === serviceKey || (agentSecret && token === agentSecret));

    if (!isServiceCall) {
      if (!token) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const rawAction = typeof body?.action === "string" ? body.action.trim().toLowerCase() : "";
    const action = actionAliases[rawAction] ?? rawAction;

    if (action === "create") {
      const { agent_id, title, chunks, task_type, selected_agents, lovable_project_url, target_agent_id } = body;

      // Export branch — orchestrator reads agent files on the VPS, does the
      // reverse find-replace (real values -> {{PLACEHOLDERS}}) and returns the
      // packed .dnos payload via checkpoint_data.file_content.
      // Contract:
      //   { action: 'create', task_type: 'export_agent', target_agent_id: string }
      if (task_type === "export_agent") {
        const target = typeof target_agent_id === "string" ? target_agent_id.trim() : "";
        if (!target) return json({ error: "target_agent_id required" }, 400);

        const { data: leader } = await supabase
          .from("agent_profiles")
          .select("agent_id, openclaw_id")
          .eq("is_leader", true)
          .limit(1)
          .maybeSingle();
        const executorId = leader?.openclaw_id ?? leader?.agent_id;
        if (!executorId) return json({ error: "Orquestrador não encontrado (agent_profiles.is_leader)" }, 400);

        const { data: taskRow, error: taskErr } = await supabase
          .from("agent_tasks")
          .insert({
            agent_id: executorId,
            title: `Exportar agente ${target}`,
            status: "running",
            chunks: [{ id: 1, agent_id: target, label: `export:${target}` }],
            checkpoint_data: {
              task_type: "export_agent",
              target_agent_id: target,
              notes: "",
            },
            created_by: userId,
          })
          .select("id")
          .single();
        if (taskErr) return json({ error: taskErr.message }, 400);
        const taskId = taskRow.id;

        const triggerExport = async () => {
          try {
            const { url: rawUrl, token: gwToken } = await getGatewayConfig(supabase);
            const url = (rawUrl ?? "").replace(/\/$/, "");
            if (!url) throw new Error("Gateway não configurado (vps_config.gateway_url vazio).");
            if (!gwToken) throw new Error("Gateway sem token (vps_config.admin_token vazio ou OPENCLAW_ADMIN_TOKEN não definido).");

            const prompt =
              `RUN_SKILL export-agent\n` +
              `task_id: ${taskId}\n` +
              `target_agent_id: ${target}\n\n` +
              `Contrato obrigatório de fechamento de loop:\n` +
              `- Esta é uma task operacional do sistema: execute diretamente, não delegue para outro agente.\n` +
              `- Não responda apenas em texto/chat.\n` +
              `- Se a skill export-agent não estiver instalada, execute manualmente os passos abaixo com as ferramentas disponíveis.\n` +
              `- Antes de finalizar, chame agent-task action:checkpoint para task_id=${taskId} com checkpoint_data.file_path e checkpoint_data.file_content.\n` +
              `- Depois chame agent-task action:complete para task_id=${taskId}.\n` +
              `- Se qualquer etapa falhar, chame agent-task action:fail com o motivo.\n\n` +
              `Instruções:\n` +
              `1. Leia os arquivos em /root/.openclaw/workspace-${target}/ ` +
              `(SOUL.md, IDENTITY.md, TOOLS.md).\n` +
              `2. Consulte company_profile no Supabase e faça o find-replace reverso, ` +
              `substituindo os valores reais da empresa pelos placeholders ` +
              `(EXATAMENTE estes nomes — o importador só reconhece estes): ` +
              `{{COMPANY_NAME}}, {{FOUNDER_NAME}}, {{COMPANY_SEGMENT}}, {{COMPANY_DESCRIPTION}}, ` +
              `{{TARGET_AUDIENCE}}, {{COMPANY_PRODUCT}}, {{BRAND_VOICE}}.\n` +
              `3. Monte o JSON no formato .dnos (dnos_version: "1.0", ` +
              `agent: {agent_id, name, ...} — o campo é "agent_id", NUNCA "id", ` +
              `required_connectors, capabilities, files) e salve em ` +
              `/root/.openclaw/workspace/exports/${target}.dnos.\n` +
              `4. Reporte via agent-task action:checkpoint com ` +
              `checkpoint_data:{ file_path, file_content } contendo o JSON serializado ` +
              `como string em file_content.\n` +
              `5. Finalize com agent-task action:complete.`;

            await scheduleAgentTurn({
              gatewayUrl: url,
              gatewayToken: gwToken,
              agentId: executorId,
              jobName: `dnos-export-agent-${taskId}`,
              message: prompt,
              timeoutSeconds: 300,
            });
          } catch (e) {
            await supabase
              .from("agent_tasks")
              .update({
                status: "failed",
                checkpoint_data: {
                  task_type: "export_agent",
                  target_agent_id: target,
                  notes: `Trigger falhou: ${(e as Error).message}`,
                },
              })
              .eq("id", taskId);
          }
        };
        try {
          // @ts-ignore
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
            // @ts-ignore
            EdgeRuntime.waitUntil(triggerExport());
          } else {
            triggerExport();
          }
        } catch {
          triggerExport();
        }

        return json({ taskId, task_id: taskId });
      }



      // Onboarding branch — orchestrates the superagent-onboards skill server-side.
      // Contract:
      //   { action: 'create', task_type: 'onboarding', selected_agents: string[], lovable_project_url: string }
      if (task_type === "onboarding") {
        const agents: string[] = Array.isArray(selected_agents) ? selected_agents.filter(Boolean) : [];
        if (agents.length === 0) return json({ error: "selected_agents required" }, 400);
        if (!lovable_project_url || typeof lovable_project_url !== "string") {
          return json({ error: "lovable_project_url required" }, 400);
        }

        // The leader agent is the executor, resolved from
        // agent_templates.is_leader_template — never hardcoded, so a remix with
        // a differently-named leader works. Fail loudly if none is configured
        // instead of silently targeting a "lia" that may not exist.
        const { data: leader } = await supabase
          .from("agent_templates")
          .select("agent_id")
          .eq("is_leader_template", true)
          .maybeSingle();
        if (!leader?.agent_id) {
          return json({ error: "No leader agent template configured (is_leader_template=true)" }, 400);
        }
        const executorId = leader.agent_id;

        const chunksList = agents.map((id, idx) => ({ id: idx + 1, agent_id: id, label: id }));
        const initialProgress = agents.map((id) => ({ agent_id: id, status: "pending" as const }));

        const { data, error } = await supabase
          .from("agent_tasks")
          .insert({
            agent_id: executorId,
            title: "Onboarding — superagent-onboards",
            status: "running",
            chunks: chunksList,
            checkpoint_data: {
              task_type: "onboarding",
              lovable_project_url,
              selected_agents: agents,
              progress: initialProgress,
              notes: "",
            },
            created_by: userId,
          })
          .select("id")
          .single();
        if (error) return json({ error: error.message }, 400);
        const taskId = data.id;

        // Fire the skill on the OpenClaw gateway without blocking the response.
        // If the gateway is unreachable, mark the task failed so the wizard
        // surfaces the real error instead of spinning forever.
        const trigger = async () => {
          try {
            await runOnboardingSkill(supabase, {
              taskId,
              executorId,
              agents,
              lovableProjectUrl: lovable_project_url,
            });
          } catch (e) {
            await supabase
              .from("agent_tasks")
              .update({
                status: "failed",
                checkpoint_data: {
                  task_type: "onboarding",
                  lovable_project_url,
                  selected_agents: agents,
                  progress: initialProgress,
                  notes: `Trigger falhou: ${(e as Error).message}`,
                },
              })
              .eq("id", taskId);
          }
        };
        // Prefer EdgeRuntime.waitUntil so Deno keeps the fetch alive after we respond.
        // Falls back to fire-and-forget if not available in the runtime.
        try {
          // @ts-ignore -- EdgeRuntime is available in Supabase Edge Functions.
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
            // @ts-ignore
            EdgeRuntime.waitUntil(trigger());
          } else {
            trigger();
          }
        } catch {
          trigger();
        }

        return json({ taskId, task_id: taskId });
      }

      // Classic branch (unchanged contract).
      if (!agent_id || !title || !Array.isArray(chunks)) {
        return json({ error: "agent_id, title, chunks required" }, 400);
      }
      const { data, error } = await supabase
        .from("agent_tasks")
        .insert({
          agent_id,
          title,
          status: "running",
          chunks,
          checkpoint_data: { lastChunkDone: 0, currentChunk: chunks[0]?.id ?? 1, notes: "" },
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ taskId: data.id });
    }

    if (action === "checkpoint") {
      const {
        task_id,
        chunk_done_id,
        next_chunk_id,
        notes,
        chunks_update,
        progress,
        keep_status,
        checkpoint_data,
        file_path,
        file_content,
      } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);

      // Fetch existing checkpoint_data so we merge (never overwrite) fields
      // like progress[], task_type, lovable_project_url set by other calls.
      const { data: existing } = await supabase
        .from("agent_tasks")
        .select("checkpoint_data, status")
        .eq("id", task_id)
        .single();
      const prev = (existing?.checkpoint_data ?? {}) as Record<string, any>;

      // Merge progress: upsert per agent_id, accumulate never overwrite.
      let mergedProgress = Array.isArray(prev.progress) ? [...prev.progress] : [];
      if (Array.isArray(progress)) {
        for (const entry of progress) {
          if (!entry?.agent_id) continue;
          const idx = mergedProgress.findIndex((p: any) => p?.agent_id === entry.agent_id);
          const next = { ...entry };
          if (idx >= 0) mergedProgress[idx] = { ...mergedProgress[idx], ...next };
          else mergedProgress.push(next);
        }
      }

      const nextCheckpoint = {
        ...prev,
        ...(isPlainRecord(checkpoint_data) ? checkpoint_data : {}),
        ...(file_path !== undefined ? { file_path } : {}),
        ...(file_content !== undefined ? { file_content } : {}),
        ...(chunk_done_id !== undefined ? { lastChunkDone: chunk_done_id } : {}),
        ...(next_chunk_id !== undefined ? { currentChunk: next_chunk_id } : {}),
        ...(notes !== undefined ? { notes } : {}),
        progress: mergedProgress,
      };

      // Onboarding tasks must stay 'running' during progress updates — otherwise
      // the polling wizard would see 'checkpoint' and misread it as paused.
      const isOnboarding = prev.task_type === "onboarding";
      const nextStatus = keep_status || isOnboarding ? existing?.status ?? "running" : "checkpoint";

      const { error } = await supabase
        .from("agent_tasks")
        .update({
          status: nextStatus,
          chunks: chunks_update ?? undefined,
          checkpoint_data: nextCheckpoint,
        })
        .eq("id", task_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, progress: mergedProgress });
    }

    if (action === "resume") {
      const { task_id } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);
      const guard = await assertHumanCanMutateTask(supabase, isServiceCall, userId);
      if (!guard.ok) return json({ error: guard.error }, guard.status);

      // Lê ANTES de atualizar: para o onboarding, o que decide o que fazer é o
      // checkpoint, e marcar "running" antes de saber se dá para retomar deixaria
      // a task mentindo caso o gateway esteja fora.
      const { data: task, error: readErr } = await supabase
        .from("agent_tasks")
        .select("id, title, agent_id, chunks, checkpoint_data")
        .eq("id", task_id)
        .single();
      if (readErr) return json({ error: readErr.message }, 400);

      const cp = (task?.checkpoint_data ?? {}) as Record<string, any>;

      // Onboarding: retomar é redisparar a skill, não só trocar o status.
      // Antes, `resume` marcava a task como running e nada acontecia — o
      // progresso por agente ficava gravado sem ninguém consumir.
      if (cp.task_type === "onboarding") {
        const doneIds = new Set(
          (Array.isArray(cp.progress) ? cp.progress : [])
            .filter((p: any) => p?.status === "done")
            .map((p: any) => p?.agent_id),
        );
        const pending = (Array.isArray(cp.selected_agents) ? cp.selected_agents : [])
          .filter((id: unknown) => typeof id === "string" && !doneIds.has(id));

        // Todos já passaram: fecha em vez de deixar a task "running" esperando
        // para sempre um retorno que ninguém vai mandar.
        if (pending.length === 0) {
          await supabase
            .from("agent_tasks")
            .update({ status: "done", completed_at: new Date().toISOString() })
            .eq("id", task_id);
          return json({
            ...task,
            status: "done",
            resumed: [],
            note: "Todos os agentes já haviam sido concluídos.",
          });
        }

        const projectUrl = typeof cp.lovable_project_url === "string" ? cp.lovable_project_url : "";
        if (!projectUrl) {
          return json({ error: "Checkpoint sem lovable_project_url — não dá para retomar." }, 400);
        }

        // Aguarda o disparo (diferente do create, que responde antes): resume é
        // uma ação do usuário na tela, então ele precisa ver o erro real em vez
        // de uma task que volta a "running" e trava de novo.
        try {
          await runOnboardingSkill(supabase, {
            taskId: String(task_id),
            executorId: String(task.agent_id),
            agents: pending,
            lovableProjectUrl: projectUrl,
            resuming: true,
          });
        } catch (e) {
          return json({ error: `Falha ao retomar: ${(e as Error).message}` }, 502);
        }

        const { error: updErr } = await supabase
          .from("agent_tasks")
          .update({ status: "running" })
          .eq("id", task_id);
        if (updErr) return json({ error: updErr.message }, 400);

        return json({ ...task, status: "running", resumed: pending });
      }

      // Demais tasks: contrato inalterado.
      const { data, error } = await supabase
        .from("agent_tasks")
        .update({ status: "running" })
        .eq("id", task_id)
        .select("id, title, agent_id, chunks, checkpoint_data")
        .single();
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    if (action === "complete") {
      const { task_id, chunks_final, checkpoint_data, notes, file_path, file_content } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);
      const guard = await assertHumanCanMutateTask(supabase, isServiceCall, userId);
      if (!guard.ok) return json({ error: guard.error }, guard.status);
      const { data: existing } = await supabase
        .from("agent_tasks")
        .select("checkpoint_data")
        .eq("id", task_id)
        .single();
      const mergedCheckpoint = {
        ...(existing?.checkpoint_data ?? {}),
        ...(isPlainRecord(checkpoint_data) ? checkpoint_data : {}),
        ...(file_path !== undefined ? { file_path } : {}),
        ...(file_content !== undefined ? { file_content } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
      const { error } = await supabase
        .from("agent_tasks")
        .update({
          status: "done",
          chunks: chunks_final ?? undefined,
          checkpoint_data: mergedCheckpoint,
          completed_at: new Date().toISOString(),
        })
        .eq("id", task_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "fail") {
      const { task_id, reason } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);
      const guard = await assertHumanCanMutateTask(supabase, isServiceCall, userId);
      if (!guard.ok) return json({ error: guard.error }, guard.status);
      const { data: existing } = await supabase
        .from("agent_tasks")
        .select("checkpoint_data")
        .eq("id", task_id)
        .single();
      const merged = { ...(existing?.checkpoint_data ?? {}), notes: reason ?? "" };
      const { error } = await supabase
        .from("agent_tasks")
        .update({ status: "failed", checkpoint_data: merged })
        .eq("id", task_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "list") {
      const { agent_id, status } = body;
      let query = supabase
        .from("agent_tasks")
        .select("id, agent_id, title, status, chunks, checkpoint_data, created_at, updated_at, completed_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (agent_id) query = query.eq("agent_id", agent_id);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    if (action === "get") {
      const { task_id } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("*")
        .eq("id", task_id)
        .single();
      if (error) return json({ error: error.message }, 400);
      return json(data);
    }

    if (action === "pause") {
      const { task_id, notes } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);
      const guard = await assertHumanCanMutateTask(supabase, isServiceCall, userId);
      if (!guard.ok) return json({ error: guard.error }, guard.status);
      const { data: existing } = await supabase
        .from("agent_tasks")
        .select("checkpoint_data")
        .eq("id", task_id)
        .single();
      const merged = {
        ...(existing?.checkpoint_data ?? {}),
        notes: notes ?? existing?.checkpoint_data?.notes ?? "Pausada manualmente",
        pausedAt: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("agent_tasks")
        .update({ status: "checkpoint", checkpoint_data: merged })
        .eq("id", task_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const { task_id } = body;
      if (!task_id) return json({ error: "task_id required" }, 400);
      const guard = await assertHumanCanMutateTask(supabase, isServiceCall, userId);
      if (!guard.ok) return json({ error: guard.error }, guard.status);
      const { error } = await supabase
        .from("agent_tasks")
        .delete()
        .eq("id", task_id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action", action: rawAction || null, supported_actions: supportedActions }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
