// Bootstrap do primeiro admin de uma instância zerada (remix).
// Auto-fechável: só funciona enquanto NÃO existe nenhum super_admin.
// Dois modos:
//   { action: "check" }  -> { needsBootstrap: boolean }  (sem auth; só diz se a instância está zerada)
//   { action: "create", email, password, full_name } -> cria o 1º usuário como super_admin
//
// Não abre cadastro público: usa a Admin API (service_role) e recusa assim que já
// existe um super_admin. Depois disso, a instância é invite-only normal.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const superAdminExists = async (): Promise<boolean> => {
    const { count } = await admin
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "super_admin");
    return (count ?? 0) > 0;
  };

  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* check pode vir sem corpo */ }
    const action = (body.action as string) || "check";

    if (action === "check") {
      return json({ needsBootstrap: !(await superAdminExists()) });
    }

    if (action === "create") {
      // Auto-fechável: se já há super_admin, recusa.
      if (await superAdminExists()) {
        return json({ error: "Já existe um administrador nesta instância." }, 403);
      }

      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      if (!email || !password) {
        return json({ error: "email e password são obrigatórios." }, 400);
      }
      if (password.length < 8) {
        return json({ error: "A senha deve ter ao menos 8 caracteres." }, 400);
      }

      // Cria o usuário (o trigger handle_new_user cria profile + role 'user').
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (createErr || !created?.user) {
        return json({ error: createErr?.message ?? "Falha ao criar usuário." }, 500);
      }

      // Promove a super_admin (convive com a role 'user'; get_user_role usa a de maior prioridade).
      const { error: roleErr } = await admin
        .from("user_roles")
        .insert({ user_id: created.user.id, role: "super_admin" });
      if (roleErr && !/duplicate|conflict/i.test(roleErr.message)) {
        return json({ error: `Usuário criado, mas falhou ao promover: ${roleErr.message}` }, 500);
      }

      return json({ ok: true, user_id: created.user.id });
    }

    return json({ error: "action inválida (use 'check' ou 'create')." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
