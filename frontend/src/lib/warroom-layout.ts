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
export const R_PESSOA = 18;
export const R_AGENTE = 36;

const CENTRO = { x: 800, y: 455 };
const ANEL_PESSOAS = { rx: 590, ry: 315 };
const ANEL_AGENTES = { rx: 200, ry: 150 };
const AFASTA_SETOR = 58;
/** Passo de arco a partir do qual cabe nó + rótulo sem encolher. */
const PASSO_CONFORTAVEL = 92;

/** Largura aproximada do rótulo de nome (fonte de 13 px). */
export function larguraRotulo(nome: string, escala: number): number {
  return Math.ceil(nome.length * 7.2 * escala) + 4;
}

const ponto = (rx: number, ry: number, t: number): PontoXY => ({
  x: CENTRO.x + rx * Math.cos(-Math.PI / 2 + t),
  y: CENTRO.y + ry * Math.sin(-Math.PI / 2 + t),
});

/** `n` ângulos-parâmetro a distância igual sobre a elipse, começando no topo,
 *  sentido horário, cada um no meio do seu trecho. */
function parametrosEquidistantes(n: number, rx: number, ry: number): number[] {
  const N = 2880;
  const acumulado = [0];
  let anterior = ponto(rx, ry, 0);
  for (let i = 1; i <= N; i++) {
    const p = ponto(rx, ry, (i / N) * 2 * Math.PI);
    acumulado.push(acumulado[i - 1] + Math.hypot(p.x - anterior.x, p.y - anterior.y));
    anterior = p;
  }
  const total = acumulado[N];
  const out: number[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const alvo = ((k + 0.5) / n) * total;
    while (acumulado[i] < alvo) i++;
    out.push((i / N) * 2 * Math.PI);
  }
  return out;
}

function perimetro(rx: number, ry: number) {
  // Ramanujan; folga de sobra para decidir a escala.
  return Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
}

const arred = (p: PontoXY): PontoXY => ({ x: Math.round(p.x), y: Math.round(p.y) });

export function calcularLayout(e: EntradaLayout): SaidaLayout {
  const setores = e.setores.filter((s) => s.pessoas.length);
  // Um vão do tamanho de uma pessoa entre setores.
  const vagas = setores.reduce((n, s) => n + s.pessoas.length, 0) + setores.length;
  const passo = vagas ? perimetro(ANEL_PESSOAS.rx, ANEL_PESSOAS.ry) / vagas : PASSO_CONFORTAVEL;
  const escala = +Math.min(1, passo / PASSO_CONFORTAVEL).toFixed(3);

  const t = parametrosEquidistantes(Math.max(vagas, 1), ANEL_PESSOAS.rx, ANEL_PESSOAS.ry);
  const pessoas: Record<string, PontoXY> = {};
  const rotulos: RotuloSetor[] = [];
  let vaga = 0;
  for (const s of setores) {
    const inicio = vaga;
    for (const id of s.pessoas) pessoas[id] = arred(ponto(ANEL_PESSOAS.rx, ANEL_PESSOAS.ry, t[vaga++]));
    const meio = (t[inicio] + t[vaga - 1]) / 2;
    const p = ponto(ANEL_PESSOAS.rx + AFASTA_SETOR, ANEL_PESSOAS.ry + AFASTA_SETOR * 0.75, meio);
    const ancora = p.x < CENTRO.x - 80 ? "end" : p.x > CENTRO.x + 80 ? "start" : "middle";
    // Rótulo de setor em cima do anel fica acima; embaixo, abaixo dos nomes.
    const y = p.y > CENTRO.y + ANEL_PESSOAS.ry * 0.6 ? p.y + 26 : p.y;
    rotulos.push({ nome: s.nome, x: Math.round(p.x), y: Math.round(y), ancora });
    vaga++; // o vão
  }

  const agentes: Record<string, PontoXY> = {};
  e.agentes.forEach((id, i) => {
    agentes[id] = arred(ponto(ANEL_AGENTES.rx, ANEL_AGENTES.ry, (i / Math.max(1, e.agentes.length)) * 2 * Math.PI));
  });

  return { escala, nucleo: { ...CENTRO }, pessoas, agentes, setores: rotulos };
}
