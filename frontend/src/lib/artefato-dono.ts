/**
 * Quem pode usar dados num artefato vivo (PK-02, 25/11/2026).
 *
 * ⚠️ A ponte do artefato agia com a sessão de QUEM VÊ. Qualquer logado abre
 * artefato alheio pelo id, então uma página gerada sob injeção no chat de
 * qualquer pessoa, aberta pelo CEO, lia as conversas DELE e — sem CSP — as
 * mandava para fora. A trava de verdade é do servidor (`dono_do_artefato` em
 * `backend/app/routers/artefatos.py`); aqui a ponte só evita a chamada e dá a
 * mensagem certa.
 */

export function podeUsarDados(args: {
  publicMode: boolean;
  donoId: string | null | undefined;
  quemVeId: string | null | undefined;
}): boolean {
  if (args.publicMode) return false;
  if (!args.donoId || !args.quemVeId) return false;
  return args.donoId === args.quemVeId;
}

export const MENSAGEM_NAO_DONO = "Os dados deste painel só aparecem para quem o criou.";

/** O `hsos.user` que o HTML enxerga: só para o dono, e nunca o e-mail. */
export function quemVeParaOArtefato(args: {
  user: { id: string } | null | undefined;
  nome: string;
  papel: string;
  ehDono: boolean;
}): { id: string; role: string; name: string } | null {
  if (!args.ehDono || !args.user) return null;
  return { id: args.user.id, role: args.papel, name: args.nome };
}

/**
 * Sem rede, sem formulário, sem `<base>`. Os dados chegam por `postMessage`,
 * que o `connect-src` não bloqueia. `img`/`script` ficam abertos de propósito:
 * fechar quebraria gráfico de CDN — o que segura o vazamento é a trava do dono.
 */
export const CSP_DO_ARTEFATO =
  `<meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'; base-uri 'none'">`;

/** Põe a CSP antes de qualquer conteúdo do HTML (depois do doctype, se houver). */
export function comCsp(html: string): string {
  const doctype = html.match(/^\s*<!doctype[^>]*>/i);
  if (doctype) return doctype[0] + CSP_DO_ARTEFATO + html.slice(doctype[0].length);
  return CSP_DO_ARTEFATO + html;
}
