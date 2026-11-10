/**
 * Quando o "O que há de novo?" abre sozinho: uma vez por versão nova, por
 * navegador.
 *
 * A versão vista fica no `localStorage` — é conveniência de quem olha, não
 * dado do sistema. A consequência aceita: quem usa o computador e o celular
 * vê a mesma novidade uma vez em cada um.
 *
 * ⚠️ Comparar só por igualdade abriria o modal de novo quando um deploy é
 * revertido (a versão vista é MAIOR que a atual). Por isso é "maior que".
 */
import { gravarChave, lerChave } from "@/lib/chaves-locais";

export const CHAVE_VERSAO_VISTA = "hsos-novidades-vista";

function semver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Puro: `vista` é o que está guardado (ou `null`), `atual` o topo do changelog. */
export function deveMostrarNovidades(vista: string | null, atual: string): boolean {
  const a = semver(atual);
  const v = vista ? semver(vista) : null;
  if (!a) return false;
  if (!v) return true;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== v[i]) return a[i] > v[i];
  }
  return false;
}

export function versaoVista(): string | null {
  return lerChave(CHAVE_VERSAO_VISTA);
}

export function marcarVersaoVista(versao: string): void {
  gravarChave(CHAVE_VERSAO_VISTA, versao);
}
