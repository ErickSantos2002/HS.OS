/**
 * Dono do "O que há de novo?": abre sozinho uma vez por versão nova e expõe
 * `abrirNovidades()` para o clique na versão do rodapé.
 *
 * Fica no `CascaDoApp`, por fora das duas cascas — o app do celular não monta
 * o `AppLayout`, e sem isso quem usa só o celular nunca veria a novidade.
 *
 * Depois de um deploy, o aviso de versão nova do service worker recarrega a
 * página com o bundle novo; o topo do changelog muda e o modal abre ali, sem
 * precisar de login.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { VERSAO_ATUAL } from "@/data/changelog";
import { deveMostrarNovidades, marcarVersaoVista, versaoVista } from "@/lib/novidades";
import { ChangelogModal } from "./ChangelogModal";

const NovidadesContext = createContext<{ abrirNovidades: () => void }>({ abrirNovidades: () => {} });

export function useNovidades() {
  return useContext(NovidadesContext);
}

export function NovidadesProvider({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (deveMostrarNovidades(versaoVista(), VERSAO_ATUAL)) setAberto(true);
  }, []);

  const abrirNovidades = useCallback(() => setAberto(true), []);
  const fechar = useCallback(() => {
    marcarVersaoVista(VERSAO_ATUAL);
    setAberto(false);
  }, []);

  return (
    <NovidadesContext.Provider value={{ abrirNovidades }}>
      {children}
      <ChangelogModal aberto={aberto} aoFechar={fechar} />
    </NovidadesContext.Provider>
  );
}
