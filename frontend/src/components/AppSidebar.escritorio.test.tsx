/**
 * O atalho "Escritório" no menu (EscritorioHS B, 15/10/2026).
 *
 * Tranca que ele existe para os DOIS papéis — o escritório é da empresa
 * inteira, e o CEO é `colaborador` — e que abre em aba nova com
 * `noopener`: o escritório é outro site, e passar por `NavLink` o trataria
 * como rota interna do SPA, caindo no 404 do próprio HS.OS.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ESCRITORIO_URL } from "@/lib/escritorio";

const papel = vi.hoisted(() => ({ atual: "colaborador" as string }));
const guardi = vi.hoisted(() => ({ tem: false }));

vi.mock("@/contexts/auth-context", () => ({
  useAuthContext: () => ({ role: papel.atual, profile: null, user: { id: "u", email: "a@x.com" }, signOut: async () => {} }),
}));
vi.mock("@/components/NotificationsProvider", () => ({ useNotificationsContext: () => ({ unreadCount: 0 }) }));
vi.mock("@/hooks/use-user-status", () => ({
  useUserStatus: () => ({ status: null, setUserStatus: async () => {}, clearUserStatus: async () => {} }),
}));
vi.mock("@/hooks/use-branding", () => ({
  useBranding: () => ({ branding: { companyName: "HS.OS" } }),
  useThemedLogo: () => null,
  useThemedMark: () => null,
}));
vi.mock("@/hooks/use-tem-guardi", () => ({ useTemGuardi: () => guardi.tem }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));

import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

function montar() {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  papel.atual = "colaborador";
  guardi.tem = false;
});

describe.each(["colaborador", "administrador"])("menu do %s", (role) => {
  it("tem o link Escritório, externo e em aba nova", () => {
    papel.atual = role;
    montar();
    const link = screen.getByRole("link", { name: /Escritório/ });
    expect(link).toHaveAttribute("href", ESCRITORIO_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
  });

  it("o Escritório vem logo depois do Chat", () => {
    papel.atual = role;
    montar();
    const nomes = screen.getAllByRole("link").map((l) => l.textContent?.trim());
    expect(nomes[nomes.indexOf("Chat") + 1]).toBe("Escritório");
  });
});

/**
 * "Agenda" (09/11/2026) é dos lembretes do Guardi: no menu de quem não tem
 * Guardi ela abriria só para dizer "Você ainda não tem Guardi.". E entrar
 * no menu não pode empurrar o Escritório de perto do Chat.
 */
describe.each(["colaborador", "administrador"])("Agenda no menu do %s", (role) => {
  it("aparece só para quem tem Guardi, sem tirar o Escritório do lado do Chat", () => {
    papel.atual = role;
    guardi.tem = true;
    montar();
    const nomes = screen.getAllByRole("link").map((l) => l.textContent?.trim());
    expect(nomes.slice(nomes.indexOf("Chat"), nomes.indexOf("Chat") + 3)).toEqual(["Chat", "Escritório", "Agenda"]);
  });

  it("some para quem não tem Guardi", () => {
    papel.atual = role;
    montar();
    expect(screen.queryByRole("link", { name: /Agenda/ })).toBeNull();
  });
});
