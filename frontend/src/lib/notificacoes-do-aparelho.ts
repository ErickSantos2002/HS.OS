/**
 * Ligar e desligar as notificações DESTE aparelho — o interruptor de
 * Configurações → Perfil e o do "Eu" no app do celular (spec 2026-11-03).
 *
 * Saiu do `SettingsPage` para os dois lados passarem pelo mesmo caminho:
 * desligar apaga a inscrição de push deste aparelho (esclarecimento 4 da spec
 * de 03/11 — não existe preferência no servidor), e ligar só grava `true`
 * depois que a permissão foi de fato concedida.
 */
import {
  getPermission,
  requestPermission,
  setEnabled,
} from "@/lib/browser-notifications";

export type Permissao = NotificationPermission | "unsupported";

export async function desligarNotificacoesDoAparelho(): Promise<void> {
  setEnabled(false);
  const { unsubscribeFromPushNotifications } = await import("@/lib/push-notifications");
  await unsubscribeFromPushNotifications();
}

/**
 * Pede permissão se ainda não foi pedida (sem `await` antes do pedido — o
 * Safari exige o gesto da pessoa), liga e inscreve no push. Devolve se ficou
 * ligado e a permissão que resultou.
 */
export async function ligarNotificacoesDoAparelho(
  userId: string | null | undefined,
  permissaoAtual: Permissao = getPermission(),
): Promise<{ ligado: boolean; permissao: Permissao }> {
  let perm = permissaoAtual;
  if (perm === "default") {
    const result = await requestPermission();
    if (result !== "unsupported") perm = result;
  }
  if (perm === "granted") {
    setEnabled(true);
    if (userId) {
      const { subscribeToPushNotifications } = await import("@/lib/push-notifications");
      void subscribeToPushNotifications(userId);
    }
    return { ligado: true, permissao: perm };
  }
  // permission denied or unsupported — do NOT persist true
  setEnabled(false);
  return { ligado: false, permissao: perm };
}
