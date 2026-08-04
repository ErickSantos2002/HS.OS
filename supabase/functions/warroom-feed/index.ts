/**
 * warroom-feed — o estado da operação, para a tela de parede.
 *
 * Esta função é a única porta do painel — nenhuma tabela fica aberta para
 * anônimo. Autentica de dois jeitos: pelo token dedicado da TV
 * (app_settings.warroom_token, na URL) ou pela sessão de quem já está logado
 * e espelha a tela de um computador.
 *
 * Devolve SÓ estado agregado — quem está trabalhando, em quê, e os números do
 * dia. Nenhum conteúdo de conversa sai daqui.
 *
 * Tudo vem de dados MEDIDOS (task #19): turnos em voo, sub-agentes vivos,
 * eventos de uso e a janela de contexto que a varredura mantém.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGatewayConfig } from "../_shared/gateway-config.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Padrão quando app_settings não define — mesmo número do watchdog. */
const LONGO_MIN_PADRAO = 8;

/**
 * Nome das rotinas, para o fluxo dizer "rodou a varredura de concorrentes" em
 * vez de "rodou uma rotina".
 *
 * A chave da sessão de um cron carrega o id do job (agent:lia:cron:9ed938dd…),
 * e o gateway sabe traduzir id em nome — que é texto escrito por gente, não
 * conteúdo de conversa: seguro numa parede que qualquer um vê.
 *
 * Cache de 5 minutos em escopo de módulo: a parede consulta a cada 4s e uma
 * ida ao gateway por leitura seria desperdício. Rotina raramente é renomeada.
 */
let cacheCrons: { em: number; nomes: Map<string, string> } | null = null;

async function nomesDeRotina(supabase: SupabaseClient): Promise<Map<string, string>> {
  if (cacheCrons && Date.now() - cacheCrons.em < 5 * 60_000) return cacheCrons.nomes;
  const nomes = new Map<string, string>();
  try {
    const gw = await getGatewayConfig(supabase);
    if (gw?.token && gw?.url) {
      const r = await fetch(`${gw.url}/api/v1/admin/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${gw.token}` },
        body: JSON.stringify({ method: "cron.list", params: {} }),
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const j = await r.json();
        const jobs = j?.payload?.jobs ?? j?.payload ?? j?.result?.jobs ?? j?.result ?? [];
        for (const job of Array.isArray(jobs) ? jobs : []) {
          const id = typeof job?.id === "string" ? job.id : null;
          const nome = typeof job?.name === "string" ? job.name.trim() : "";
          if (id && nome) nomes.set(id, nome);
        }
      }
    }
  } catch {
    // Gateway fora do ar não pode derrubar a parede: sem nome, o fluxo cai no
    // texto genérico, que é o comportamento de antes.
  }
  // Rotina criada pelo agendador do dn.os se chama dnos-auto-<id>-<timestamp>
  // (automation-scheduler). Esse nome na parede seria pior que "rodou uma
  // rotina" — mas o nome que alguém escreveu está no nosso próprio banco.
  const autos = new Map<string, string[]>();
  for (const [id, nome] of nomes) {
    const m = /^dnos-auto-([0-9a-f-]{36})-\d+$/i.exec(nome);
    if (m) {
      const lista = autos.get(m[1]) ?? [];
      lista.push(id);
      autos.set(m[1], lista);
    }
  }
  if (autos.size > 0) {
    const { data } = await supabase
      .from("automations").select("id, name").in("id", [...autos.keys()]);
    for (const a of data ?? []) {
      const bom = typeof a?.name === "string" ? a.name.trim() : "";
      if (!bom) continue;
      for (const id of autos.get(a.id) ?? []) nomes.set(id, bom);
    }
    // Sem nome legível, é melhor calar: o genérico "rodou uma rotina" diz
    // menos, mas não polui a parede com um uuid.
    for (const [chave, ids] of autos) {
      if ((data ?? []).some((a) => a.id === chave)) continue;
      for (const id of ids) nomes.delete(id);
    }
  }

  cacheCrons = { em: Date.now(), nomes };
  return nomes;
}

/**
 * Nome de rotina é escrito por engenheiro, não para uma parede:
 * "monitor-recursos-vps", "healthcheck:security-audit". Aqui ele vira legível.
 *
 * Só mexe em identificador — nome que já tem espaço e maiúscula ("Lia — Memory
 * Index Sync") passa intacto, porque alguém já escreveu aquilo para ser lido.
 */
