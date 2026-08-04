/**
 * Escolha de LLM por conversa (override do modelo do agente).
 *
 * Escopo: é um override LOCAL do usuário, não configuração do agente. Trocar
 * aqui NÃO altera o modelo padrão do agente nem afeta as conversas de outras
 * pessoas — isso é de propósito. O padrão do agente é config global (Settings →
 * agents.update, super_admin); se o seletor do chat escrevesse de volta lá, um
 * usuário escolher Claude na conversa dele mudaria o agente para todo mundo.
 *
 * Mecanismo: header `x-openclaw-model` por requisição, que o Gateway aceita sem
 * tocar em config nenhuma. Já provado em produção — export-agent usa esse header
 * para forçar o Flash.
 *
 * Formato do valor: SEMPRE `provedor/modelo` ("anthropic/claude-sonnet-4-6").
 * Sem o prefixo o Gateway assume `deepseek/` e a chamada falha por engano —
 * confirmado com saída bruta ("gpt-5.4" virou "deepseek/gpt-5.4").
 *
 * Persistência: por AGENTE, não por chave de sessão. É o que faz a escolha
 * sobreviver ao `/new` (decisão do Rodrigo: quem escolheu Claude e limpa o
 * contexto quer continuar em Claude). Guardar por sessão perderia o override
 * exatamente no bump de geração.
 */

const STORAGE_PREFIX = "dnos:model-override:";

/** Evento disparado quando um override muda, para a UI reagir sem prop drilling. */
export const MODEL_OVERRIDE_EVENT = "dnos:model-override-changed";

// Espelha o localStorage para leitura síncrona (o envio da mensagem não pode
// depender de I/O) e para funcionar quando o storage está indisponível.
const cache = new Map<string, string>();
let hydrated = false;

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value) cache.set(key.slice(STORAGE_PREFIX.length), value);
    }
  } catch {
    /* storage indisponível — segue só com o cache em memória */
  }
}

/**
 * Modelo escolhido para este agente, ou null quando usa o padrão do agente.
 * Null é o estado normal: a maioria das conversas nunca sobrescreve.
 */
export function getModelOverride(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  hydrate();
  return cache.get(agentId) ?? null;
}

/** Passa `null` para voltar ao modelo padrão do agente. */
export function setModelOverride(agentId: string, model: string | null) {
  hydrate();
  const storageKey = `${STORAGE_PREFIX}${agentId}`;
  if (model) {
    cache.set(agentId, model);
  } else {
    cache.delete(agentId);
  }
  try {
    if (model) localStorage.setItem(storageKey, model);
    else localStorage.removeItem(storageKey);
  } catch {
    /* falha de storage não impede o override valer nesta aba */
  }
  window.dispatchEvent(new CustomEvent(MODEL_OVERRIDE_EVENT, { detail: { agentId, model } }));
}
