import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Sun, Moon, ArrowLeft, Move, Check, RotateCcw, ZoomIn, ZoomOut, Maximize, Minimize, Sparkles, LayoutGrid } from "lucide-react";
import { api } from "@/lib/api";
import "@/styles/warroom.css";

/**
 * War room — a tela de parede do escritório.
 *
 * Não é dashboard (que se consulta), é vitrine (que se assiste): um
 * organograma vivo onde humanos e agentes ocupam o mesmo plano, o trabalho
 * viaja pelas linhas e os sub-agentes orbitam quem os criou.
 *
 * Posições FIXAS de propósito. Grafo de força se reorganiza sozinho e vira
 * ruído a 4 metros; com posições estáveis quem trabalha na sala aprende o
 * mapa e lê a parede num relance — e o movimento passa a significar trabalho,
 * não recálculo de layout.
 *
 * Acesso por dois caminhos: espelhando de um computador logado (basta abrir
 * /warroom — a sessão autentica) ou direto numa TV, que não faz login, com o
 * token dedicado na URL (/warroom?k=…). Nos dois casos a página lê de uma
 * função própria que só devolve estado agregado.
 */

interface Agente {
  id: string; nome: string; papel: string;
  estado: "ocioso" | "pensando" | "longo";
  tarefa: string | null; desde: string | null;
  contexto: number | null; filhos: { nome: string; vivo: boolean }[]; parceiro: string | null;
  parceiroAgente: string | null;
}
interface Evento { ts: string; tipo: "entrega" | "autonomo" | "conversa"; texto: string }
interface Feed {
  ts: string;
  diasNoAr: number | null;
  pessoas: { id: string; nome: string }[];
  agentes: Agente[];
  eventos: Evento[];
  numeros: { entregas: number; conversas: number; tokens: number; custo: number; cacheTaxa: number | null };
  /** Consultas que falharam — aparecem discretas no rodapé em vez de sumir. */
  avisos?: string[];
}

/** Largura lógica fixa; a ALTURA acompanha o formato do painel para o desenho
 *  ocupar a tela inteira, sem faixas vazias nas laterais. Posições salvas
 *  continuam válidas porque a largura nunca muda. */
/** O arranjo dos nós vive no navegador desta tela — ver `salvarMapa`. */
const CHAVE_LAYOUT = "warroom_layout";

type Layout = { nos?: Record<string, { x: number; y: number }>; zoom?: number; panX?: number; panY?: number };

function lerLayout(): Layout {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_LAYOUT) ?? "{}") as Layout;
  } catch {
    // Armazenamento bloqueado ou JSON de uma versão antiga: cai no arranjo
    // padrão em vez de derrubar a parede inteira.
    return {};
  }
}

const VB_W = 1000;
const R_AG = 34, R_PE = 26;

/** Constelação de partida: fração da altura, para caber em qualquer formato.
 *  Depois de arrastado e salvo, o arranjo escolhido é que manda. */
const FRAC_AGENTE = [
  { x: 545, fy: 0.18 }, { x: 800, fy: 0.32 }, { x: 850, fy: 0.64 }, { x: 660, fy: 0.85 },
  { x: 430, fy: 0.83 }, { x: 370, fy: 0.52 }, { x: 470, fy: 0.31 }, { x: 745, fy: 0.52 },
];
/** Ponto de partida das pessoas — uma coluna à esquerda. */
const FRAC_PESSOA = [
  { x: 110, fy: 0.12 }, { x: 110, fy: 0.28 }, { x: 110, fy: 0.44 },
  { x: 110, fy: 0.60 }, { x: 110, fy: 0.76 }, { x: 110, fy: 0.92 },
  { x: 250, fy: 0.12 }, { x: 250, fy: 0.28 }, { x: 250, fy: 0.44 },
  { x: 250, fy: 0.60 }, { x: 250, fy: 0.76 }, { x: 250, fy: 0.92 },
];

/** Humano no Mapa Neural é hexágono ciano — a parede fala a mesma língua. */
/** Hexágono de raio r, em pontos para o <polygon> do SVG. */
function hexagono(r: number) {
  return [0, 1, 2, 3, 4, 5]
    .map((i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
    })
    .join(" ");
}

/* Só o halo sobrou aqui: anel e sigla viraram classe para o tema claro poder
   trocá-los. O halo é o mesmo nos dois — é brilho, não traço. */
const HALO = {
  ocioso:   "rgba(61,97,255,0)",
  pensando: "rgba(61,97,255,0.22)",
  longo:    "rgba(224,168,46,0.20)",
} as const;

/** Curva suave entre dois pontos: a perpendicular ao meio dá a barriga.
 *  O desvio é proporcional ao comprimento, então linha curta quase não
 *  entorta e linha longa desenha um arco de verdade. */
function curva(de: { x: number; y: number }, para: { x: number; y: number }) {
  const mx = (de.x + para.x) / 2, my = (de.y + para.y) / 2;
  const dx = para.x - de.x, dy = para.y - de.y;
  const comp = Math.hypot(dx, dy) || 1;
  const desvio = comp * 0.09;
  return `M ${de.x} ${de.y} Q ${mx - (dy / comp) * desvio} ${my + (dx / comp) * desvio} ${para.x} ${para.y}`;
}

/** Ponto sobre a mesma curva que a linha desenha — Bézier quadrática com o
 *  controle idêntico ao de `curva()`. Partícula em reta sobre linha curva
 *  denuncia o truque na hora. */
function pontoNaCurva(de: { x: number; y: number }, para: { x: number; y: number }, t: number) {
  const mx = (de.x + para.x) / 2, my = (de.y + para.y) / 2;
  const dx = para.x - de.x, dy = para.y - de.y;
  const comp = Math.hypot(dx, dy) || 1;
  const desvio = comp * 0.09;
  const cx = mx - (dy / comp) * desvio, cy = my + (dx / comp) * desvio;
  const u = 1 - t;
  return {
    x: u * u * de.x + 2 * u * t * cx + t * t * para.x,
    y: u * u * de.y + 2 * u * t * cy + t * t * para.y,
  };
}

