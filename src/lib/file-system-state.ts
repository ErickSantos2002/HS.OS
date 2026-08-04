/**
 * Module-level mirror of the active local folder. Allows non-React modules
 * (e.g. chat-sender) to know whether the user has authorized a folder so
 * we can inject the `<file_op>` instruction into the system context.
 */

let _folderName: string | null = null;

export function setActiveLocalFolder(name: string | null) {
  _folderName = name;
}

export function getActiveLocalFolder(): string | null {
  return _folderName;
}

export function buildLocalFolderSystemPrompt(folderName: string): string {
  return `PASTA LOCAL CONECTADA: "${folderName}"

O usuário autorizou acesso a uma pasta no computador dele. Para operar arquivos use exatamente este formato (uma operação por bloco):

<file_op>{"action":"read","path":"caminho/arquivo.txt"}</file_op>
<file_op>{"action":"write","path":"novo.md","content":"# Conteúdo"}</file_op>
<file_op>{"action":"create","path":"docs/arquivo.txt","content":"..."}</file_op>
<file_op>{"action":"list","path":"subpasta"}</file_op>
<file_op>{"action":"rename","path":"docs/velho.md","newPath":"docs/novo.md"}</file_op>
<file_op>{"action":"move","path":"docs/a.md","newPath":"arquivo/a.md"}</file_op>
<file_op>{"action":"delete","path":"docs/tmp.txt"}</file_op>

Regras:
- Caminhos são relativos à pasta autorizada (sem barra inicial).
- O sistema executa a operação no navegador do usuário e devolve o resultado na PRÓXIMA mensagem dele, prefixada com "[Resultado de file_op ...]" ou "[Erro em file_op ...]". Aguarde essa mensagem antes de continuar.
- Para "read" e "list", use o conteúdo retornado — não invente.
- Para "write"/"create", confirme com base no resultado.
- Para "rename"/"move", forneça sempre "newPath" com o caminho completo de destino (rename = mesma pasta, apenas nome novo; move = pasta diferente).
- "delete" apaga arquivos e pastas (recursivo). Confirme com o usuário antes de apagar algo importante.
- Emita uma operação por vez quando precisar do resultado para decidir o próximo passo.`;

}
