import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Build-time version identifier — regenerated on every deploy/build.
function getGitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "nogit";
  }
}
const BUILD_DATE = new Date();
const BUILD_VERSION = `v${BUILD_DATE.getUTCFullYear()}.${String(BUILD_DATE.getUTCMonth() + 1).padStart(2, "0")}.${String(BUILD_DATE.getUTCDate()).padStart(2, "0")}-${getGitShortSha()}`;
const BUILD_ISO = BUILD_DATE.toISOString();


export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Espelha o que o nginx faz em produção: /api → backend. Assim
    // VITE_API_URL=/api vale nos dois ambientes, sem CORS no navegador.
    // 8002 porque 8000 é do taskhs-backend e 8001 do gestorhs-backend.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8002",
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ""),
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // "prompt", NÃO "autoUpdate": no modo autoUpdate a lib instala a versão
      // nova e RECARREGA A PÁGINA SOZINHA (o onNeedRefresh do main.tsx nem é
      // chamado). Como há checagem de update a cada visibilitychange, voltar
      // para a aba depois de um deploy recarregava o app no meio do clique —
      // o "refresh fantasma" caçado por horas em 29/07.
      registerType: "prompt",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: false, // We use public/manifest.json
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_VERSION),
    __APP_BUILD_DATE__: JSON.stringify(BUILD_ISO),
  },
}));
