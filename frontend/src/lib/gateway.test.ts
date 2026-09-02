/**
 * `GET /gateway/config` é `exige_papel("administrador")` no backend, e o
 * front pedia a config em toda sessão com token — administrador ou não. Em
 * produção isso virava `403 GET /gateway/config` a cada carga do `/chat`
 * para quem não é admin: nada quebrava na tela, mas o console enchia de
 * ruído e escondia o erro de verdade de quem for depurar essa tela.
 *
 * `podeCarregarConfigGateway` é o guard único que decide se vale a pena
 * chamar `loadGatewayConfig()` — usado tanto no boot da sessão
 * (`AppLayout.tsx`) quanto no refresh da aba Gateway em Configurações
 * (`SettingsPage.tsx`), para não duplicar a regra em cada chamador.
 */
import { describe, expect, it } from "vitest";

import { podeCarregarConfigGateway } from "@/lib/gateway";

describe("podeCarregarConfigGateway", () => {
  it("administrador pode — é quem a rota atende", () => {
    expect(podeCarregarConfigGateway("administrador")).toBe(true);
  });

  it("colaborador não pode — é o papel que hoje toma 403", () => {
    expect(podeCarregarConfigGateway("colaborador")).toBe(false);
  });

  it("sem_papel não pode — nem chega a ter uma tela para essa config", () => {
    expect(podeCarregarConfigGateway("sem_papel")).toBe(false);
  });

  it("papel nulo não pode — sessão ainda carregando ou deslogada", () => {
    expect(podeCarregarConfigGateway(null)).toBe(false);
  });
});
