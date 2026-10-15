/**
 * Presença no escritório virtual (EscritorioHS B, 15/10/2026).
 *
 * O e-mail é a identidade que liga o WorkAdventure ao HS.OS (`userUuid =
 * email.lower()` na Admin API). O perfil do HS.OS pode ter o e-mail com
 * maiúscula — se a comparação não normalizar, a pessoa está no escritório e
 * a lista de DMs não mostra o 🏢, sem erro nenhum.
 */
import { describe, expect, it } from "vitest";

import { ESCRITORIO_URL, emailsNoEscritorio } from "./escritorio";

describe("emailsNoEscritorio", () => {
  it("normaliza para minúsculas", () => {
    const s = emailsNoEscritorio({
      conectado: true,
      pessoas: [{ email: "Fulano@X.com", nome: "Fulano", user_id: null, avatar_url: null, desde: "2026-10-15T10:00:00Z" }],
    });
    expect(s.has("fulano@x.com")).toBe(true);
    expect(s.has("Fulano@X.com")).toBe(false);
  });

  it("presença indefinida dá conjunto vazio", () => {
    expect(emailsNoEscritorio(undefined).size).toBe(0);
  });
});

it("a URL do escritório é a de produção, sem barra no fim", () => {
  expect(ESCRITORIO_URL).toBe("https://escritoriohs.healthsafetytech.com");
});
