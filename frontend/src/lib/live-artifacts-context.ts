import { api } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
/**
 * Builds system-prompt blocks that teach the current agent about:
 *   1. The <live_artifact> tag format and window.dnos runtime API.
 *   2. The user's existing live artifacts (so it can UPDATE instead of duplicating).
 *   3. The company's configured integrations with data_endpoints available
 *      for artifacts to consume.
 *
 * Called from chat-sender.toChatMessages(). All queries respect Supabase RLS
 * (they run under the logged-in user's session), so no server-side privilege
 * escalation happens here.
 */

const LIVE_ARTIFACT_FORMAT_PROMPT = `ARTEFATOS VIVOS

Você pode criar painéis HTML/JS que se atualizam automaticamente com dados reais do HS.OS e de integrações da empresa. Emita a tag abaixo (o HS.OS extrai a tag, salva o artefato e mostra um card no chat):

<live_artifact title="Título curto" refresh="30">
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
  <script>
    async function load() {
      // Dados externos: SEMPRE via módulos por integração
      const campaigns = await window.dnos.meta.campaigns({
        account_id: 'act_xxx',
        date_preset: 'last_30d',
        fields: 'name,spend,impressions,ctr'
      })

      // Dados internos do Supabase (RLS aplicado)
      const results = await window.dnos.query('agent_results', {
        select: 'title, value, created_at',
        order: { column: 'created_at', ascending: false },
        limit: 5
      })

      // Se chegou aqui os dados são reais — renderize
      renderChart(campaigns.data, results)
    }
    load()
    window.dnos.onRefresh(load)
  </script>
</body>
</html>
</live_artifact>

API window.dnos:
- window.dnos.<integracao>.<endpoint>(params) → chama endpoint externo (ex.: window.dnos.meta.campaigns({...})). Use SEMPRE este formato para dados externos.
- window.dnos.query(table, { select, filters, order, limit }) → linhas de tabela interna respeitando RLS.
- window.dnos.onRefresh(cb) → callback executado a cada refresh (automático ou manual).
- window.dnos.refreshInterval → segundos (0 = manual). window.dnos.lastRefreshed → Date do último refresh.
- window.dnos.user → { id, email, role, name } do usuário logado.
- window.dnos.showError('mensagem') → exibe overlay de erro visível ao usuário.

REGRAS OBRIGATÓRIAS (não negociáveis):
- PROIBIDO usar try/catch que retorne dados fictícios como fallback. Se a API falhar, o overlay de erro é automático — não invente valores.
- PROIBIDO hardcodar números, listas ou métricas simulando dados reais. Todo valor exibido deve vir de window.dnos.
- PROIBIDO chamar window.dnos.invoke diretamente. Use os módulos por integração (window.dnos.<integracao>.<endpoint>).
- Se quiser sinalizar erro manualmente, use window.dnos.showError(...) — nunca renderize dados falsos.
- \`refresh\` em segundos (0 = manual). Padrão 30.
- Para ATUALIZAR um artefato vivo existente: <live_artifact id="[UUID]" title="..." refresh="30">HTML</live_artifact>. O id DEVE ser o UUID exato listado no bloco "Artefatos vivos existentes" (formato 8-4-4-4-12). PROIBIDO inventar id, usar slug (ex.: "metodo-organogramia-v3"), abreviar UUID ou colocar "...". Se não tiver o UUID, omita o atributo id e emita como novo — o HS.OS deduplica por título automaticamente.
- Sempre inclua o HTML completo dentro da tag. Sem placeholders, sem arquivos externos além de CDNs.

GERAÇÃO DE DOCUMENTOS (PDF/DOCX) — REGRA IMPERATIVA

Quando o usuário pedir para "gerar/baixar/receber/me mandar/exportar" um PDF, Word, DOCX, relatório, proposta, contrato, planilha narrativa ou qualquer documento para download, você DEVE emitir a tag <generate_document>. O HS.OS gera o arquivo no backend, salva com segurança e mostra um card com botão "Baixar" no chat.

Formato:

<generate_document type="pdf" title="Título curto do documento">
{ "content": [ { "text": "Título", "style": "header" }, { "text": "Corpo do documento..." } ], "styles": { "header": { "fontSize": 18, "bold": true } }, "defaultStyle": { "fontSize": 11 } }
</generate_document>

Para DOCX use type="docx" e uma definição simplificada:

<generate_document type="docx" title="Proposta Comercial">
{ "title": "Proposta Comercial", "sections": [ { "heading": "H1", "text": "Contexto" }, { "text": "Texto do parágrafo..." }, { "heading": "H2", "text": "Escopo" }, { "text": "Detalhamento..." } ] }
</generate_document>

Regras (não negociáveis):
- PROIBIDO responder "PDF gerado com sucesso", "aqui está o Word", "documento pronto" ou qualquer variante SEM emitir a tag <generate_document>. Se não emitiu a tag, o arquivo não existe.
- PROIBIDO colar o conteúdo do documento como texto/markdown no chat no lugar do arquivo.
- PROIBIDO usar <live_artifact> para entregar PDF/DOCX. A tag <live_artifact> é APENAS para painéis interativos ao vivo (dashboards, gráficos, controles).
- PROIBIDO montar <a download href="blob:..."> ou usar window.dnos.downloadPDF/downloadDOCX para essa finalidade — a via oficial de arquivo é <generate_document>.
- O JSON dentro da tag deve ser JSON válido. Para PDF siga o formato do pdfmake (chaves content, styles, defaultStyle, pageSize, pageMargins, table etc.). Para DOCX use { title, sections: [{ heading?: 'H1'|'H2'|'H3', text, bold?, italic? }] }.
- Você pode acompanhar a tag com uma frase curta ("Aqui está o relatório:") antes ou depois — mas a tag é obrigatória.

Exemplo mínimo de resposta correta a "me gere um PDF com um resumo":

Aqui está o resumo:

<generate_document type="pdf" title="Resumo">
{ "content": [ { "text": "Resumo", "style": "header" }, { "text": "Conteúdo do resumo..." } ], "styles": { "header": { "fontSize": 18, "bold": true, "marginBottom": 8 } } }
</generate_document>`;


