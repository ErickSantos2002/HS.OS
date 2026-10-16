/**
 * Onde cada nó da War Room fica — função pura, testada sem React.
 *
 * ⚠️ **Por que existe.** Em 16/10/2026 a War Room foi para a TV da empresa com
 * 28 pessoas numa grade, e os nomes se atropelavam ("Ketlin Scalco" em cima de
 * "Suelen Patrícia…"). O cálculo vivia dentro da página, misturado com desenho
 * e animação, e nenhum teste olhava sobreposição.
 *
 * O desenho: núcleo no centro, agentes num anel interno, pessoas num anel
 * externo agrupadas por setor, com um vão entre setores e o nome do setor por
 * fora. Pontos a **distância igual sobre a elipse** (não ângulo igual: na
 * elipse, ângulo igual aperta as laterais). Determinístico de propósito: com
 * posições estáveis quem trabalha na sala aprende o mapa.
 */

export interface PontoXY { x: number; y: number }
export interface EntradaLayout {
  setores: { nome: string; pessoas: string[] }[];
  agentes: string[];
  /** id → nome exibido; é o que decide a largura do rótulo. */
  nomes: Record<string, string>;
}
export interface RotuloSetor { nome: string; x: number; y: number; ancora: "start" | "middle" | "end" }
export interface SaidaLayout {
  escala: number;
  nucleo: PontoXY;
  pessoas: Record<string, PontoXY>;
  agentes: Record<string, PontoXY>;
  setores: RotuloSetor[];
}

export const QUADRO = { w: 1600, h: 900 };
export const R_PESSOA = 20;
export const R_AGENTE = 36;

/** Tamanho das fontes no `viewBox` (unidades de 1600×900; a 1920 px de
 *  largura cada unidade dá ~0,9 px na tela).
 *
 *  ⚠️ **Legível a 4 m é o critério de sucesso da tela.** Até 16/10/2026 o nome
 *  da pessoa saía com 13 — ~11 px num print de 1920, que num 55" a 4 m não se
 *  lê. Página e teste leem daqui: subir uma fonte sem mexer no layout quebra o
 *  teste de sobreposição, que é o que se quer. */
export const FONTE = { nome: 19, status: 14, agente: 20, agenteSub: 14, setor: 15, inicial: 17 } as const;

/** Largura média de um caractere, em em. Rajdhani (nomes) é condensada; a
 *  JetBrains Mono é 0,6 em cravado, mais o `letter-spacing` do CSS. */
const EM = { nome: 0.55, mono: 0.62, setor: 0.6 + 0.32 } as const;

/** Linha de base de cada linha do rótulo da pessoa, medida da borda de baixo
 *  do nó, a escala 1. A caixa vai do topo do nome ao pé do status. */
export const ROTULO_PESSOA = { nome: 18, status: 35, topo: 4, pe: 39 } as const;
/** Idem, para o agente: nome, linha de estado e, ocupado, o cronômetro. */
export const ROTULO_AGENTE = { nome: 28, linha2: 47, linha3: 64, topo: 13, pe2: 51, pe3: 68 } as const;

/** O rótulo curto do status da pessoa — aqui porque a largura dele entra na
 *  conta do layout. */
export const ROTULO_STATUS: Record<string, string> = {
  reuniao: "em reunião", foco: "foco", almoco: "almoço", ausente: "ausente",
};

const CENTRO = { x: 800, y: 450 };
const ANEL_PESSOAS = { rx: 618, ry: 345 };
const ANEL_AGENTES = { rx: 250, ry: 172 };
const AFASTA_SETOR = 40;
/** O vão entre dois setores, em vagas de pessoa. Meia vaga já separa o grupo
 *  a 4 m e devolve ao anel o espaço que as fontes maiores pediram. */
const VAO = 0.5;
/** Passo de arco a partir do qual cabe nó + rótulo sem encolher. */
const PASSO_CONFORTAVEL = 106;

/** Largura do rótulo de nome da pessoa (fonte `FONTE.nome`). */
export function larguraRotulo(nome: string, escala: number): number {
  return Math.ceil(nome.length * EM.nome * FONTE.nome * escala) + 4;
}
/** Largura de uma linha em JetBrains Mono (status, sublinha do agente). */
export function larguraMono(texto: string, fonte: number, escala = 1): number {
  return Math.ceil(texto.length * EM.mono * fonte * escala) + 4;
}
/** Largura do nome do setor (mono, caixa alta, espaçado). */
export function larguraSetor(nome: string): number {
  return Math.ceil(nome.length * EM.setor * FONTE.setor) + 4;
}

export interface Caixa { x0: number; y0: number; x1: number; y1: number }

/** A caixa do nó + rótulo de uma pessoa — a MESMA conta que a página desenha.
 *  `status` é o texto já rotulado ("em reunião"), ou nada. */
export function caixasPessoa(p: PontoXY, nome: string, status: string | null, escala: number) {
  const r = R_PESSOA * escala;
  const w = Math.max(larguraRotulo(nome, escala), status ? larguraMono(status, FONTE.status, escala) : 0);
  const pe = status ? ROTULO_PESSOA.pe : ROTULO_PESSOA.nome + FONTE.nome * 0.25;
  return {
    no: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r },
    rotulo: { x0: p.x - w / 2, y0: p.y + r + ROTULO_PESSOA.topo * escala,
              x1: p.x + w / 2, y1: p.y + r + pe * escala },
  };
}

