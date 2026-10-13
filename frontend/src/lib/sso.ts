/**
 * Login com Microsoft (Entra ID) — o lado do navegador.
 *
 * O fluxo é do backend (`backend/app/auth/router.py`): o botão NAVEGA para
 * `/auth/microsoft`, a Microsoft devolve a pessoa ao backend, e o backend a
 * manda para `/auth/callback?ticket=…`. Aqui o ticket vira o mesmo token do
 * login por senha, por `POST /auth/sso/exchange`.
 *
 * **O nonce fecha o login CSRF do lado de cá.** O `state` no cookie protege a
 * volta da Microsoft; mas um ticket válido de OUTRA pessoa, num link mandado a
 * alguém, faria esse alguém entrar na conta do outro. O botão grava um nonce
 * na aba antes de sair e a volta só troca o ticket se ele existir — quem chega
 * por um link sem ter clicado no botão vê "link inválido".
 */
import { api, gravarToken, urlDaApi } from "@/lib/api";

const CHAVE_NONCE = "hsos.sso_nonce";

export const URL_LOGIN_MICROSOFT = urlDaApi("/auth/microsoft");

/** Diz se o backend tem as variáveis do Entra. Falha conta como desligado. */
export async function ssoAtivo(): Promise<boolean> {
  try {
    const r = await api<{ ativo: boolean }>("/auth/sso/status", { autenticar: false });
    return r.ativo === true;
  } catch {
    return false;
  }
}

export function prepararLoginMicrosoft(): void {
  try {
    sessionStorage.setItem(CHAVE_NONCE, String(Date.now()));
  } catch {
    /* sem sessionStorage a volta vai recusar — e a pessoa entra por senha */
  }
}

/** Uso único: devolve se havia nonce e o apaga. */
export function consumirNonceSso(): boolean {
  try {
    const havia = sessionStorage.getItem(CHAVE_NONCE) !== null;
    sessionStorage.removeItem(CHAVE_NONCE);
    return havia;
  } catch {
    return false;
  }
}

export async function trocarTicket(ticket: string): Promise<void> {
  const r = await api<{ access_token: string }>("/auth/sso/exchange", {
    method: "POST",
    body: { ticket },
    autenticar: false,
  });
  gravarToken(r.access_token);
}

/** Texto para o `?erro_sso=` que o backend põe na URL do login. */
export function mensagemErroSso(codigo: string | null): string | null {
  if (!codigo) return null;
  switch (codigo) {
    case "usuario_nao_encontrado":
      return "Sua conta Microsoft não tem acesso ao HS.OS. Fale com o setor de TI.";
    case "conta_desativada":
      return "Sua conta no HS.OS está desativada. Fale com o setor de TI.";
    case "cancelado":
      return "Login com Microsoft cancelado.";
    default:
      return "Não foi possível entrar com a Microsoft. Tente de novo ou use e-mail e senha.";
  }
}
