/**
 * O provider é quem decide abrir sozinho. Se ele esquecer de gravar a versão
 * ao fechar, o "O que há de novo?" volta a cada recarga — e vira o pop-up que
 * todo mundo fecha sem ler.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NovidadesProvider } from "@/components/novidades/NovidadesProvider";
import { VERSAO_ATUAL } from "@/data/changelog";
import { CHAVE_VERSAO_VISTA } from "@/lib/novidades";

afterEach(() => localStorage.clear());

describe("NovidadesProvider", () => {
  it("abre sozinho para quem não viu a versão atual e grava ao fechar", () => {
    const { unmount } = render(<NovidadesProvider>app</NovidadesProvider>);
    expect(screen.getByText("O que há de novo?")).toBeInTheDocument();
    expect(screen.getByText(`v${VERSAO_ATUAL}`)).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(localStorage.getItem(CHAVE_VERSAO_VISTA)).toBe(VERSAO_ATUAL);
    unmount();

    render(<NovidadesProvider>app</NovidadesProvider>);
    expect(screen.queryByText("O que há de novo?")).not.toBeInTheDocument();
  });
});
