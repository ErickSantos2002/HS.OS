/**
 * Mensagem de voz para agente: o áudio vira texto, e o texto leva a marca.
 *
 * O agente não ouve (o modelo é só texto), então o que vai é a transcrição do
 * `/ia/transcrever`. A marca "🎤 " no começo do conteúdo é o sinal: fica gravada
 * em `conversations`, mostra na bolha que aquilo foi falado, e faz o
 * `chat-sender` avisar o agente de que o texto pode ter erro de reconhecimento.
 *
 * O áudio em si não é guardado — no chat com agente não há player, e o bucket
 * `audio-messages` é de leitura pública.
 */
const MARCA = "🎤 ";

export function conteudoDeVoz(transcricao: string | undefined | null): string | null {
  const texto = (transcricao ?? "").trim();
  return texto ? `${MARCA}${texto}` : null;
}

export function avisoDeVoz(conteudo: string | undefined | null): string {
  if (!(conteudo ?? "").startsWith(MARCA)) return "";
  return "[Mensagem de voz — o texto abaixo é a transcrição automática do áudio e pode ter erros de reconhecimento. Se uma palavra não fizer sentido, pergunte em vez de adivinhar.]";
}