/** Caminha por várias pernas encadeadas com velocidade constante: sem pesar
 *  pelo comprimento, a partícula aceleraria ao trocar de perna. */
function pontoNaRota(pernas: { de: { x: number; y: number }; para: { x: number; y: number } }[], t: number) {
  const comps = pernas.map((p) => Math.hypot(p.para.x - p.de.x, p.para.y - p.de.y) || 1);
  const total = comps.reduce((a, b) => a + b, 0);
  let restante = t * total;
  for (let i = 0; i < pernas.length; i++) {
    if (restante <= comps[i] || i === pernas.length - 1) {
      return { ponto: pontoNaCurva(pernas[i].de, pernas[i].para, Math.min(1, restante / comps[i])), perna: i };
    }
    restante -= comps[i];
  }
  return { ponto: pernas[0].de, perna: 0 };
}

const compacto = (n: number) =>
  new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function decorrido(desde: string | null): string {
  if (!desde) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}min ${s % 60}s` : `${s}s`;
}

export default function WarRoomPage() {
  const [params] = useSearchParams();
  // `?t=`, o mesmo parâmetro que `GET /warroom/feed` espera e que o
  // `~/hsos-token-warroom.sh` imprime pronto para colar na TV.
  const chave = params.get("t") ?? "";
  const [feed, setFeed] = useState<Feed | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const [giro, setGiro] = useState(0);
  // Instante do quadro atual — as partículas calculam a própria posição a
  // partir dele, sem precisar de um segundo laço de animação.
  const agoraFrame = Date.now();
  // Escuro por padrão — é uma parede. Mas sala clara com sol batendo na TV
  // pede o inverso, então a troca fica à mão e é lembrada no navegador.
  // Modo de edição: a parede é para ser olhada, então arrastar só acontece
  // quando alguém pede — nada de mover o mapa sem querer ao encostar na tela.
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [posManual, setPosManual] = useState<Record<string, { x: number; y: number }>>({});
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [sujo, setSujo] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  // Altura lógica do desenho, medida do painel: é o que faz o mapa ocupar a
  // tela inteira em vez de deixar faixas vazias dos lados.
  const [vbH, setVbH] = useState(620);
  // Trabalho mais curto que o intervalo entre duas leituras (4s) nunca é
  // observado como "pensando" — a parede só vê a entrega depois, e o
  // movimento durava uma passada só. O eco mantém a rota viva por um instante
  // depois da entrega, para que trabalho rápido também apareça acontecendo.
  const [ecos, setEcos] = useState<Record<string, number>>({});
  const [telaCheia, setTelaCheia] = useState(false);
  /** Partículas em voo: o trabalho atravessando a organização. */
  const [particulas, setParticulas] = useState<
    { id: number; de: { x: number; y: number }; para: { x: number; y: number }; cor: string; t0: number }[]
  >([]);
  // Leitura anterior: a animação nasce da DIFERENÇA entre duas leituras —
  // é assim que a tela sabe que algo "acabou de acontecer".
  const anterior = useRef<Map<string, { estado: string; parceiro: string | null; filhos: number }>>(new Map());
  const seqParticula = useRef(0);
  const arrasto = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const [claro, setClaro] = useState(() => localStorage.getItem("warroom_tema") === "claro");
  useEffect(() => {
    localStorage.setItem("warroom_tema", claro ? "claro" : "escuro");
  }, [claro]);
  const quadro = useRef<number>();

  // Relógio próprio: os cronômetros correm entre uma leitura e outra, então a
  // parede nunca parece congelada mesmo com o feed a cada 4s.
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0) setVbH(Math.round(Math.min(1400, Math.max(420, (VB_W * height) / width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const VB = useMemo(() => ({ w: VB_W, h: vbH }), [vbH]);
  const NUCLEO = useMemo(() => ({ x: VB_W / 2, y: vbH / 2 }), [vbH]);

  // Órbita dos satélites — animação contínua, independente do feed.
  useEffect(() => {
    const passo = () => {
      setGiro((g) => g + 0.006);
      // Partícula viva por 900ms; a limpeza acompanha o quadro para não
      // acumular nós no SVG numa tela que fica dias ligada.
      setParticulas((ps) => {
        const agoraMs = Date.now();
        const vivas = ps.filter((p) => agoraMs - p.t0 < 900);
        return vivas.length === ps.length ? ps : vivas;
      });
      quadro.current = requestAnimationFrame(passo);
    };
    quadro.current = requestAnimationFrame(passo);
    return () => { if (quadro.current) cancelAnimationFrame(quadro.current); };
  }, []);

  useEffect(() => {
    let vivo = true;
    // Mesma porta de todas as telas do app: o `api()` manda a sessão de quem
    // está logado quando existe. A TV não tem sessão e entra pelo token na URL.
    const puxar = async () => {
      try {
        const dados = await api<Feed>(
          `/warroom/feed${chave ? `?t=${encodeURIComponent(chave)}` : ""}`,
        );
        if (!vivo) return;
        setErro(null);
        setFeed(dados);
      } catch (e) {
        if (!vivo) return;
        // Mantém o último feed na tela: parede em branco não diz nada, parede
        // parada com aviso diz que algo quebrou.
        setErro(e instanceof Error ? e.message : "Não consegui carregar o painel.");
      }
    };
    puxar();
    const id = setInterval(puxar, 4000);
    return () => { vivo = false; clearInterval(id); };
  }, [chave]);


  useEffect(() => {
    const guardado = lerLayout();
    if (!guardado.nos) return;
    setPosManual(guardado.nos);
    setZoom(guardado.zoom ?? 1);
    setPan({ x: guardado.panX ?? 0, y: guardado.panY ?? 0 });
    // Só na montagem: o arranjo é do navegador, não chega mais pelo feed, e
    // relê-lo a cada busca desfaria o que a pessoa acabou de arrastar.
  }, []);

  /** Modo TV: tela cheia de verdade, sem barra do navegador. O estado vem do
   *  documento, não de um booleano nosso — sair com Esc precisa refletir aqui. */
  useEffect(() => {
    const sync = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const modoTv = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Navegador pode recusar (permissão, iframe). Silencioso de propósito:
      // é um conforto, não uma função crítica da parede.
    }
  };

  /** Pixels de tela por unidade do desenho, já com o zoom aplicado. */
  const escalaAtual = () => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return 1;
    return Math.min(r.width / VB.w, r.height / VB.h) * zoom;
  };

  /** Arrasta o fundo: só quando o gesto começa fora de um nó. */
  const comecaPan = (ev: React.PointerEvent) => {
    if (!editando || arrasto.current) return;
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    panRef.current = { x: ev.clientX, y: ev.clientY };
  };

  /** Roda do mouse dá zoom, como em qualquer canvas. */
  const roda = (ev: React.WheelEvent) => {
    if (!editando) return;
    setZoom((z) => Math.min(3, Math.max(0.25, +(z - ev.deltaY * 0.0015).toFixed(3))));
    setSujo(true);
  };

  /** Converte ponto da tela para coordenada do viewBox — o mapa é guardado em
   *  unidades do desenho, para ficar igual em qualquer tamanho de monitor. */
  const paraViewBox = (ev: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    // O viewBox é ajustado por "meet": sobra margem no eixo mais largo.
    const escala = Math.min(r.width / VB.w, r.height / VB.h);
    const margemX = (r.width - VB.w * escala) / 2;
    const margemY = (r.height - VB.h * escala) / 2;
    const bruto = {
      x: (ev.clientX - r.left - margemX) / escala,
      y: (ev.clientY - r.top - margemY) / escala,
    };
    // Desfaz zoom e deslocamento para gravar a posição "real" do nó.
    return {
      x: (bruto.x - VB.w / 2) / zoom + VB.w / 2 - pan.x,
      y: (bruto.y - VB.h / 2) / zoom + VB.h / 2 - pan.y,
    };
  };

  const comecaArrasto = (id: string, atual: { x: number; y: number }) =>
    (ev: React.PointerEvent) => {
      if (!editando) return;
      ev.stopPropagation();
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      const p = paraViewBox(ev);
      arrasto.current = { id, dx: p.x - atual.x, dy: p.y - atual.y };
    };

  const move = (ev: React.PointerEvent) => {
    // Arrastar o fundo desloca o quadro inteiro. Sem isso, um nó levado para
    // fora da área visível ficava inalcançável — não havia como ir atrás dele.
    if (panRef.current) {
      // O delta é calculado AQUI, não dentro do setPan: o atualizador roda
      // depois, e se o ponteiro soltar nesse intervalo panRef já é null —
      // era o que derrubava a tela ao clicar fora de um nó.
      const escala = escalaAtual();
      const dx = (ev.clientX - panRef.current.x) / escala;
      const dy = (ev.clientY - panRef.current.y) / escala;
      panRef.current = { x: ev.clientX, y: ev.clientY };
      setPan((q) => ({ x: q.x + dx, y: q.y + dy }));
      setSujo(true);
      return;
    }
    if (!arrasto.current) return;
    const p = paraViewBox(ev);
    const { id, dx, dy } = arrasto.current;
    setPosManual((m) => ({ ...m, [id]: { x: p.x - dx, y: p.y - dy } }));
    setSujo(true);
  };

  const soltaArrasto = () => { arrasto.current = null; panRef.current = null; };

  /** O arranjo é de cada tela, não do sistema.
   *
   * Antes ia para `app_settings` por uma edge function. Guardar no navegador
   * some com um endpoint de escrita — o único que este painel precisaria — e
   * é mais certo: a TV da sala e o notebook de quem espelha têm formatos
   * diferentes e não deveriam disputar o mesmo mapa. */
  const salvarMapa = async () => {
    setSalvando(true);
    try {
      localStorage.setItem(
        CHAVE_LAYOUT,
        JSON.stringify({ nos: posManual, zoom, panX: pan.x, panY: pan.y }),
      );
      setSujo(false);
      setEditando(false);
    } catch {
      // Navegador de TV com armazenamento bloqueado: o mapa vale a sessão.
      setSujo(false);
      setEditando(false);
    }
    setSalvando(false);
  };

  /** Arruma tudo de uma vez: humanos à esquerda, IAs à direita, o núcleo no
   *  meio. Arrastar 20 nós à mão é chato e nunca fica alinhado.
   *
   *  Dois arranjos, porque a escolha depende da tela e do tamanho do time:
   *
   *  - AMPLO (uma coluna por lado): linhas longas, muito respiro, a imagem de
   *    raios convergindo de longe. Lindo enquanto o time é pequeno.
   *  - COMPACTO (duas colunas por lado): os nós alternam entre uma coluna
   *    interna e uma externa, e a altura necessária cai pela metade. Com 8+8
   *    a escala salta de 0,53 para 0,92 — o nó quase dobra na parede.
   *
   *  A conta é feita ao contrário do intuitivo: primeiro reservo o espaço que
   *  cada nó exige, depois o enquadramento acha o zoom. Espaçar por ângulo
   *  igual numa elipse não serve — ângulo igual não é distância igual, e os
   *  nós se amontoam nas pontas.
   *
   *  Grava como posição manual porque é uma escolha: salva junto com o resto
   *  e o desfazer devolve o arranjo anterior. */
  const PASSO_NO = 126; // altura real de um nó, do círculo à linha do cronômetro

  const organizar = (porLado: 1 | 2) => {
    const cx = VB.w / 2, cy = vbH / 2;

    // Passo VERTICAL constante e x saindo da elipse: a barriga do arco aparece
    // sem que dois nós vizinhos se aproximem.
    const arco = (n: number, lado: 1 | -1, rx: number, desloca: number) => {
      const meia = ((n - 1) * PASSO_NO) / 2 || 1;
      return Array.from({ length: n }, (_, i) => {
        const dy = (i - (n - 1) / 2) * PASSO_NO + desloca;
        const k = Math.sqrt(Math.max(0, 1 - (dy / (meia * 1.06)) ** 2));
        return { x: Math.round(cx + lado * rx * (0.45 + 0.55 * k)), y: Math.round(cy + dy) };
      });
    };

    const lado = (lista: { id: string }[], dir: 1 | -1) => {
      if (porLado === 1) {
        return lista.map((no, i) => [no.id, arco(lista.length, dir, 300, 0)[i]] as const);
      }
      // Alterna entre interna e externa; a externa entra defasada em meio
      // passo, senão os rótulos das duas colunas se alinham e brigam.
      const dentro: number[] = [], fora: number[] = [];
      lista.forEach((_, i) => (i % 2 ? fora : dentro).push(i));
      const yd = arco(dentro.length, dir, 250, 0);
      const yf = arco(fora.length, dir, 470, PASSO_NO / 2);
      const saida: (readonly [string, { x: number; y: number }])[] = [];
      dentro.forEach((idx, j) => saida.push([lista[idx].id, { x: Math.round(cx + dir * 205), y: yd[j].y }]));
      fora.forEach((idx, j) => saida.push([lista[idx].id, { x: Math.round(cx + dir * 400), y: yf[j].y }]));
      return saida;
    };

    setPosManual(Object.fromEntries([
      ...lado(feed?.agentes ?? [], 1),
      ...lado(feed?.pessoas ?? [], -1),
    ]));
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSujo(true);
  };

  const desfazer = () => {
    const guardado = lerLayout();
    setPosManual(guardado.nos ?? {});
    setZoom(guardado.zoom ?? 1);
    setPan({ x: guardado.panX ?? 0, y: guardado.panY ?? 0 });
    setSujo(false);
  };

  // Posição salva à mão sempre vence a constelação automática; a automática só
  // existe para quem ainda não foi colocado no lugar.
  //
  // Agentes e pessoas são posicionados JUNTOS porque quem chega depois precisa
  // enxergar o mapa inteiro: um agente novo caindo em cima de uma pessoa que
  // você arrastou à mão vira um nó só na tela, e você jura que ele não entrou.
  const { posAgente, posPessoa } = useMemo(() => {
    const agentes = feed?.agentes ?? [];
    const pessoas = feed?.pessoas ?? [];
    const presentes = new Set([...agentes.map((a) => a.id), ...pessoas.map((p) => p.id)]);

    // Só reserva posição de quem ainda existe: entrada velha de nó apagado
    // continuaria bloqueando um lugar bom para sempre.
    const ocupados = Object.entries(posManual)
      .filter(([id]) => presentes.has(id))
      .map(([, p]) => p);
    const LIVRE = 78; // dois nós de raio 34 não se tocam a partir daqui
    const colide = (p: { x: number; y: number }) =>
      ocupados.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < LIVRE);

    const encaixar = (fracs: typeof FRAC_AGENTE, i: number) => {
      for (let k = 0; k < fracs.length; k++) {
        const f = fracs[(i + k) % fracs.length];
        const p = { x: f.x, y: Math.round(f.fy * vbH) };
        if (!colide(p)) { ocupados.push(p); return p; }
      }
      // Constelação cheia: abre uma nova coluna à direita do slot original.
      const f = fracs[i % fracs.length];
      let p = { x: f.x, y: Math.round(f.fy * vbH) };
      for (let k = 1; k <= 40 && colide(p); k++) p = { x: f.x + k * 86, y: p.y };
      ocupados.push(p);
      return p;
    };

    const ag = new Map<string, { x: number; y: number }>();
    const pe = new Map<string, { x: number; y: number }>();
    agentes.forEach((a, i) => ag.set(a.id, posManual[a.id] ?? encaixar(FRAC_AGENTE, i)));
    pessoas.forEach((p, i) => pe.set(p.id, posManual[p.id] ?? encaixar(FRAC_PESSOA, i)));
    return { posAgente: ag, posPessoa: pe };
  }, [feed?.agentes, feed?.pessoas, posManual, vbH]);

  /** Enquadramento automático: o zoom e o deslocamento saem do que está no
   *  mapa AGORA e do formato do painel AGORA — não de um número salvo.
   *
   *  Posição de nó é guardada em coordenada fixa, mas o quadro visível muda
   *  com a tela (monitor do escritório, TV de 55", notebook). Guardar o zoom
   *  junto significava que o arranjo feito numa tela chegava cortado na
   *  outra. Aqui a moldura se ajusta ao conteúdo, e nada fica de fora.
   *
   *  Durante a edição vale o zoom da mão de quem edita — senão a tela
   *  brigaria com o arraste. */
  const enquadre = useMemo(() => {
    const pts = [...posAgente.values(), ...posPessoa.values()];
    if (!pts.length) return { zoom: 1, pan: { x: 0, y: 0 } };
    // O rótulo fica ABAIXO do nó, então a folga de baixo é maior que a de cima.
    const FX = 135, FTOPO = 55, FBASE = 115;
    const x0 = Math.min(...pts.map((p) => p.x)) - FX;
    const x1 = Math.max(...pts.map((p) => p.x)) + FX;
    const y0 = Math.min(...pts.map((p) => p.y)) - FTOPO;
    const y1 = Math.max(...pts.map((p) => p.y)) + FBASE;
    const z = Math.min(2, VB.w / (x1 - x0), vbH / (y1 - y0));
    return {
      zoom: +z.toFixed(3),
      pan: { x: VB.w / 2 - (x0 + x1) / 2, y: vbH / 2 - (y0 + y1) / 2 },
    };
  }, [posAgente, posPessoa, VB.w, vbH]);

  const zoomAtivo = editando ? zoom : enquadre.zoom;
  const panAtivo = editando ? pan : enquadre.pan;

  // Diferença entre leituras → partículas. Um agente que acabou de começar a
  // pensar, uma entrega que acabou de pousar, uma rotina que nasceu sozinha.
  useEffect(() => {
    if (!feed) return;
    const antes = anterior.current;
    const agoraMapa = new Map<string, { estado: string; parceiro: string | null; filhos: number }>();
    const novas: typeof particulas = [];

    const solta = (de: { x: number; y: number } | undefined, para: { x: number; y: number } | undefined, cor: string, atraso = 0) => {
      if (!de || !para) return;
      novas.push({ id: ++seqParticula.current, de, para, cor, t0: Date.now() + atraso });
    };

    for (const a of feed.agentes) {
      const antesDele = antes.get(a.id);
      agoraMapa.set(a.id, { estado: a.estado, parceiro: a.parceiro, filhos: a.filhos.filter((f) => f.vivo).length });
      if (!antesDele) continue; // primeira leitura: não anima o que já existia

      const posA = posAgente.get(a.id);
      const posP = a.parceiro
        ? posPessoa.get(feed.pessoas.find((p) => p.nome === a.parceiro)?.id ?? "")
        : undefined;

      const começou = antesDele.estado === "ocioso" && a.estado !== "ocioso";
      const terminou = antesDele.estado !== "ocioso" && a.estado === "ocioso";

      if (começou) {
        // Veio de alguém → sai da pessoa. Nasceu sozinho → sai do núcleo, que
        // é a imagem de "ninguém pediu" acontecendo.
        if (posP) { solta(posP, NUCLEO, "var(--wr-humano)"); solta(NUCLEO, posA, "var(--wr-ink)", 420); }
        else solta(NUCLEO, posA, "var(--wr-ink)");
      }
      if (terminou) {
        setEcos((e) => ({ ...e, [a.id]: Date.now() + 2600 }));
        solta(posA, NUCLEO, "var(--wr-green)");
        if (antesDele.parceiro) {
          const alvo = posPessoa.get(feed.pessoas.find((p) => p.nome === antesDele.parceiro)?.id ?? "");
          solta(NUCLEO, alvo, "var(--wr-green)", 380);
        }
      }
      // Sub-agente novo: um pulso do agente para fora, por filho criado.
      const vivosAgora = a.filhos.filter((f) => f.vivo).length;
      if (vivosAgora > antesDele.filhos && posA) {
        for (let i = 0; i < Math.min(4, vivosAgora - antesDele.filhos); i++) {
          solta(NUCLEO, posA, "var(--wr-ink)", i * 180);
        }
      }
    }

    anterior.current = agoraMapa;
    if (novas.length) setParticulas((p) => [...p, ...novas].slice(-40));
  }, [feed, posAgente, posPessoa]);

  const ativos = (feed?.agentes ?? []).filter((a) => a.estado !== "ocioso");
  const hora = new Date(agora).toLocaleTimeString("pt-BR", { hour12: false });

  // O momento: alguém coordenando um enxame de sub-agentes.
  const enxame = ativos.find((a) => a.filhos.filter((f) => f.vivo).length >= 2) ?? null;

  /** Enquanto o agente processa, a partícula circula sem parar pelo caminho
   *  inteiro — pessoa → núcleo → agente — e recomeça. Partícula disparada por
   *  evento diz "aconteceu"; partícula circulando diz "está acontecendo", e de
   *  4 metros essa é a diferença entre uma tela e uma operação viva.
   *
   *  Sai do relógio, não de estado: nada acumula na memória por mais que o
   *  trabalho demore. */
  /** Rotas em movimento. Sem memo de propósito: depende do relógio (os ecos
   *  vencem) e a conta é de dezesseis nós — memorizar custaria mais que
   *  refazer. */
  const rotasVivas = (() => {
    const idsAtivos = new Set(ativos.map((a) => a.id));
    const comEco = (feed?.agentes ?? []).filter(
      (a) => !idsAtivos.has(a.id) && (ecos[a.id] ?? 0) > agoraFrame,
    );
    return [...ativos, ...comEco].map((a) => {
      const destino = posAgente.get(a.id);
      if (!destino) return null;
      // Quem pediu pode ser uma pessoa ou outro agente. No segundo caso a
      // rota liga os dois nós direto: o trabalho não passa por um humano.
      const origem = a.parceiroAgente
        ? posAgente.get(a.parceiroAgente)
        : a.parceiro
        ? posPessoa.get((feed?.pessoas ?? []).find((p) => p.nome === a.parceiro)?.id ?? "")
        : null;
      const entreAgentes = !!a.parceiroAgente;
      // O ciclo FECHA: vai e volta. Antes a partícula chegava no agente e
      // reaparecia na origem, o que lia como uma passada só, não como um
      // circuito. Agora ela retorna pelo mesmo caminho.
      const pernas = entreAgentes && origem
        ? [{ de: origem, para: destino }, { de: destino, para: origem }]
        : origem
        ? [
            { de: origem, para: NUCLEO }, { de: NUCLEO, para: destino },
            { de: destino, para: NUCLEO }, { de: NUCLEO, para: origem },
          ]
        : [{ de: NUCLEO, para: destino }, { de: destino, para: NUCLEO }];
      return {
        id: a.id, pernas,
        humanas: origem && !entreAgentes ? [0, 3] : [],
        // Na volta a cor é a da entrega: o trabalho voltando com resposta.
        volta: entreAgentes ? [1] : origem ? [2, 3] : [1],
        longo: a.estado === "longo",
      };
    }).filter(Boolean) as {
      id: string;
      pernas: { de: { x: number; y: number }; para: { x: number; y: number } }[];
      humanas: number[]; volta: number[]; longo: boolean;
    }[];
  })();

  if (erro) {
    return (
      <div className={`wr-raiz ${claro ? "wr-claro" : ""}`} style={{ display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 460 }}>
          <p className="wr-eyebrow">war room</p>
          <h1 style={{ fontSize: 28, margin: "10px 0 8px" }}>Painel indisponível</h1>
          <p style={{ color: "var(--wr-muted)", fontSize: 15 }}>{erro}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`wr-raiz ${claro ? "wr-claro" : ""}`}>
      <div className="wr-tv">
        <header className="wr-topo">
          <div className="wr-marca">
            <img
              src={"/HS-OS-logo.png"}
              alt="HS.OS"
              className="wr-logo"
            />
            <b>{"\n"}</b><span>war room</span>
          </div>
          <div className="wr-topo-dir">
            <div className="wr-sinal">
              <i className="wr-batida" />
              AO VIVO
            </div>
            <div className="wr-sinal">
              {ativos.length === 0
                ? "time em repouso"
                : `${ativos.length} agente${ativos.length > 1 ? "s" : ""} trabalhando`}
            </div>
            <div className="wr-relogio">{hora}</div>

            {/* Controles discretos: somem visualmente na parede, existem
                quando alguém precisa. */}
            <div className="wr-controles">
              {editando && (
                <>
                  <button type="button" onClick={() => setZoom((z) => { setSujo(true); return Math.max(0.25, +(z - 0.1).toFixed(2)); })}
                    title="Afastar" aria-label="Afastar">
                    <ZoomOut size={16} />
                  </button>
                  <span className="wr-zoom" title="Nível de zoom">{Math.round(zoom * 100)}%</span>
                  <button type="button" onClick={() => setZoom((z) => { setSujo(true); return Math.min(3, +(z + 0.1).toFixed(2)); })}
                    title="Aproximar" aria-label="Aproximar">
                    <ZoomIn size={16} />
                  </button>
                  <button type="button" onClick={() => organizar(1)}
                    title="Organizar amplo — uma coluna por lado, linhas longas"
                    aria-label="Organizar amplo">
                    <Sparkles size={16} />
                  </button>
                  <button type="button" onClick={() => organizar(2)}
                    title="Organizar compacto — duas colunas por lado, nós maiores"
                    aria-label="Organizar compacto">
                    <LayoutGrid size={16} />
                  </button>
                  {sujo && (
                    <button type="button" onClick={desfazer} title="Descartar as mudanças" aria-label="Descartar as mudanças">
                      <RotateCcw size={16} />
                    </button>
                  )}
                  <button type="button" onClick={salvarMapa} disabled={salvando || !sujo}
                    className={sujo ? "wr-salvar" : ""}
                    title={sujo ? "Salvar o mapa" : "Nada mudou ainda"}
                    aria-label="Salvar o mapa">
                    <Check size={16} />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setEditando((v) => !v)}
                className={editando ? "wr-ativo" : ""}
                title={editando ? "Sair do modo de organizar" : "Organizar o mapa (arrastar e dar zoom)"}
                aria-label="Organizar o mapa"
              >
                <Move size={16} />
              </button>
              <button
                type="button"
                onClick={() => setClaro((v) => !v)}
                title={claro ? "Usar tema escuro" : "Usar tema claro"}
                aria-label={claro ? "Usar tema escuro" : "Usar tema claro"}
              >
                {claro ? <Moon size={16} /> : <Sun size={16} />}
              </button>
              <button
                type="button"
                onClick={modoTv}
                className={telaCheia ? "wr-ativo" : ""}
                title={telaCheia ? "Sair do modo TV" : "Modo TV — tela cheia"}
                aria-label={telaCheia ? "Sair do modo TV" : "Modo TV"}
              >
                {telaCheia ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
              <Link to="/chat" title="Voltar para o chat" aria-label="Voltar para o chat">
                <ArrowLeft size={16} />
              </Link>
            </div>
          </div>
        </header>

        <main className="wr-palco">
          <section className="wr-painel">
            <header><span>o time HS.OS em tempo real</span><span>humanos e IAs como um só time</span></header>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${VB.w} ${VB.h}`}
              preserveAspectRatio="xMidYMid meet"
              className={`wr-mapa ${editando ? "wr-editando" : ""}`}
              onPointerDown={comecaPan}
              onWheel={roda}
              onPointerMove={move}
              onPointerUp={soltaArrasto}
              onPointerLeave={soltaArrasto}
            >
              <defs>
                <filter id="wr-brilho" x="-70%" y="-70%" width="240%" height="240%">
                  <feGaussianBlur stdDeviation="7" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                {/* As linhas não chegam a tocar o núcleo: elas se dissolvem por
                    perto. Dezesseis retas cravando o mesmo pixel viram teia de
                    aranha — dissolvidas, viram convergência. */}
                <radialGradient id="wr-dissolve" gradientUnits="userSpaceOnUse"
                  cx={NUCLEO.x} cy={NUCLEO.y} r={Math.max(VB.w, vbH) * 0.55}>
                  <stop offset="0%" stopColor="#000" />
                  <stop offset="9%" stopColor="#000" />
                  <stop offset="34%" stopColor="#fff" />
                </radialGradient>
                <mask id="wr-mascara-linhas">
                  <rect x={-VB.w} y={-vbH} width={VB.w * 3} height={vbH * 3} fill="url(#wr-dissolve)" />
                </mask>
              </defs>

              {/* Zoom e deslocamento aplicados ao desenho inteiro, em torno do
                  centro — o viewBox continua o mesmo, o que mantém as posições
                  salvas válidas em qualquer tela. */}
              <g transform={`translate(${VB.w / 2} ${VB.h / 2}) scale(${zoomAtivo}) translate(${-VB.w / 2 + panAtivo.x} ${-VB.h / 2 + panAtivo.y})`}>
              {/* Linhas: pessoas → núcleo → agentes. Acendem com trabalho.
                  Curvas, não retas: reta é diagrama, curva é organismo. */}
              <g mask="url(#wr-mascara-linhas)">
              {(feed?.pessoas ?? []).map((p) => {
                const pos = posPessoa.get(p.id); if (!pos) return null;
                const falando = ativos.some((a) => a.parceiro === p.nome);
                return (
                  <path key={`l-${p.id}`} d={curva(pos, NUCLEO)} fill="none"
                    className={falando ? "wr-linha wr-viva-h" : "wr-linha"}
                    strokeWidth={falando ? 2 : 1.4} />
                );
              })}
              {/* IA pedindo para IA: a linha liga os dois direto, sem passar
                  pelo núcleo. É o desenho mais literal do "mesmo time" — e
                  ela só existe enquanto o trabalho acontece. */}
              {(feed?.agentes ?? []).map((a) => {
                const de = a.parceiroAgente ? posAgente.get(a.parceiroAgente) : null;
                const para = posAgente.get(a.id);
                if (!de || !para) return null;
                return (
                  <path key={`aa-${a.id}`} d={curva(de, para)} fill="none"
                    className="wr-linha wr-viva" strokeWidth={2} />
                );
              })}
              {(feed?.agentes ?? []).map((a) => {
                const pos = posAgente.get(a.id); if (!pos) return null;
                const ativo = a.estado !== "ocioso";
                return (
                  <path key={`la-${a.id}`} d={curva(NUCLEO, pos)} fill="none"
                    className={ativo ? "wr-linha wr-viva" : "wr-linha"}
                    strokeWidth={ativo ? 2 : 1.4} />
                );
              })}
              </g>

              {/* O núcleo é o HS.OS. Era um ponto de 5px onde deveria estar o
                  coração da cena — agora respira, e é para onde tudo converge. */}
              <g transform={`translate(${NUCLEO.x},${NUCLEO.y})`} className="wr-nucleo">
                <circle r={30} className="wr-nucleo-onda" fill="none" strokeWidth={1} />
                <circle r={30} className="wr-nucleo-onda wr-atraso" fill="none" strokeWidth={1} />
                <circle r={19} fill="none" className="wr-nucleo-anel" strokeWidth={1.2} opacity={0.55} />
                <circle r={11} fill="none" className="wr-nucleo-anel" strokeWidth={1} opacity={0.3} />
                <circle r={6} className="wr-nucleo-ponto" />
                <text y={54} textAnchor="middle" className="wr-nucleo-rotulo">HS.OS</text>
              </g>

              {(feed?.pessoas ?? []).map((p, i) => {
                const pos = posPessoa.get(p.id); if (!pos) return null;
                const emConversa = ativos.some((a) => a.parceiro === p.nome);
                return (
                  <g
                    key={p.id}
                    transform={`translate(${pos.x},${pos.y})`}
                    onPointerDown={comecaArrasto(p.id, pos)}
                    style={{ cursor: editando ? "grab" : "default" }}
                  >
                    {emConversa && (
                      <polygon points={hexagono(R_PE + 7)} fill="none"
                        className="wr-hex-halo" strokeWidth={2} opacity={0.5} />
                    )}
                    <polygon
                      points={hexagono(R_PE)}
                      className={`wr-corpo-h wr-hex${emConversa ? " wr-viva" : ""}`}
                      strokeWidth={1.6}
                      style={{ animationDelay: `${(i % 8) * 0.55 + 0.3}s` }}
                    />
                    <text textAnchor="middle" dy="0.36em" fontSize={18} fontWeight={800}
                      className={`wr-inicial${emConversa ? " wr-viva" : ""}`}>
                      {p.nome.slice(0, 1).toUpperCase()}
                    </text>
                    <text textAnchor="middle" y={R_PE + 28} fontSize={16} className="wr-nome">{p.nome}</text>
                    <text textAnchor="middle" y={R_PE + 46} fontSize={11} className="wr-tarefa">time HS.OS</text>
                  </g>
                );
              })}

              {(feed?.agentes ?? []).map((a, i) => {
                const pos = posAgente.get(a.id); if (!pos) return null;
                const halo = HALO[a.estado];
                const C = 2 * Math.PI * (R_AG + 6);
                return (
                  <g
                    key={a.id}
                    transform={`translate(${pos.x},${pos.y})`}
                    onPointerDown={comecaArrasto(a.id, pos)}
                    style={{ cursor: editando ? "grab" : "default" }}
                  >
                    <circle r={R_AG + 10} fill={halo} filter="url(#wr-brilho)" />
                    <circle r={R_AG + 6} fill="none" className="wr-trilho" strokeWidth={3} />
                    {/* Anel de contexto: quanto da janela do agente está ocupada.
                        ⚠️ Só desenha quando a janela é conhecida. Anel zerado se
                        lê na parede como "contexto limpo", que é afirmação — e
                        `strictNullChecks` está desligado neste projeto, então o
                        compilador não pegaria o nulo virando NaN aqui. */}
                    {a.contexto !== null && a.contexto !== undefined && (
                      <circle r={R_AG + 6} fill="none" strokeWidth={3} strokeLinecap="round"
                        transform="rotate(-90)"
                        className={`wr-ctx${a.contexto > 0.8 ? " wr-longo" : ""}`}
                        strokeDasharray={C} strokeDashoffset={C * (1 - a.contexto)} />
                    )}
                    <circle r={R_AG} className={`wr-corpo wr-anel wr-${a.estado}`} strokeWidth={1.5}
                      style={{ animationDelay: `${(i % 8) * 0.55}s` }} />
                    <text textAnchor="middle" dy="0.36em" fontSize={24} fontWeight={800}
                      className={`wr-sigla wr-${a.estado}`}>
                      {a.nome.slice(0, 2).toUpperCase()}
                    </text>

                    {/* Satélites: os sub-agentes que este agente criou */}
                    {a.filhos.slice(0, 10).map((f, i, arr) => {
                      const ang = (i / arr.length) * Math.PI * 2 + giro * (1 + i * 0.04);
                      const raio = R_AG + 30;
                      return (
                        // Quem já terminou fica alguns instantes apagado antes de
                        // sair: o enxame que durou 20s ainda é visto da parede.
                        <g key={f.nome + i} transform={`translate(${Math.cos(ang) * raio},${Math.sin(ang) * raio})`}
                           opacity={f.vivo ? 1 : 0.32}>
                          <circle r={6} className="wr-sat-ponto" opacity={0.95} />
                          <text y={-11} fontSize={9} textAnchor="middle"
                            className="wr-satelite" opacity={0.75}>{f.nome}</text>
                        </g>
                      );
                    })}

                    <text textAnchor="middle" y={R_AG + 30} fontSize={16} className="wr-nome">{a.nome}</text>
                    <text textAnchor="middle" y={R_AG + 49} fontSize={11.5} className="wr-tarefa"
                      fill={a.estado === "ocioso" ? "#5C6070" : "#A8B3C7"}>
                      {a.tarefa ?? a.papel}
                    </text>
                    <text textAnchor="middle" y={R_AG + 66} fontSize={10.5} className="wr-crono">
                      {decorrido(a.desde)}
                    </text>
                  </g>
                );
              })}
              {/* Circulação contínua: enquanto o agente pensa, o caminho dele
                  fica em movimento. Três partículas defasadas por rota. */}
              {rotasVivas.flatMap((r) =>
                [0, 1, 2].map((i) => {
                  // 3,2s para o circuito inteiro: ida e volta na mesma
                  // velocidade de antes, agora com o dobro de caminho.
                  const t = (((agoraFrame / 3200) + i / 3) % 1);
                  const { ponto, perna } = pontoNaRota(r.pernas, t);
                  const cor = r.longo ? "var(--wr-amber)"
                    : r.volta.includes(perna) ? "var(--wr-green)"
                    : r.humanas.includes(perna) ? "var(--wr-humano)"
                    : "var(--wr-ink)";
                  // Nasce e morre em fade: partícula que aparece do nada na
                  // origem pisca e vira ruído na periferia da visão.
                  const opacidade = Math.min(1, Math.min(t, 1 - t) * 14);
                  return (
                    <circle key={`v-${r.id}-${i}`} r={3} cx={ponto.x} cy={ponto.y}
                      opacity={opacidade}
                      style={{ fill: cor, filter: `drop-shadow(0 0 5px ${cor})` }} />
                  );
                })
              )}

              {/* Partículas: o trabalho viajando pela linha. Posição calculada
                  no próprio quadro — o loop de animação já redesenha a tela. */}
              {particulas.map((p) => {
                const k = (agoraFrame - p.t0) / 900;
                if (k < 0 || k > 1) return null;
                const e = 1 - Math.pow(1 - k, 2); // desacelera ao chegar
                return (
                  <circle
                    key={p.id}
                    r={3.5}
                    cx={p.de.x + (p.para.x - p.de.x) * e}
                    cy={p.de.y + (p.para.y - p.de.y) * e}
                    opacity={k > 0.85 ? (1 - k) / 0.15 : 1}
                    style={{ fill: p.cor, filter: `drop-shadow(0 0 6px ${p.cor})` }}
                  />
                );
              })}
              </g>
            </svg>
          </section>

          <section className="wr-painel">
            <header><span>fluxo</span><span>última hora</span></header>
            <div className="wr-fluxo">
              {(feed?.eventos ?? []).length === 0 && (
                <div className="wr-evento">
                  <span className="wr-hora">—</span>
                  <span className="wr-txt">Nenhum trabalho registrado hoje. O time está em repouso.</span>
                </div>
              )}
              {(feed?.eventos ?? []).map((e, i) => (
                <div key={e.ts + i} className={`wr-evento ${e.tipo}`}>
                  <span className="wr-hora">
                    {new Date(e.ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="wr-txt">
                    {/* ⚠️ Era `dangerouslySetInnerHTML` e virou filho normal
                        em 01/09/2026. `texto` é montado com o conteúdo cru de
                        `conversations` — que comprovadamente carrega HTML e CSS
                        de artefato publicado — e ia direto para o DOM de uma
                        tela que qualquer pessoa com o link da TV enxerga. O
                        `montar_eventos` não emite marcação nenhuma, então não
                        havia o que ganhar; a edge antiga é que grifava com
                        `<b>` no `humanizar()`. React escapa sozinho. */}
                    <span>{e.texto}</span>
                    {e.tipo === "autonomo" && <span className="wr-selo">ninguém pediu</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="wr-base">
          <div className="wr-numero">
            <span className="wr-rotulo">entregas hoje</span>
            <span className="wr-valor">{feed?.numeros.entregas ?? 0}</span>
            <span className="wr-nota">respostas concluídas</span>
          </div>
          <div className="wr-numero">
            <span className="wr-rotulo">conversas atendidas</span>
            <span className="wr-valor">{feed?.numeros.conversas ?? 0}</span>
            <span className="wr-nota">com {feed?.pessoas.length ?? 0} pessoas do time</span>
          </div>
          <div className="wr-numero">
            <span className="wr-rotulo">tokens processados</span>
            <span className="wr-valor">{compacto(feed?.numeros.tokens ?? 0)}</span>
            {/* Sem `cached_tokens` escrito por ninguém, "0% servidos por cache"
                seria uma medição inventada. A linha some. */}
            {feed?.numeros.cacheTaxa != null && (
              <span className="wr-nota">{feed.numeros.cacheTaxa}% servidos por cache</span>
            )}
          </div>
          <div className="wr-numero">
            <span className="wr-rotulo">custo do dia</span>
            <span className="wr-valor">${(feed?.numeros.custo ?? 0).toFixed(2)}</span>
            <span className="wr-nota">medido por chamada</span>
          </div>
        </footer>
      </div>

      {(feed?.avisos?.length ?? 0) > 0 && (
        <div className="wr-aviso" title={feed?.avisos?.join(" · ")}>
          {feed?.avisos?.length} consulta{(feed?.avisos?.length ?? 0) > 1 ? "s" : ""} falhou — passe o mouse
        </div>
      )}

      {/* O momento: agente criando agentes, ao vivo */}
      <div className={`wr-momento ${enxame ? "on" : ""}`}>
        <div className="wr-momento-icone">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round"
            style={{ stroke: "var(--wr-ink)" }}>
            <circle cx="12" cy="12" r="3" /><circle cx="12" cy="3.5" r="1.8" /><circle cx="20.5" cy="12" r="1.8" />
            <circle cx="12" cy="20.5" r="1.8" /><circle cx="3.5" cy="12" r="1.8" />
            <path d="M12 5.3v3.7M12 15v3.7M5.3 12h3.7M15 12h3.7" />
          </svg>
        </div>
        <div>
          <div className="wr-momento-titulo">
            {enxame ? `${enxame.nome} está coordenando ${enxame.filhos.filter((f) => f.vivo).length} sub-agentes` : ""}
          </div>
          <div className="wr-momento-sub">trabalho autônomo em andamento</div>
        </div>
      </div>
    </div>
  );
}