const SIGLAS = new Set(["vps", "db", "api", "crm", "llm", "cs", "seo", "kpi", "ia", "url", "os", "mkt"]);

function humanizar(bruto: string, agente: string): string {
  let n = bruto.trim().replace(/^cron:\s*/i, "");
  // "Lia — Memory Index Sync" com o card já dizendo Lia vira repetição.
  n = n.replace(new RegExp(`^${agente}\\s*[—–-]\\s*`, "i"), "").trim();
  const pareceIdentificador = !/\s/.test(n) && /[-_:.]/.test(n);
  if (pareceIdentificador) {
    n = n.replace(/[-_:.]+/g, " ").replace(/\s+/g, " ").trim();
    n = n.split(" ").map((w, i) =>
      SIGLAS.has(w.toLowerCase()) ? w.toUpperCase()
        : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1)
        : w).join(" ");
  }
  return n;
}

/** Id do job dentro da chave da sessão: agent:lia:cron:<id>[:...] */
function idDaRotina(chave: string | null | undefined): string | null {
  const m = /:cron:([^:\s]+)/i.exec(chave ?? "");
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Dois caminhos de acesso, porque há dois cenários reais:
    //  1. A TV, que não faz login → token dedicado na URL (?k=…)
    //  2. Alguém do time espelhando de um computador já logado → a própria
    //     sessão basta, e nenhuma chave precisa aparecer na barra do navegador
    const url = new URL(req.url);
    // A chave pode vir na URL (TV autônoma) ou no corpo (o invoke do app
    // manda POST). Quem está logado nem precisa dela.
    let doCorpo = "";
    let layoutParaSalvar: unknown = null;
    try {
      const b = await req.json();
      doCorpo = typeof b?.k === "string" ? b.k.trim() : "";
      if (b?.salvarLayout && typeof b.salvarLayout === "object") layoutParaSalvar = b.salvarLayout;
    } catch { /* sem corpo */ }
    const enviado = (url.searchParams.get("k") ?? doCorpo).trim();
    let liberado = false;
    let espectador: string | null = null;

    if (enviado) {
      const { data: cfg } = await supabase
        .from("app_settings").select("value").eq("key", "warroom_token").maybeSingle();
      const esperado = typeof cfg?.value === "string" ? cfg.value : String(cfg?.value ?? "");
      liberado = !!esperado && enviado === esperado;
    }

    if (!liberado) {
      const auth = req.headers.get("Authorization") ?? "";
      const jwt = auth.replace(/^Bearer\s+/i, "").trim();
      if (jwt) {
        // Valida direto pelo cliente de serviço: não depende da anon key nem
        // de repassar o header, e funciona com o sistema de signing keys.
        const { data: quem, error } = await supabase.auth.getUser(jwt);
        if (error) console.error("[warroom-feed] jwt inválido:", error.message);
        liberado = !!quem?.user;
        // Quem está assistindo aparece na parede — ver o próprio nome no
        // organograma é metade da graça de "humanos e agentes no mesmo time".
        if (quem?.user?.id) espectador = quem.user.id;
      }
    }


    if (!liberado) return json({ error: "Unauthorized" }, 401);

    // Salvar o mapa é ato de quem está logado. A TV (que entra por token) só
    // exibe — uma tela de parede não deve poder reorganizar o organograma.
    if (layoutParaSalvar) {
      if (!espectador) return json({ error: "Só quem está logado pode salvar o mapa." }, 403);
      const { error } = await supabase.from("app_settings")
        .upsert({ key: "warroom_layout", value: layoutParaSalvar, updated_at: new Date().toISOString() },
                { onConflict: "key" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, salvo: true });
    }

    const agora = Date.now();
    // "Trabalho longo" na parede é o MESMO limite que o watchdog usa para
    // avisar no chat — a tela não pode ter uma definição própria de demora.
    const { data: cfgLongo } = await supabase
      .from("app_settings").select("value").eq("key", "watchdog_soft_minutes").maybeSingle();
    const LONGO_MS = (Number(cfgLongo?.value) || LONGO_MIN_PADRAO) * 60_000;
    const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
    // Janela do fluxo: 1 hora DESLIZANTE. Evento envelhece e sai sozinho, sem
    // virada brusca — corte no minuto cheio deixaria a parede em branco na hora
    // errada, e tela vazia numa TV de vitrine lê como "quebrou".
    const JANELA_MS = 3600_000;
    const janela = new Date(agora - JANELA_MS).toISOString();

    const [perfis, pessoas, turnos, filhotes, contexto, uso, conversas, rodando, entregues, mensagensEntreAgentes] =
      await Promise.all([
        // Sem created_at: essa coluna NÃO existe em agent_profiles, e pedi-la
        // fazia a consulta inteira falhar — a parede aparecia só com pessoas.
        // sort_order dá posição estável na constelação.
        // select("*") de propósito: pedir coluna por nome já derrubou esta
        // consulta duas vezes (created_at não existe aqui), e o Postgres
        // rejeita a query INTEIRA quando uma coluna não existe — a parede
        // aparecia sem nenhum agente, sem dizer por quê.
        supabase.from("agent_profiles").select("*").limit(50),
        supabase.from("profiles").select("*").limit(40),
        // Turnos em voo = agente pensando agora
        supabase.from("agent_turns")
          .select("agent_id, user_id, session_key, dispatched_at, source, origin_agent_id")
          .eq("status", "pending").order("dispatched_at", { ascending: true }).limit(50),
        // Sub-agentes vivos = satélites orbitando quem os criou
        // Vivos E os que concluíram há pouco: sub-agente que nasce e morre em
        // 20s nunca seria visto pela varredura de 1 minuto, e o enxame — que é
        // a imagem mais forte da parede — passaria despercebido.
        // first_seen_at entra por dois motivos: o fluxo narra o NASCIMENTO do
        // sub-agente ("Lia acionou…"), e o filtro precisa alcançar a última
        // hora — só "vivo ou concluído há 3 min" escondia do fluxo todo
        // enxame que já tinha terminado.
        supabase.from("subagent_watch")
          .select("agent_id, label, child_key, completed_at, first_seen_at")
          .or(`completed_at.is.null,completed_at.gte.${new Date(Date.now() - 3 * 60_000).toISOString()},first_seen_at.gte.${janela}`)
          .limit(60),
        supabase.from("agent_context_state")
          .select("agent_id, total_tokens, context_tokens, updated_at")
          .order("updated_at", { ascending: false }).limit(200),
        supabase.from("usage_events")
          .select("agent_id, kind, label, session_key, total_tokens, cached_tokens, input_tokens, cost_usd, ts")
          .gte("ts", inicioDia.toISOString()).order("ts", { ascending: false }).limit(3000),
        supabase.from("conversations")
          .select("agent_id, user_id, role, created_at")
          .gte("created_at", inicioDia.toISOString()).eq("role", "user").limit(2000),
        // Rotina em execução. Sem isto o agente fica "ocioso" enquanto
        // trabalha: turno só existe para conversa, e a maior parte do que a
        // operação faz é automação — justo o que a parede deveria mostrar.
        supabase.from("automation_runs")
          .select("automation_id, started_at, status")
          .eq("status", "running").gte("started_at", new Date(agora - 30 * 60_000).toISOString())
          .order("started_at", { ascending: true }).limit(40),
        supabase.from("agent_turns")
          .select("agent_id, user_id, delivered_at, source, origin_agent_id")
          .eq("status", "delivered").gte("delivered_at", janela)
          .order("delivered_at", { ascending: false }).limit(30),
        // Conversa agente→agente por DENTRO do gateway (sessions_send). O
        // caminho de canal registra origem em agent_turns; este não passa
        // pelo dn.os — a única testemunha é o plugin de atividade da VPS.
        // Sem esta consulta, Lia acionando Kira era invisível na parede.
        supabase.from("agent_activity")
          .select("agent_id, metadata, created_at, status, updated_at")
          .eq("metadata->>tool_name", "sessions_send")
          .gte("created_at", janela)
          .order("created_at", { ascending: false }).limit(30),
      ]);

    // Consulta que falha nunca mais some calada: o aviso sobe até a tela.
    const avisos: string[] = [];
    if (perfis.error) avisos.push(`agentes: ${perfis.error.message}`);
    if (pessoas.error) avisos.push(`pessoas: ${pessoas.error.message}`);
    if (rodando.error) avisos.push(`rotinas em voo: ${rodando.error.message}`);
    if (turnos.error) avisos.push(`turnos: ${turnos.error.message}`);
    if (uso.error) avisos.push(`uso: ${uso.error.message}`);
    if (avisos.length) console.error("[warroom-feed] consultas com erro:", avisos.join(" | "));

    const nomePessoa = new Map<string, string>();
    for (const p of pessoas.data ?? []) {
      if ((p.status ?? "active") === "inactive") continue;
      const nome = (p.full_name ?? "").trim();
      const doEmail = (p.email ?? "").split("@")[0];
      nomePessoa.set(p.id, nome ? nome.split(/\s+/)[0] : (doEmail || "alguém"));
    }

    // Última janela de contexto conhecida por agente (a lista já vem ordenada).
    const ctxPorAgente = new Map<string, number>();
    for (const c of contexto.data ?? []) {
      if (ctxPorAgente.has(c.agent_id)) continue;
      const janela = Number(c.context_tokens) || 0;
      if (janela > 0) ctxPorAgente.set(c.agent_id, Math.min(1, (Number(c.total_tokens) || 0) / janela));
    }

    // Sub-agente sem rótulo vira "sub-agente 1, 2, 3…" em vez do fragmento do
    // id (a23f9ad1). Na parede, um número diz muito mais que um hexadecimal.
    const filhosPorAgente = new Map<string, { nome: string; vivo: boolean }[]>();
    for (const f of filhotes.data ?? []) {
      // Satélite na constelação segue a regra antiga (vivo ou recém-morto);
      // o resto da janela de 1h existe só para o fluxo, logo abaixo.
      if (f.completed_at && agora - new Date(f.completed_at).getTime() > 3 * 60_000) continue;
      const lista = filhosPorAgente.get(f.agent_id) ?? [];
      const rotulo = (f.label ?? "").trim();
      lista.push({ nome: rotulo || `sub-agente ${lista.length + 1}`, vivo: !f.completed_at });
      filhosPorAgente.set(f.agent_id, lista);
    }

    // Último rótulo de trabalho visto por agente — é o "está fazendo o quê".
    const ultimoRotulo = new Map<string, string>();
    for (const e of uso.data ?? []) {
      if (!e.label || ultimoRotulo.has(e.agent_id)) continue;
      ultimoRotulo.set(e.agent_id, e.label);
    }

    // A execução guarda o id da automação; o agente e o nome estão na
    // automação. Uma consulta a mais só quando há rotina rodando.
    const rotinaViva = new Map<string, { desde: string; nome: string }>();
    const idsRodando = [...new Set((rodando.data ?? []).map((r) => r.automation_id).filter(Boolean))];
    if (idsRodando.length > 0) {
      const { data: defs } = await supabase
        .from("automations").select("id, name, agent_id").in("id", idsRodando);
      const porId = new Map((defs ?? []).map((d) => [d.id, d]));
      for (const r of rodando.data ?? []) {
        const d = porId.get(r.automation_id);
        if (!d?.agent_id || rotinaViva.has(d.agent_id)) continue;
        rotinaViva.set(d.agent_id, { desde: r.started_at, nome: (d.name ?? "").trim() });
      }
    }

    const turnoPorAgente = new Map<string, {
      desde: string; user_id: string | null; session_key: string | null;
      source: string; origem_agente: string | null;
    }>();
    for (const t of turnos.data ?? []) {
      if (turnoPorAgente.has(t.agent_id)) continue;
      turnoPorAgente.set(t.agent_id, {
        desde: t.dispatched_at, user_id: t.user_id,
        session_key: t.session_key, source: t.source ?? "dm",
        origem_agente: t.origin_agent_id ?? null,
      });
    }

    const nomesDeAgente = new Map<string, string>(
      (perfis.data ?? []).map((a) => [
        a.agent_id,
        a.name || (String(a.agent_id).charAt(0).toUpperCase() + String(a.agent_id).slice(1)),
      ]),
    );

    // Quem está EM conversa com quem, via gateway. O tool_input do plugin é o
    // NOME do destino ("Kira") — minúsculo vira o id.
    //
    // O fecho da linha é o próprio sessions_send: ele fica "in_progress"
    // enquanto espera a resposta e vira "completed" quando ela chega. A regra
    // anterior (3 minutos fixos) deixava a linha acesa depois da conversa
    // acabar — "é necessário que feche quando a conversa acabar" (02/08).
    // Fica um eco de 30s após o fecho para o olho alcançar; e um teto de 10
    // minutos protege de linha órfã se o report de conclusão se perder.
    const ECO_MS = 30_000, TETO_MS = 10 * 60_000;
    const recebeuDe = new Map<string, { de: string; quando: string }>();
    for (const m of mensagensEntreAgentes.data ?? []) {
      const destino = String((m.metadata as Record<string, unknown> | null)?.tool_input ?? "")
        .trim().toLowerCase();
      if (!destino || !nomesDeAgente.has(destino) || destino === m.agent_id) continue;
      const emVoo = m.status === "in_progress" && agora - new Date(m.created_at).getTime() < TETO_MS;
      const ecoRecente = agora - new Date(m.updated_at ?? m.created_at).getTime() < ECO_MS;
      if (!emVoo && !ecoRecente) continue;
      if (recebeuDe.has(destino)) continue; // já tem a mais recente
      recebeuDe.set(destino, { de: m.agent_id, quando: m.created_at });
    }

    const agentes = (perfis.data ?? [])
      .filter((a) => (a.status ?? "active") !== "inactive")
      // Ordem estável: sort_order quando existe, senão o id. A posição de cada
      // agente na constelação não pode dançar entre uma leitura e outra.
      .sort((a, b) =>
        (a.sort_order ?? 999) - (b.sort_order ?? 999) || String(a.agent_id).localeCompare(String(b.agent_id)))
      .map((a) => {
      const turno = turnoPorAgente.get(a.agent_id);
      const filhos = filhosPorAgente.get(a.agent_id) ?? [];
      let estado: "ocioso" | "pensando" | "longo" = "ocioso";
      let tarefa: string | null = null;
      let desde: string | null = null;

      if (turno) {
        desde = turno.desde;
        estado = agora - new Date(turno.desde).getTime() > LONGO_MS ? "longo" : "pensando";
        // Descreve o TRABALHO, nunca o conteúdo: nome de quem falou, ou o
        // rótulo da rotina/tarefa.
        const quem = turno.user_id ? nomePessoa.get(turno.user_id) : null;
        const outroAgente = turno.origem_agente;
        // Canal e conversa direta são trabalhos diferentes na leitura de quem
        // olha a parede: um é o time todo vendo, o outro é dois a dois. E
        // agente atendendo agente é a terceira história — a mais forte das
        // três numa tela que existe para mostrar humanos e IAs no mesmo time.
        tarefa = outroAgente
          ? `atendendo ${nomesDeAgente.get(outroAgente) ?? outroAgente}`
          : quem
          ? (turno.source === "channel" ? `respondendo ${quem} num canal` : `conversando com ${quem}`)
          : (ultimoRotulo.get(a.agent_id) ?? "processando");
      } else if (rotinaViva.has(a.agent_id)) {
        const r = rotinaViva.get(a.agent_id)!;
        desde = r.desde;
        estado = agora - new Date(r.desde).getTime() > LONGO_MS ? "longo" : "pensando";
        tarefa = r.nome || "executando uma rotina";
      } else if (filhos.some((f) => f.vivo)) {
        estado = "pensando";
        const vivos = filhos.filter((f) => f.vivo).length;
        tarefa = `coordenando ${vivos} sub-agente${vivos > 1 ? "s" : ""}`;
      } else if (recebeuDe.has(a.agent_id)) {
        // Acionado por outro agente via gateway: não existe turno em
        // agent_turns para este trabalho — a mensagem do plugin é a única
        // evidência, e ela basta para a linha IA→IA aparecer na parede.
        const r = recebeuDe.get(a.agent_id)!;
        estado = "pensando";
        desde = r.quando;
        tarefa = `atendendo ${nomesDeAgente.get(r.de) ?? r.de}`;
      }

      return {
        id: a.agent_id,
        // Sem nome cadastrado, capitaliza o id: "lia" na parede fica pobre.
        nome: a.name || (a.agent_id.charAt(0).toUpperCase() + a.agent_id.slice(1)),
        papel: (a.role || a.department || "").toString().toLowerCase() || "agente",
        estado, tarefa, desde,
        // Quem pediu, quando quem pediu foi outro agente: é o que permite
        // desenhar a linha de IA para IA no grafo. Vale tanto o turno de
        // canal (agent_turns) quanto a mensagem interna do gateway.
        parceiroAgente: turno?.origem_agente ?? recebeuDe.get(a.agent_id)?.de ?? null,
        contexto: ctxPorAgente.get(a.agent_id) ?? 0,
        filhos,
        parceiro: turno?.user_id ? nomePessoa.get(turno.user_id) ?? null : null,
      };
    });

    // ── números do dia, do que foi medido ──
    let tokens = 0, custo = 0, entrada = 0, cache = 0;
    for (const e of uso.data ?? []) {
      tokens += Number(e.total_tokens) || 0;
      custo += Number(e.cost_usd) || 0;
      entrada += Number(e.input_tokens) || 0;
      cache += Number(e.cached_tokens) || 0;
    }

    // ── fluxo: o que acabou de acontecer ──
    type Ev = { ts: string; tipo: "entrega" | "autonomo" | "conversa"; texto: string };
    // Trabalho de CONVERSA já entra no fluxo pelo turno entregue ("Kira
    // respondeu Rodrigo"). O consumo de tokens da mesma conversa produziria
    // uma segunda linha dizendo a mesma coisa com menos informação.
    const CONVERSA = new Set(["dm", "channel"]);
    const eventos: Ev[] = [];
    const nomeAgente = new Map(agentes.map((a) => [a.id, a.nome]));

    // Sub-agente nasceu = alguém delegou. É trabalho tão real quanto uma
    // entrega, e o fluxo não contava ("a lia chamou sub agentes e no fluxo
    // não apareceu" — 02/08).
    for (const f of filhotes.data ?? []) {
      if (!f.first_seen_at || f.first_seen_at < janela) continue;
      const rotulo = (f.label ?? "").trim();
      eventos.push({
        ts: f.first_seen_at,
        tipo: "conversa",
        texto: rotulo
          ? `<b>${nomeAgente.get(f.agent_id) ?? f.agent_id}</b> acionou o sub-agente <b>${rotulo}</b>`
          : `<b>${nomeAgente.get(f.agent_id) ?? f.agent_id}</b> acionou um sub-agente`,
      });
    }

    // Conversa interna do gateway na última hora — o fluxo conta a história
    // que o grafo só mostra por 3 minutos.
    for (const m of mensagensEntreAgentes.data ?? []) {
      const destino = String((m.metadata as Record<string, unknown> | null)?.tool_input ?? "")
        .trim().toLowerCase();
      if (!destino || !nomesDeAgente.has(destino) || destino === m.agent_id) continue;
      eventos.push({
        ts: m.created_at,
        tipo: "conversa",
        texto: `<b>${nomeAgente.get(m.agent_id) ?? m.agent_id}</b> acionou <b>${nomesDeAgente.get(destino) ?? destino}</b>`,
      });
    }

    for (const t of entregues.data ?? []) {
      const quem = t.user_id ? nomePessoa.get(t.user_id) : null;
      eventos.push({
        ts: t.delivered_at,
        tipo: "entrega",
        texto: t.origin_agent_id
          ? `<b>${nomeAgente.get(t.agent_id) ?? t.agent_id}</b> atendeu <b>${nomesDeAgente.get(t.origin_agent_id) ?? t.origin_agent_id}</b>`
          : quem
          ? `<b>${nomeAgente.get(t.agent_id) ?? t.agent_id}</b> respondeu <b>${quem}</b>${t.source === "channel" ? " no canal" : ""}`
          : `<b>${nomeAgente.get(t.agent_id) ?? t.agent_id}</b> entregou`,
      });
    }
    // Todo trabalho medido entra, não só cron/subagent: filtrar por tipo de
    // sessão fazia a parede mostrar um agente quando cinco trabalharam.
    //
    // Mas cada linha de usage_events é UMA chamada de LLM, e uma tarefa vira
    // dez — sem agrupar, o fluxo viraria dez linhas idênticas empilhadas.
    // Chamadas seguidas do mesmo agente com o mesmo rótulo, separadas por menos
    // de 10 minutos, são a mesma tarefa e viram uma linha só. O intervalo
    // importa: uma rotina que roda de meia em meia hora tem que aparecer como
    // duas execuções, não como uma.
    const rotinas = await nomesDeRotina(supabase);
    // Frase escrita a partir da INSTRUÇÃO da rotina (routine-phrases). É o que
    // diz o que ela FAZ — nome de cron não diz. Sem frase, cai no nome tratado.
    const { data: frasesRotina } = await supabase
      .from("routine_phrases").select("cron_id, frase");
    const frasePorCron = new Map((frasesRotina ?? []).map((f) => [f.cron_id, f.frase]));
    const GRUPO_MS = 10 * 60_000;
    const autonomos: Ev[] = [];
    let anteriorChave = "", anteriorTs = 0;
    for (const e of uso.data ?? []) {
      if (CONVERSA.has(e.kind ?? "")) continue;
      const chave = `${e.agent_id}|${e.label ?? ""}|${e.kind ?? ""}`;
      const quando = new Date(e.ts).getTime();
      if (chave === anteriorChave && anteriorTs - quando < GRUPO_MS) { anteriorTs = quando; continue; }
      anteriorChave = chave; anteriorTs = quando;
      const idRotina = e.kind === "cron" ? (idDaRotina(e.session_key) ?? "") : "";
      const nomeDele = nomeAgente.get(e.agent_id) ?? e.agent_id;
      const cru = idRotina ? rotinas.get(idRotina) : null;
      const rotina = frasePorCron.get(idRotina) ?? (cru ? humanizar(cru, nomeDele) : null);
      // Separador em vez de verbo: "Lia rodou Lia — Memory Index Sync" é o que
      // dá quando se tenta encaixar frase em nome que já é frase.
      const oQue = rotina ? `· ${rotina}`
        : e.label
        ?? (e.kind === "cron" ? "rodou uma rotina"
          : e.kind === "subagent" ? "concluiu um sub-agente"
          : "trabalhou");
      autonomos.push({
        ts: e.ts,
        tipo: "autonomo",
        texto: `<b>${nomeAgente.get(e.agent_id) ?? e.agent_id}</b> ${oQue}`,
      });
    }

    // Piso: se a última hora rendeu pouco, mostra os mais recentes mesmo que
    // mais velhos. O horário ao lado deixa a idade explícita — a parede fica
    // honesta sem ficar vazia.
    const naJanela = autonomos.filter((e) => e.ts >= janela);
    eventos.push(...(naJanela.length >= 6 ? naJanela : autonomos.slice(0, 10)));
    eventos.sort((a, b) => (a.ts < b.ts ? 1 : -1));

    // "há quantos dias no ar" sai do primeiro consumo já medido — é o registro
    // mais antigo que temos da operação de fato rodando.
    const { data: cfgLayout } = await supabase
      .from("app_settings").select("value").eq("key", "warroom_layout").maybeSingle();

    const { data: primeiro } = await supabase
      .from("usage_events").select("ts").order("ts", { ascending: true }).limit(1).maybeSingle();
    const diasNoAr = primeiro?.ts
      ? Math.max(1, Math.round((agora - new Date(primeiro.ts).getTime()) / 86400_000))
      : null;

    return json({
      ts: new Date().toISOString(),
      diasNoAr,
      // Espectador primeiro; o resto em ordem alfabética, para a posição de
      // cada pessoa no mapa não dançar entre uma leitura e outra.
      pessoas: [...nomePessoa.entries()]
        .map(([id, nome]) => ({ id, nome }))
        .sort((a, b) =>
          a.id === espectador ? -1 : b.id === espectador ? 1 : a.nome.localeCompare(b.nome))
        // 12, não 6: o corte antigo vinha de quando só existiam 6 posições
        // padrão na coluna da esquerda, e derrubava gente de verdade do mapa.
        .slice(0, 12),
      agentes,
      eventos: eventos.slice(0, 12),
      avisos,
      // Mapa salvo à mão: posições, zoom e deslocamento.
      layout: (cfgLayout?.value ?? {}) as Record<string, unknown>,
      numeros: {
        entregas: (entregues.data ?? []).length,
        conversas: (conversas.data ?? []).length,
        tokens,
        custo: Math.round(custo * 100) / 100,
        cacheTaxa: entrada > 0 ? Math.round((cache / entrada) * 100) : 0,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[warroom-feed]", msg);
    return json({ error: msg }, 500);
  }
});
