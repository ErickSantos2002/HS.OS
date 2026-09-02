// Configuração do OpenClaw Gateway (frontend).
//
// O `admin_token` NÃO existe mais deste lado. Antes este módulo carregava
// `gateway_url` e `admin_token` de `public.vps_config` para a memória do
// navegador, e quatro pontos do app faziam `fetch` direto no gateway com ele —
// um deles chegava a embutir o token no código que gerava. Quem obtivesse esse
// token controlaria o VPS inteiro.
//
// Agora o token vive só no backend (`OPENCLAW_ADMIN_TOKEN` / `vps_config`, lido
// pelo servidor) e toda chamada ao gateway passa por `/gateway/*`. Aqui ficam
// apenas a URL, para exibição, e o indicador de que existe um token gravado.

import { api, ErroApi } from "@/lib/api";
import type { AppRole } from "@/hooks/use-auth";

export interface GatewayConfig {
  url: string;
  /** Existe token gravado? O valor em si nunca chega ao navegador. */
  temToken: boolean;
  configurado: boolean;
}

interface ConfigApi {
  url: string;
  tem_token: boolean;
  configurado: boolean;
}

const VAZIO: GatewayConfig = { url: "", temToken: false, configurado: false };

// Cache em memória para acesso síncrono (preenchido no primeiro load).
let cachedConfig: GatewayConfig | null = null;

/** Acessor síncrono — devolve o cache ou a configuração vazia. */
export function getGatewayConfig(): GatewayConfig {
  return cachedConfig ?? VAZIO;
}

/**
 * Guard único para decidir se vale chamar `loadGatewayConfig()`. A rota é
 * `exige_papel("administrador")` no backend, e antes ela era pedida em toda
 * sessão com token — administrador ou não —, o que gerava um 403 registrado
 * no console a cada carga do `/chat` para quem não é admin. O papel vem de
 * onde o resto da tela já lê (`useAuthContext`/`role`), nunca de uma segunda
 * leitura do token.
 */
export function podeCarregarConfigGateway(role: AppRole | null): boolean {
  return role === "administrador";
}

/** Carrega a configuração do backend. Só `administrador` recebe. */
export async function loadGatewayConfig(): Promise<GatewayConfig> {
  try {
    const d = await api<ConfigApi>("/gateway/config");
    cachedConfig = { url: d.url, temToken: d.tem_token, configurado: d.configurado };
  } catch {
    cachedConfig = { ...VAZIO };
  }
  return cachedConfig;
}

/**
 * Grava a configuração. `token` ausente mantém o token atual — é o que permite
 * editar só a URL sem reenviar um segredo que a tela nunca recebeu.
 */
export async function saveGatewayConfig(
  config: { url: string; token?: string },
): Promise<{ error: unknown }> {
  try {
    const d = await api<ConfigApi>("/gateway/config", {
      method: "PUT",
      body: { url: config.url, token: config.token ?? null },
    });
    cachedConfig = { url: d.url, temToken: d.tem_token, configurado: d.configurado };
    return { error: null };
  } catch (err) {
    return { error: err };
  }
}

/**
 * Marca um caminho que ainda falava com o gateway direto do navegador, usando o
 * admin token. Esses trechos chamam a API REST antiga do OpenClaw (`/api/...`,
 * `/v1/...`), que **não existe mais** desde a mudança para WebSocket JSON-RPC —
 * então já estavam quebrados, com ou sem token.
 *
 * Falhar aqui, alto e com motivo, é melhor do que devolver lista vazia e parecer
 * que "não há nada". Cada um será substituído pelo proxy do backend no lote
 * correspondente — ver `docs/ROADMAP.md`.
 */
export function gatewayNaoPortado(area: string): never {
  throw new Error(
    `${area} ainda não foi portado para a API própria. ` +
      `Este caminho usava a API REST antiga do OpenClaw, que não existe mais.`,
  );
}

export interface TestResult {
  success: boolean;
  version?: string | null;
  error?: string;
}

/**
 * Testa a conexão. O backend abre o WebSocket com o gateway e faz uma chamada
 * real — não é um ping. Não recebe token: usa o que já está gravado.
 */
export async function testConnection(): Promise<TestResult> {
  try {
    const d = await api<{
      conectado: boolean;
      versao: string | null;
      erro: string | null;
    }>("/gateway/status");
    return { success: d.conectado, version: d.versao, error: d.erro ?? undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ErroApi ? err.message : "Falha ao contatar o servidor.",
    };
  }
}
