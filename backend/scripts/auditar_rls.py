"""Quais queries sob `authenticated` dependem da RLS para escopo de usuário?

Aproximado de propósito: lê o SQL como texto, não executa. Serve para dimensionar
a auditoria, não para substituí-la.
"""
import re, pathlib

DONO = re.compile(r"\b(user_id|author_id|created_by|owner_id|usuario_id)\b", re.I)
# Tabelas cujo dado é de uma pessoa. Ler linha de outra = vazamento.
PESSOAIS = {"conversations", "notifications", "channel_messages", "drafts",
            "generated_documents", "agent_runs", "dm_reads", "push_subscriptions",
            "conversation_resets", "wiki_documents", "live_artifacts",
            "artifacts_published", "agent_tasks", "onboarding_progress"}

achados, total = [], 0
for f in sorted(pathlib.Path("app").rglob("*.py")):
    txt = f.read_text()
    # blocos que começam num sessao(authenticated) e vão até o próximo sessao/def
    for m in re.finditer(r'sessao\(role="authenticated".*?(?=sessao\(role=|\ndef |\nasync def |\Z)',
                         txt, re.S):
        bloco = m.group(0)
        for tab in re.findall(r'(?:FROM|INTO|UPDATE|DELETE FROM)\s+public\.["]?(\w+)', bloco, re.I):
            if tab not in PESSOAIS:
                continue
            total += 1
            # a condição de dono pode estar até 40 linhas antes (condicoes = [...])
            antes = txt[max(0, m.start() - 2500):m.start()]
            if not DONO.search(bloco) and not DONO.search(antes):
                linha = txt[:m.start()].count("\n") + 1
                achados.append(f"{f}:{linha}  {tab}")

print(f"queries sob authenticated em tabela pessoal: {total}")
print(f"sem filtro de dono visível: {len(achados)}\n")
for a in achados[:20]:
    print(" ", a)
