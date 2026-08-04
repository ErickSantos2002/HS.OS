/**
 * Generates the sandbox HTML for rendering Arena React code in an iframe.
 */

import { getGatewayConfig } from "./gateway";

export function buildSandboxHtml(reactCode: string, agents: string[]): string {
  const config = getGatewayConfig();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
<script src="https://cdn.tailwindcss.com"><\/script>
<script>
  window.ARENA_CONFIG = {
    apiUrl: ${JSON.stringify(config.url)},
    token: ${JSON.stringify(config.token)},
    agents: ${JSON.stringify(agents)}
  };
<\/script>
<style>
  body { margin: 0; min-height: 100vh; font-family: system-ui, -apple-system, sans-serif; }
  * { box-sizing: border-box; }
</style>
</head>
<body class="bg-gray-900 text-white">
<div id="root"></div>
<script type="text/babel">
try {
  ${reactCode}
  const _Root = typeof Arena !== 'undefined' ? Arena : (typeof App !== 'undefined' ? App : null);
  if (_Root) {
    ReactDOM.render(React.createElement(_Root), document.getElementById('root'));
  } else {
    document.getElementById('root').innerHTML = '<div style="padding:2rem;color:#f87171;">Erro: Nenhum componente Arena ou App encontrado.</div>';
  }
} catch(e) {
  document.getElementById('root').innerHTML = '<div style="padding:2rem;color:#f87171;">Erro: ' + e.message + '</div>';
  window.parent.postMessage({ type: 'ARENA_ERROR', error: e.message, stack: e.stack }, '*');
}
<\/script>
<script>
  window.onerror = function(msg, src, line, col, err) {
    window.parent.postMessage({ type: 'ARENA_ERROR', error: String(msg), stack: err ? err.stack : '' }, '*');
  };
<\/script>
</body>
</html>`;
}

/**
 * Validates reactCode and returns warnings/errors.
 */
export function validateReactCode(code: string): { valid: boolean; warnings: string[]; errors: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!code || code.trim().length === 0) {
    errors.push("reactCode está vazio");
    return { valid: false, warnings, errors };
  }

  // Check for export default or function Arena
  const hasExport = /export\s+default/.test(code) || /function\s+(Arena|App)/.test(code);
  if (!hasExport) {
    errors.push("reactCode não contém 'export default' ou 'function Arena'");
  }

  // Warn if no hooks
  if (!/useState|useEffect|useRef|useCallback|useMemo/.test(code)) {
    warnings.push("Código pode ser estático — não contém hooks React");
  }

  // Auto-inject ARENA_CONFIG destructuring if missing
  // (handled by caller, not an error)

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Injects ARENA_CONFIG destructuring at the top of reactCode if not present.
 */
export function ensureArenaConfig(code: string): string {
  if (/window\.ARENA_CONFIG|ARENA_CONFIG/.test(code)) {
    return code;
  }
  return `const { apiUrl, token, agents } = window.ARENA_CONFIG;\n\n${code}`;
}

/**
 * Generates a default React chat component for an Arena based on structured data.
 */
export function generateDefaultReactCode(arena: {
  name?: string;
  emoji?: string;
  agents?: { id: string; name: string }[] | string[];
  openingMessage?: string;
  prompt?: string;
}): string {
  const name = arena.name || "Arena";
  const emoji = arena.emoji || "⚔️";
  const agentNames = (arena.agents || []).map((a) =>
    typeof a === "string" ? a : a.name
  );
  const systemPrompt = arena.prompt || "";
  const openingMessage = arena.openingMessage || "";
  const openingAgent = agentNames[0] || "Assistente";

  return `const { apiUrl, token, agents: arenaAgents } = window.ARENA_CONFIG;

function Arena() {
  const [messages, setMessages] = React.useState(${openingMessage ? `[{ role: "assistant", agent: ${JSON.stringify(openingAgent)}, content: ${JSON.stringify(openingMessage)} }]` : "[]"});
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const scrollRef = React.useRef(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", agent: "Você", content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    const allAgents = [...arenaAgents];
    for (const agentName of allAgents) {
      try {
        const systemMsg = ${systemPrompt ? JSON.stringify(systemPrompt) : '""'};
        const history = newMessages.map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
        const res = await fetch(apiUrl + "/v1/responses", {
          method: "POST",
          headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openclaw:" + agentName,
            input: systemMsg
              ? [{ role: "system", content: systemMsg }, ...history]
              : history,
          }),
        });
        if (!res.ok) throw new Error("Erro " + res.status);
        const data = await res.json();
        const text = data.output?.[0]?.content?.[0]?.text || data.choices?.[0]?.message?.content || "...";
        newMessages.push({ role: "assistant", agent: agentName, content: text });
        setMessages([...newMessages]);
      } catch (err) {
        newMessages.push({ role: "assistant", agent: agentName, content: "Erro ao responder." });
        setMessages([...newMessages]);
      }
    }
    setLoading(false);
  };

  const agentColors = { ${agentNames.map((n, i) => `${JSON.stringify(n)}: "${["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"][i % 6]}"`).join(", ")} };

  return React.createElement("div", { className: "flex flex-col h-screen bg-gray-950 text-white" },
    React.createElement("div", { className: "flex items-center gap-3 px-5 py-3 border-b border-gray-800 bg-gray-900/80" },
      React.createElement("span", { className: "text-2xl" }, ${JSON.stringify(emoji)}),
      React.createElement("div", null,
        React.createElement("h1", { className: "text-lg font-bold" }, ${JSON.stringify(name)}),
        React.createElement("div", { className: "flex gap-2 mt-0.5" },
          ${JSON.stringify(agentNames)}.map(n =>
            React.createElement("span", { key: n, className: "text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-300" }, n)
          )
        )
      )
    ),
    React.createElement("div", { ref: scrollRef, className: "flex-1 overflow-y-auto px-5 py-4 space-y-3" },
      messages.map((m, i) =>
        React.createElement("div", { key: i, className: "flex flex-col " + (m.role === "user" ? "items-end" : "items-start") },
          React.createElement("span", { className: "text-[10px] font-mono mb-1 " + (m.role === "user" ? "text-gray-400" : ""), style: m.role !== "user" ? { color: agentColors[m.agent] || "#9ca3af" } : {} }, m.agent),
          React.createElement("div", { className: "max-w-[75%] rounded-xl px-4 py-2.5 text-sm " + (m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-100") }, m.content)
        )
      ),
      loading && React.createElement("div", { className: "flex items-center gap-2 text-gray-400 text-sm" },
        React.createElement("div", { className: "h-4 w-4 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" }),
        "Pensando..."
      )
    ),
    React.createElement("div", { className: "px-5 py-3 border-t border-gray-800 bg-gray-900/80" },
      React.createElement("div", { className: "flex gap-2" },
        React.createElement("input", {
          value: input,
          onChange: e => setInput(e.target.value),
          onKeyDown: e => e.key === "Enter" && sendMessage(),
          placeholder: "Digite sua mensagem...",
          className: "flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500",
          disabled: loading,
        }),
        React.createElement("button", {
          onClick: sendMessage,
          disabled: loading || !input.trim(),
          className: "px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition-colors",
        }, "Enviar")
      )
    )
  );
}`;
}