/** A caixa do agente: o anel (com halo) e o rótulo de duas ou três linhas. */
export function caixasAgente(p: PontoXY, nome: string, linha2: string, linha3: string | null) {
  const w = Math.max(larguraRotulo(nome, FONTE.agente / FONTE.nome),
    larguraMono(linha2, FONTE.agenteSub), linha3 ? larguraMono(linha3, FONTE.agenteSub) : 0);
  const r = R_AGENTE + 10;
  return {
    no: { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r },
    rotulo: { x0: p.x - w / 2, y0: p.y + R_AGENTE + ROTULO_AGENTE.topo,
              x1: p.x + w / 2, y1: p.y + R_AGENTE + (linha3 ? ROTULO_AGENTE.pe3 : ROTULO_AGENTE.pe2) },
  };
}

/** A caixa do nome de um setor, pela âncora do `<text>`. */
export function caixaSetor(r: RotuloSetor): Caixa {
  const w = larguraSetor(r.nome);
  const x0 = r.ancora === "end" ? r.x - w : r.ancora === "middle" ? r.x - w / 2 : r.x;
  return { x0, y0: r.y - FONTE.setor * 0.75, x1: x0 + w, y1: r.y + FONTE.setor * 0.2 };
}

const ponto = (rx: number, ry: number, t: number): PontoXY => ({
  x: CENTRO.x + rx * Math.cos(-Math.PI / 2 + t),
  y: CENTRO.y + ry * Math.sin(-Math.PI / 2 + t),
});

/** Ângulos-parâmetro sobre a elipse a distância igual por unidade de vaga,
 *  começando no topo, sentido horário. `posicoes` são vagas (0,5 é o meio da
 *  primeira) e `vagas` o total; uma pessoa ocupa uma vaga, o vão entre
 *  setores ocupa `VAO`. */
function parametrosEquidistantes(posicoes: number[], vagas: number, rx: number, ry: number): number[] {
  const N = 2880;
  const acumulado = [0];
  let anterior = ponto(rx, ry, 0);
  for (let i = 1; i <= N; i++) {
    const p = ponto(rx, ry, (i / N) * 2 * Math.PI);
    acumulado.push(acumulado[i - 1] + Math.hypot(p.x - anterior.x, p.y - anterior.y));
    anterior = p;
  }
  const total = acumulado[N];
  let i = 0;
  return posicoes.map((u) => {
    const alvo = (u / vagas) * total;
    while (acumulado[i] < alvo) i++;
    return (i / N) * 2 * Math.PI;
  });
}

function perimetro(rx: number, ry: number) {
  // Ramanujan; folga de sobra para decidir a escala.
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

const arred = (p: PontoXY): PontoXY => ({ x: Math.round(p.x), y: Math.round(p.y) });
const cruza = (a: Caixa, b: Caixa) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const PIOR_STATUS = Object.values(ROTULO_STATUS).reduce((a, b) => (b.length > a.length ? b : a));

export function calcularLayout(e: EntradaLayout): SaidaLayout {
  const setores = e.setores.filter((s) => s.pessoas.length);
  const nPessoas = setores.reduce((n, s) => n + s.pessoas.length, 0);
  const vagas = nPessoas + setores.length * VAO;
  const passo = vagas ? perimetro(ANEL_PESSOAS.rx, ANEL_PESSOAS.ry) / vagas : PASSO_CONFORTAVEL;
  const escala = +Math.min(1, passo / PASSO_CONFORTAVEL).toFixed(3);

  // Vaga de cada pessoa, na ordem: o vão vem DEPOIS de cada setor.
  const posicoes: number[] = [];
  let u = 0;
  for (const s of setores) {
    for (let k = 0; k < s.pessoas.length; k++) posicoes.push(u++ + 0.5);
    u += VAO;
  }
  const t = parametrosEquidistantes(posicoes, Math.max(vagas, 1), ANEL_PESSOAS.rx, ANEL_PESSOAS.ry);
  const pessoas: Record<string, PontoXY> = {};
  let k = 0;
  for (const s of setores) for (const id of s.pessoas) pessoas[id] = arred(ponto(ANEL_PESSOAS.rx, ANEL_PESSOAS.ry, t[k++]));

  // O nome do setor vai por fora, no meio do arco do setor, e se afasta até
  // não encostar em nenhuma pessoa — com o rótulo de status mais largo, porque
  // o layout não sabe quem vai estar em reunião.
  const ocupado = Object.entries(pessoas).flatMap(([id, p]) => {
    const c = caixasPessoa(p, e.nomes[id] ?? "", PIOR_STATUS, escala);
    return [c.no, c.rotulo];
  });
  const rotulos: RotuloSetor[] = [];
  k = 0;
  for (const s of setores) {
    const meio = (t[k] + t[k + s.pessoas.length - 1]) / 2;
    k += s.pessoas.length;
    let r: RotuloSetor | null = null;
    for (let d = AFASTA_SETOR; d <= AFASTA_SETOR + 120; d += 4) {
      const p = ponto(ANEL_PESSOAS.rx + d, ANEL_PESSOAS.ry + d * 0.75, meio);
      const ancora = p.x < CENTRO.x - 80 ? "end" : p.x > CENTRO.x + 80 ? "start" : "middle";
      r = { nome: s.nome, x: Math.round(p.x), y: Math.round(p.y + (p.y > CENTRO.y ? FONTE.setor * 0.75 : 0)), ancora };
      const c = caixaSetor(r);
      if (!ocupado.some((o) => cruza(c, o))) break;
    }
    rotulos.push(r!);
  }

  const agentes: Record<string, PontoXY> = {};
  e.agentes.forEach((id, i) => {
    agentes[id] = arred(ponto(ANEL_AGENTES.rx, ANEL_AGENTES.ry, (i / Math.max(1, e.agentes.length)) * 2 * Math.PI));
  });

  return { escala, nucleo: { ...CENTRO }, pessoas, agentes, setores: rotulos };
}
