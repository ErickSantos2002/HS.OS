/**
 * Como a lista de agentes do chat se organiza. Puro e testado.
 * O próprio bot vai fixo no topo; os bots dos outros (só admin vê) vão num
 * bloco recolhido; especialistas no meio.
 */
type ComDono = { donoId?: string | null };

export function organizarAgentes<T extends ComDono>(lista: T[], meuId: string | undefined) {
  const meu = lista.find((a) => !!a.donoId && a.donoId === meuId) ?? null;
  return {
    meu,
    especialistas: lista.filter((a) => !a.donoId),
    outrosBots: lista.filter((a) => !!a.donoId && a !== meu),
  };
}
