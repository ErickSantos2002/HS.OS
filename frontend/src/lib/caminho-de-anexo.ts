/**
 * O caminho de armazenamento de um anexo. Ver `caminho-de-anexo.test.ts` para o
 * defeito que ele fecha — e para o que ele **não** fecha.
 *
 * Resumo: `agent-files` é bucket de leitura pública, e continua sendo, porque
 * avatar aparece em `<img src>` (sem `Authorization`) e o agente busca o
 * arquivo do lado do gateway, sem o nosso token. A única defesa que esse
 * desenho declara é o caminho ser difícil de adivinhar — e o caminho antigo,
 * `<epoch em ms>_<nome original>`, não era.
 */

/** Extensão só se for curta e alfanumérica; é ela que vira o Content-Type. */
function extensaoSegura(nome: string): string {
  if (!nome.includes(".")) return "";
  const bruta = nome.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{1,8}$/.test(bruta) ? bruta : "";
}

function idAleatorio(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Navegador antigo ou contexto não seguro: ainda assim não pode cair num
  // nome previsível, que é justamente o que estamos consertando.
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function caminhoDeAnexo(prefixo: string, nomeOriginal: string): string {
  const ext = extensaoSegura(nomeOriginal);
  return `${prefixo}/${idAleatorio()}${ext ? "." + ext : ""}`;
}

/**
 * O caminho de um arquivo enviado na wiki (bucket `wiki-uploads`, público).
 *
 * ⚠️ PK-09 (24/11/2026): era `<usuário>/<documento>/<ms>-<6 de Math.random>`.
 * Usuário e documento são conhecidos de quem é membro, o carimbo fica a
 * segundos do `updated_at` do documento, e 6 caracteres de `Math.random` não
 * são sorteio de verdade — o mesmo defeito que este arquivo fechou no
 * `agent-files`. O bucket continua público (a imagem aparece em `<img src>`);
 * a defesa é o nome não ser adivinhável.
 */
export function caminhoNaWiki(usuario: string, documento: string | null | undefined, nomeOriginal: string): string {
  return caminhoDeAnexo(`${usuario}/${documento || "misc"}`, nomeOriginal);
}