function canonicalIntegrationType(row: {
  integration_type?: string | null;
  name?: string | null;
  key_name?: string | null;
}): string {
  const rawType = (row.integration_type ?? "").toString().toLowerCase();
  const name = (row.name ?? "").toString().toLowerCase();
  const keyName = (row.key_name ?? "").toString().toLowerCase();

  if (rawType === "meta" || name.includes("meta") || keyName.includes("meta") || keyName.includes("prisma_user_token")) {
    return "meta";
  }

  return rawType;
}

const FALLBACK_DATA_ENDPOINTS: Record<string, Record<string, { description: string; params: string[] }>> = {
  meta: {
    insights: {
      description: "Meta Ads Insights por campanha, conjunto, anúncio ou conta",
      params: ["level", "fields", "date_preset", "time_range", "account_id"],
    },
    campaigns: {
      description: "Campanhas Meta Ads com métricas de investimento e performance",
      params: ["fields", "date_preset", "time_range", "account_id"],
    },
  },
};

export async function buildLiveArtifactsSystemBlocks(): Promise<string[]> {
  const blocks: string[] = [LIVE_ARTIFACT_FORMAT_PROMPT];

  // Existing user artifacts (RLS scopes to auth.uid())
  try {
    const todos = await api<any[]>("/artefatos/vivos").catch(() => []);
    const artifacts = (todos ?? []).slice(0, 5);

    if (Array.isArray(artifacts) && artifacts.length > 0) {
      const lines = (artifacts as any[]).map((a) => {
        const refresh =
          a.refresh_interval > 0 ? `refresh: ${a.refresh_interval}s` : "estático";
        const by = a.agent_id ? ` — criado por ${a.agent_id}` : "";
        return `- "${a.title}" (id: ${a.id}, ${refresh})${by}`;
      });
      blocks.push(
        [
          "Artefatos vivos existentes deste usuário:",
          ...lines,
          "",
          'Para ATUALIZAR um existente: <live_artifact id="[id]" title="..." refresh="30">HTML</live_artifact>',
          'Para CRIAR um novo: <live_artifact title="..." refresh="30">HTML</live_artifact>',
        ].join("\n"),
      );
    }
  } catch {
    /* ignore */
  }

  // Integrations with data_endpoints available for artifacts to consume
  try {
    const [integrationsRes, templatesRes] = await Promise.all([
      supabase
        .from("integrations")
        .select("integration_type, name, key_name, is_configured")
        .eq("is_configured", true),
      supabase
        .from("integration_templates")
        .select("integration_type, label, playbook"),
    ]);

    const configured = new Map<string, string>();
    for (const row of (integrationsRes.data ?? []) as any[]) {
      const key = canonicalIntegrationType(row);
      if (key) configured.set(key, row.name ?? key);
    }

    const endpointLines: string[] = [];
    for (const tpl of (templatesRes.data ?? []) as any[]) {
      const key = (tpl.integration_type ?? "").toString().toLowerCase();
      if (!key || !configured.has(key)) continue;
      const dataEndpoints = tpl.playbook?.data_endpoints;
      if (!dataEndpoints || typeof dataEndpoints !== "object") continue;
      for (const [name, def] of Object.entries<any>(dataEndpoints)) {
        const desc = def?.description ? ` — ${def.description}` : "";
        const params = Array.isArray(def?.params) && def.params.length > 0
          ? ` (params: ${def.params.join(", ")})`
          : "";
        endpointLines.push(`- window.dnos.${key}.${name}(${Array.isArray(def?.params) && def.params.length > 0 ? `{ ${def.params.join(", ")} }` : ""})${desc}`);
      }
    }

    for (const [key, endpoints] of Object.entries(FALLBACK_DATA_ENDPOINTS)) {
      if (!configured.has(key)) continue;
      for (const [name, def] of Object.entries(endpoints)) {
        endpointLines.push(`- window.dnos.${key}.${name}({ ${def.params.join(", ")} }) — ${def.description}`);
      }
    }

    if (endpointLines.length > 0) {
      blocks.push(
        [
          "Módulos de integração disponíveis para artefatos vivos (chame diretamente, sem try/catch com fallback):",
          ...endpointLines,
          "",
          "Tabelas internas via: window.dnos.query('<tabela>', { ... })",
        ].join("\n"),
      );
    }
  } catch {
    /* ignore */
  }

  // Whitelist of internal tables the agent may query via window.dnos.query().
  // Prevents hallucinated table names like 'contacts' that don't exist.
  blocks.push(
    [
      "Tabelas internas disponíveis para window.dnos.query('<tabela>', {...}) — use APENAS estas:",
      "- agent_results (title, value, agent_id, created_at) — resultados/entregas de agentes",
      "- agent_tasks (title, status, agent_id, created_at) — tarefas dos agentes",
      "- agent_activity_log (agent_id, action, timestamp) — log de atividades",
      "- conversations (agent_id, user_id, role, content, created_at) — histórico de chat",
      "- channel_messages (channel_id, author_id, content, created_at) — mensagens de canais",
      "- channels (id, name, type, created_at)",
      "- automations (name, agent_id, is_active, last_run_at, last_run_status)",
      "- automation_runs (automation_id, status, created_at)",
      "- profiles (id, email, full_name, status) — usuários do time",
      "- live_artifacts (title, agent_id, updated_at)",
      "- artifacts_published (title, slug, created_at)",
      "- notifications, drafts, wiki_documents, wiki_spaces, teams, team_agents, skills, agent_skills",
      "",
      "PROIBIDO consultar tabelas fora desta lista (ex.: 'contacts', 'customers', 'leads' NÃO existem neste projeto). Se o dado desejado não existir, use window.dnos.showError('...') explicando o que falta em vez de inventar uma tabela.",
    ].join("\n"),
  );

  return blocks;
}
