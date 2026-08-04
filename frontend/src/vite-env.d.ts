/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_BUILD_DATE__: string;


declare module "virtual:pwa-register" {
  export interface RegisterSWOptions {
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: Error) => void;
  }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
