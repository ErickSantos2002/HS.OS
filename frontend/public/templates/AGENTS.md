AGENTS.md --- Shared Workspace Rules

This file is shared by all agents. It contains operational guardrails
--- not personality, not domain knowledge. Every agent loads this file
on startup alongside their own SOUL.md, IDENTITY.md, and TOOLS.md.

Every Session

Load these files on startup: 1) SOUL.md --- who you are 2) IDENTITY.md
--- name, vibe, emoji 3) AGENTS.md --- operational rules (this file)
4) COMPANY.md --- empresa cliente (nome, fundador, segmento, tom).
Se COMPANY.md não existir no workspace, seguir sem ele --- é opcional
até o onboarding ser concluído. Everything else: use memory_search()
on demand.

⏱️ Batch Tool Call Rule

Maximum 8-10 heavy tool calls per turn (file read, external API, long
execution). If the task requires more, break into smaller batches across
multiple turns. For repeatedly accessed data, create cached
endpoint/file. If a turn starts stacking too many tools, stop and split
before crashing.

🧠 Context Management (mandatory)

Keep context lean. Avoid accumulating large tasks in the same session.

Rule 1 --- Outputs Always in Background

Scripts and executions NEVER echo output to chat. Always redirect to
file. Correct: exec('python3 generate.py > /tmp/result.json 2>&1 &&
echo OK') --- echoes just OK. Wrong: exec('python3 generate.py') ---
echoes 15KB to chat, polluting context. Read the file with read when you
need the content.

Rule 2 --- /new Between Large Tasks

If a previous task consumed >20 tool calls OR has accumulated outputs
>30KB: finish the current task, notify user that context is at X% and
recommend /new before next task, wait for /new. What is NOT a large
task: quick queries, 1-2 file reads, short responses, status checks.

📋 Pre-Task Planning --- Output >3KB

Before starting any task with estimated output >3KB, do a quick plan
and ask for confirmation. Format: estimated size, strategy (1 at a time
via generate_document, or python-docx + HTTP, or chunks), method,
forecast (turns, minutes). Decision matrix: single item 6-12KB =
generate_document inline 1 per message. Multiple separate items = 1 per
message. Single large document all together = python-docx + HTTP link.
Simple report under 3KB = generate_document direct. Golden rule:
generate_document inline OK up to \~12KB per message. Above that =
python-docx + HTTP.

🛡️ Operational Guardrails

Circuit Breaker: if an exec command fails 3 consecutive times with the
same error pattern, ABORT immediately. Do not try a 4th different
approach. Default exec timeout = 30s (120s only for genuinely long
operations). Retry with backoff: 2s, 4s, 8s, then abort.
Anti-Duplication: always search before creating. Never create in batch
without deduplication.

🔄 Loop Architecture --- Long Tasks

Protocol: create (split into chunks) → checkpoint (save progress) →
resume → complete. Decision tree: simple → execute. Medium → Goal. Large
(>15 tool calls) → Loop. Goal blocked → Loop.

📚 LEARNINGS.md --- Portable Knowledge

Keep a LEARNINGS.md in your workspace with DOMAIN learnings that apply
to any company: techniques that worked, pitfalls, heuristics. This file
travels in agent exports (.dnos), so its rules are STRICT:
- NEVER credentials, tokens, keys or internal URLs
- NEVER client names, people, company names or business numbers
- Write generically: "short videos with a hook in the first 2s perform
  better", not "{company}'s Tuesday Reel got 40k views"
Company-specific data belongs in regular memory, never here.

💾 File Saving Rule

NEVER create files (local or VPS) unless EXPLICITLY requested. Default:
respond with text in chat. Only create files when user says 'save
this', 'create a file', 'store in', or for HTML artifacts that need
serving. Prefer trash over rm for deletions.

Safety

Don't exfiltrate private data. Don't run destructive commands without
asking. When in doubt, ask. Use memory_search() before answering
questions about history, decisions, or past context --- don't guess.
