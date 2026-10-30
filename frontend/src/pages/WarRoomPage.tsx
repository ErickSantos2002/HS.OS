import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Sun, Moon, ArrowLeft, Maximize, Minimize } from "lucide-react";
import { api } from "@/lib/api";
import { type Feed, type Pessoa, contarConversas, horaMinuto, normalizar } from "@/lib/warroom-feed";
import {
  FONTE, QUADRO, R_AGENTE, R_PESSOA, ROTULO_AGENTE, ROTULO_PESSOA, ROTULO_STATUS, calcularLayout,
} from "@/lib/warroom-layout";
import "@/styles/warroom.css";

/**
 * War room — a tela de parede do escritório, e desde 16/10/2026 a TV da empresa.
 *
 * Não é dashboard (que se consulta), é vitrine (que se assiste): um
 * organograma vivo onde humanos e agentes ocupam o mesmo plano e o trabalho
 * viaja pelas linhas.
 *
 * Posições FIXAS de propósito, calculadas por `calcularLayout` (núcleo no
 * centro, agentes num anel interno, pessoas num anel externo por setor). Grafo
 * de força se reorganiza sozinho e vira ruído a 4 metros; com posições estáveis
 * quem trabalha na sala aprende o mapa e o movimento passa a significar
 * trabalho, não recálculo de layout.
 *
 * ⚠️ **A tela é pública** — visitante vê, e o link da TV é a credencial.
 * Nenhum texto de mensagem aparece aqui: o feed só traz nomes, ids, horários,
 * contagens e frases fixas, e o que não vem no feed não tem como vazar.
 *
 * Acesso por dois caminhos: espelhando de um computador logado (basta abrir
 * /warroom — a sessão autentica) ou direto numa TV, que não faz login, com o
 * token dedicado na URL (/warroom?t=…).
 */

/** O status vence a presença: em reunião com o HS.OS aberto é âmbar. Verde é
 *  estar no HS.OS (heartbeat), não no EscritorioHS — ver `montar_pessoas`. */
function corDoPonto(p: Pessoa): string | null {
  if (p.status === "reuniao" || p.status === "foco") return "var(--wr-amber)";
  if (p.status === "almoco" || p.status === "ausente") return "var(--wr-muted)";
  return p.online ? "var(--wr-green)" : null;
}

type XY = { x: number; y: number };

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
function curva(de: XY, para: XY) {
  const mx = (de.x + para.x) / 2, my = (de.y + para.y) / 2;
  const dx = para.x - de.x, dy = para.y - de.y;
  const comp = Math.hypot(dx, dy) || 1;
  const desvio = comp * 0.09;
  return `M ${de.x} ${de.y} Q ${mx - (dy / comp) * desvio} ${my + (dx / comp) * desvio} ${para.x} ${para.y}`;
}

/** Ponto sobre a mesma curva que a linha desenha — Bézier quadrática com o
 *  controle idêntico ao de `curva()`. Partícula em reta sobre linha curva
 *  denuncia o truque na hora. */
function pontoNaCurva(de: XY, para: XY, t: number) {
  const mx = (de.x + para.x) / 2, my = (de.y + para.y) / 2;
  const dx = para.x - de.x, dy = para.y - de.y;
  const comp = Math.hypot(dx, dy) || 1;
  const desvio = comp * 0.09;
  return bezier(de, { x: mx - (dy / comp) * desvio, y: my + (dx / comp) * desvio }, para, t);
}

function bezier(de: XY, c: XY, para: XY, t: number): XY {
  const u = 1 - t;
  return {
    x: u * u * de.x + 2 * u * t * c.x + t * t * para.x,
    y: u * u * de.y + 2 * u * t * c.y + t * t * para.y,
  };
}

/** Controle da linha entre duas PESSOAS: o meio puxado 35% para o núcleo.
 *
 *  ⚠️ Não serve a `curva()`: a barriga dela é perpendicular, e o lado depende
 *  de quem é `a` e quem é `b`. Entre duas pessoas vizinhas no anel, metade das
 *  vezes ela abria para FORA — por cima dos nomes. Puxando para o centro a
 *  linha sempre passa por dentro do anel, onde não há rótulo. */
function controleTime(de: XY, para: XY, nucleo: XY, agentes: XY[], pessoas: XY[], rP: number): XY {
  const mx = (de.x + para.x) / 2, my = (de.y + para.y) / 2;
  const padrao = { x: mx + (nucleo.x - mx) * 0.35, y: my + (nucleo.y - my) * 0.35 };

  // ⚠️ Pessoas em lados OPOSTOS do anel: o meio já é o núcleo, puxar para ele
  // não entorta nada, e a linha saía reta atravessando o HS.OS e um agente —
  // de longe lia "Gabriel → núcleo → Iris → Ellen", uma afirmação falsa numa
  // tela cujo trabalho é dizer quem fala com quem. Quando a curva padrão
  // encosta num agente ou no núcleo, ela contorna: o controle vai para a
  // perpendicular do segmento, no MENOR afastamento que livra tudo. Afastar
  // demais é o mesmo erro do outro lado: a linha passava por cima do anel de
  // pessoas e "ligava" quem não estava na conversa. Por isso as outras
  // pessoas — nó e nome — também são obstáculo.
  const obstaculos = [
    { p: nucleo, r: 40 },
    // O agente e as linhas embaixo dele (nome, "conversando com …", tempo).
    ...agentes.flatMap((p) => [
      { p, r: R_AGENTE + 14 },
      ...[ROTULO_AGENTE.nome - 6, ROTULO_AGENTE.linha2 - 4, ROTULO_AGENTE.linha3 - 4].flatMap((y) =>
        // ±120: "conversando com Karolaine" tem ~220 de largura.
        [-120, -90, -60, -30, 0, 30, 60, 90, 120].map((dx) => ({ p: { x: p.x + dx, y: p.y + R_AGENTE + y }, r: 14 }))),
    ]),
    // A pessoa, o nome e o status — mesmas medidas que o layout testa.
    ...pessoas.flatMap((p) => {
      const e = rP / R_PESSOA;
      return [
        { p, r: rP + 6 },
        { p: { x: p.x, y: p.y + rP + (ROTULO_PESSOA.nome - 6) * e }, r: 18 * e },
        { p: { x: p.x, y: p.y + rP + (ROTULO_PESSOA.status - 4) * e }, r: 14 * e },
      ];
    }),
  ];
  const folga = (c: XY) => {
    let min = Infinity;
    for (let i = 1; i < 24; i++) {
      const q = bezier(de, c, para, i / 24);
      for (const o of obstaculos) min = Math.min(min, Math.hypot(q.x - o.p.x, q.y - o.p.y) - o.r);
    }
    return min;
  };
  if (folga(padrao) >= 8) return padrao;

  const dx = para.x - de.x, dy = para.y - de.y;
  const comp = Math.hypot(dx, dy) || 1;
  const nx = -dy / comp, ny = dx / comp;
  let melhor = padrao, melhorFolga = folga(padrao);
  // O ápice da quadrática fica no meio do caminho entre o meio e o controle,
  // então o controle vai ao dobro da distância que se quer de afastamento.
  // Do menor para o maior: o primeiro que livra tudo é o que vale. Se nenhum
  // livrar, fica o de mais folga.
  for (let d = 120; d <= 320; d += 15)
    for (const lado of [1, -1]) {
      const c = { x: mx + nx * lado * 2 * d, y: my + ny * lado * 2 * d };
      const f = folga(c);
      if (f >= 4) return c;
      if (f > melhorFolga) { melhor = c; melhorFolga = f; }
    }
  return melhor;
}

/** Caminha por várias pernas encadeadas com velocidade constante: sem pesar
 *  pelo comprimento, a partícula aceleraria ao trocar de perna. */
function pontoNaRota(pernas: { de: XY; para: XY }[], t: number) {
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
  // Hora da última leitura que deu certo — é o que o aviso de parede parada
  // mostra quando a busca começa a falhar.
  const [lidoEm, setLidoEm] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
  // Instante do quadro atual — as partículas calculam a própria posição a
  // partir dele, sem precisar de um segundo laço de animação.
  const agoraFrame = Date.now();
  // Trabalho mais curto que o intervalo entre duas leituras (4s) nunca é
  // observado como "pensando" — a parede só vê a entrega depois, e o
  // movimento durava uma passada só. O eco mantém a rota viva por um instante
  // depois da entrega, para que trabalho rápido também apareça acontecendo.
  const [ecos, setEcos] = useState<Record<string, number>>({});
  const [telaCheia, setTelaCheia] = useState(false);
  /** Partículas em voo: o trabalho atravessando a organização. */
  const [particulas, setParticulas] = useState<
    { id: number; de: XY; para: XY; cor: string; t0: number }[]
  >([]);
  // Leitura anterior: a animação nasce da DIFERENÇA entre duas leituras —
  // é assim que a tela sabe que algo "acabou de acontecer".
  const anterior = useRef<Map<string, { estado: string; parceiroId: string | null }>>(new Map());
  const seqParticula = useRef(0);

  // Escuro por padrão — é uma parede. Mas sala clara com sol batendo na TV
  // pede o inverso, então a troca fica à mão e é lembrada no navegador.
  const [claro, setClaro] = useState(() => {
    try { return localStorage.getItem("warroom_tema") === "claro"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("warroom_tema", claro ? "claro" : "escuro"); } catch { /* bloqueado */ }
  }, [claro]);

  // O arranjo arrastável saiu em 16/10/2026: o layout por setor é o produto, e
  // um mapa velho guardado na TV sobreporia o novo.
  useEffect(() => { try { localStorage.removeItem("warroom_layout"); } catch { /* bloqueado */ } }, []);

  const quadro = useRef<number>();

  // Relógio próprio: os cronômetros correm entre uma leitura e outra, então a
  // parede nunca parece congelada mesmo com o feed a cada 4s.
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Laço de animação: redesenha as partículas a cada quadro.
  useEffect(() => {
    const passo = () => {
      // Partícula viva por 900ms; a limpeza acompanha o quadro para não
      // acumular nós no SVG numa tela que fica dias ligada. Devolver uma
      // lista nova a cada quadro é também o que faz a tela redesenhar.
      setParticulas((ps) => {
        const agoraMs = Date.now();
        return ps.filter((p) => agoraMs - p.t0 < 900);
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
        const dados = await api<unknown>(
          `/warroom/feed${chave ? `?t=${encodeURIComponent(chave)}` : ""}`,
        );
        if (!vivo) return;
        setErro(null);
        setLidoEm(Date.now());
        // ⚠️ Normalizar aqui, não confiar na resposta: front e back não sobem
        // juntos, e em 01/09 um `filhos` ausente derrubou a parede inteira.
        setFeed(normalizar(dados));
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

  // Posições: tudo sai do layout puro, testado em `warroom-layout.test.ts`.
  const layout = useMemo(() => calcularLayout({
    setores: feed?.setores ?? [],
    agentes: (feed?.agentes ?? []).map((a) => a.id),
    nomes: Object.fromEntries((feed?.pessoas ?? []).map((p) => [p.id, p.nome])),
  }), [feed?.setores, feed?.agentes, feed?.pessoas]);
  const posPessoa = useMemo(() => new Map(Object.entries(layout.pessoas)), [layout]);
  const posAgente = useMemo(() => new Map(Object.entries(layout.agentes)), [layout]);
  const NUCLEO = layout.nucleo;
  // Controle de cada linha de DM: a busca do contorno amostra a curva, então
  // sai do laço de animação e só refaz quando muda o mapa ou a lista de DMs.
  const controlesDm = useMemo(() => {
    const agentes = Object.values(layout.agentes);
    const r = R_PESSOA * layout.escala;
    const m = new Map<string, XY>();
    for (const c of feed?.conversasTime ?? []) {
      const de = layout.pessoas[c.a], para = layout.pessoas[c.b];
      if (!de || !para) continue;
      const outras = Object.entries(layout.pessoas).filter(([id]) => id !== c.a && id !== c.b).map(([, p]) => p);
      m.set(`${c.a}-${c.b}`, controleTime(de, para, layout.nucleo, agentes, outras, r));
    }
    return m;
  }, [layout, feed?.conversasTime]);
  const rP = R_PESSOA * layout.escala;

  // Diferença entre leituras → partículas. Um agente que acabou de começar a
  // pensar, uma entrega que acabou de pousar.
  useEffect(() => {
    if (!feed) return;
    const antes = anterior.current;
    const agoraMapa = new Map<string, { estado: string; parceiroId: string | null }>();
    const novas: typeof particulas = [];

    const solta = (de: XY | undefined, para: XY | undefined, cor: string, atraso = 0) => {
      if (!de || !para) return;
      novas.push({ id: ++seqParticula.current, de, para, cor, t0: Date.now() + atraso });
    };

    for (const a of feed.agentes) {
      const antesDele = antes.get(a.id);
      agoraMapa.set(a.id, { estado: a.estado, parceiroId: a.parceiroId });
      if (!antesDele) continue; // primeira leitura: não anima o que já existia

      const posA = posAgente.get(a.id);
      const posP = posPessoa.get(a.parceiroId ?? "");

      const começou = antesDele.estado === "ocioso" && a.estado !== "ocioso";
      const terminou = antesDele.estado !== "ocioso" && a.estado === "ocioso";

      if (começou) {
        // Veio de alguém → sai da pessoa. Nasceu sozinho → sai do núcleo, que
        // é a imagem de "ninguém pediu" acontecendo.
        if (posP) { solta(posP, layout.nucleo, "var(--wr-humano)"); solta(layout.nucleo, posA, "var(--wr-ink)", 420); }
        else solta(layout.nucleo, posA, "var(--wr-ink)");
      }
      if (terminou) {
        setEcos((e) => ({ ...e, [a.id]: Date.now() + 2600 }));
        solta(posA, layout.nucleo, "var(--wr-green)");
        solta(layout.nucleo, posPessoa.get(antesDele.parceiroId ?? ""), "var(--wr-green)", 380);
      }
    }

    anterior.current = agoraMapa;
    if (novas.length) setParticulas((p) => [...p, ...novas].slice(-40));
  }, [feed, posAgente, posPessoa, layout.nucleo]);

  const ativos = (feed?.agentes ?? []).filter((a) => a.estado !== "ocioso");
  const hora = new Date(agora).toLocaleTimeString("pt-BR", { hour12: false });
  const nConversas = feed ? contarConversas(feed) : 0;

  // Quem está numa linha agora: ponta de agente ativo ou de um DM vivo.
  const comAgente = new Set(ativos.map((a) => a.parceiroId).filter(Boolean) as string[]);
  const emDm = new Set((feed?.conversasTime ?? []).flatMap((c) => [c.a, c.b]));

  /** Enquanto o agente processa, a partícula circula sem parar pelo caminho
   *  inteiro — pessoa → núcleo → agente — e recomeça. Partícula disparada por
   *  evento diz "aconteceu"; partícula circulando diz "está acontecendo", e de
   *  4 metros essa é a diferença entre uma tela e uma operação viva.
   *
   *  Sai do relógio, não de estado: nada acumula na memória por mais que o
   *  trabalho demore. Sem memo de propósito: depende do relógio (os ecos
   *  vencem) e a conta é de poucos nós. */
  const rotasVivas = (() => {
    const idsAtivos = new Set(ativos.map((a) => a.id));
    const comEco = (feed?.agentes ?? []).filter(
      (a) => !idsAtivos.has(a.id) && (ecos[a.id] ?? 0) > agoraFrame,
    );
    return [...ativos, ...comEco].map((a) => {
      const destino = posAgente.get(a.id);
      if (!destino) return null;
      const origem = posPessoa.get(a.parceiroId ?? "");
      // O ciclo FECHA: vai e volta pelo mesmo caminho, que lê como circuito.
      const pernas = origem
        ? [
            { de: origem, para: NUCLEO }, { de: NUCLEO, para: destino },
            { de: destino, para: NUCLEO }, { de: NUCLEO, para: origem },
          ]
        : [{ de: NUCLEO, para: destino }, { de: destino, para: NUCLEO }];
      return {
        id: a.id, pernas,
        humanas: origem ? [0, 3] : [],
        // Na volta a cor é a da entrega: o trabalho voltando com resposta.
        volta: origem ? [2, 3] : [1],
        longo: a.estado === "longo",
      };
    }).filter(Boolean) as {
      id: string; pernas: { de: XY; para: XY }[];
      humanas: number[]; volta: number[]; longo: boolean;
    }[];
  })();

  // Sem nenhuma leitura boa ainda não há o que mostrar. Com uma, a parede
  // continua de pé com o último retrato e um aviso de que parou.
  if (erro && !feed) {
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

  const e = layout.escala;

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
              {nConversas === 0
                ? "time em repouso"
                : `${nConversas} conversa${nConversas > 1 ? "s" : ""} agora`}
            </div>
            <div className="wr-relogio">{hora}</div>

            {/* Controles discretos: somem visualmente na parede, existem
                quando alguém precisa. */}
            <div className="wr-controles">
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
              viewBox={`0 0 ${QUADRO.w} ${QUADRO.h}`}
              preserveAspectRatio="xMidYMid meet"
              className="wr-mapa"
            >
              <defs>
                <filter id="wr-brilho" x="-70%" y="-70%" width="240%" height="240%">
                  <feGaussianBlur stdDeviation="7" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
                {/* As linhas não chegam a tocar o núcleo: elas se dissolvem por
                    perto. Trinta retas cravando o mesmo pixel viram teia de
                    aranha — dissolvidas, viram convergência. */}
                <radialGradient id="wr-dissolve" gradientUnits="userSpaceOnUse"
                  cx={NUCLEO.x} cy={NUCLEO.y} r={QUADRO.w * 0.55}>
                  <stop offset="0%" stopColor="#000" />
                  <stop offset="9%" stopColor="#000" />
                  <stop offset="34%" stopColor="#fff" />
                </radialGradient>
                <mask id="wr-mascara-linhas">
                  <rect x={-QUADRO.w} y={-QUADRO.h} width={QUADRO.w * 3} height={QUADRO.h * 3} fill="url(#wr-dissolve)" />
                </mask>
              </defs>

              {/* Linhas: pessoas → núcleo → agentes. Acendem com trabalho.
                  Curvas, não retas: reta é diagrama, curva é organismo. */}
              <g mask="url(#wr-mascara-linhas)">
                {(feed?.pessoas ?? []).map((p) => {
                  const pos = posPessoa.get(p.id); if (!pos) return null;
                  const falando = comAgente.has(p.id);
                  return (
                    <path key={`l-${p.id}`} d={curva(pos, NUCLEO)} fill="none"
                      className={falando ? "wr-linha wr-viva-h" : "wr-linha"}
                      strokeWidth={falando ? 2 : 1.4} />
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

              {/* Pessoa com pessoa (DM): só o fato de que conversam, nunca o
                  quê. Fora da máscara — a linha não passa pelo núcleo, e
                  dissolvida no meio pareceria duas linhas soltas. */}
              {(feed?.conversasTime ?? []).map((c) => {
                const de = posPessoa.get(c.a), para = posPessoa.get(c.b);
                if (!de || !para) return null;
                const ctrl = controlesDm.get(`${c.a}-${c.b}`);
                if (!ctrl) return null;
                const t = (agoraFrame / 2600) % 1;
                const p = bezier(de, ctrl, para, t);
                const opacidade = Math.min(1, Math.min(t, 1 - t) * 14);
                return (
                  <g key={`dm-${c.a}-${c.b}`}>
                    <path d={`M ${de.x} ${de.y} Q ${ctrl.x} ${ctrl.y} ${para.x} ${para.y}`}
                      className="wr-rota-time" fill="none" />
                    <circle cx={p.x} cy={p.y} r={3.5} className="wr-particula-time" opacity={opacidade}
                      style={{ filter: "drop-shadow(0 0 5px var(--wr-time))" }} />
                  </g>
                );
              })}

              {/* O núcleo é o HS.OS: respira, e é para onde tudo converge. */}
              <g transform={`translate(${NUCLEO.x},${NUCLEO.y})`} className="wr-nucleo">
                <circle r={30} className="wr-nucleo-onda" fill="none" strokeWidth={1} />
                <circle r={30} className="wr-nucleo-onda wr-atraso" fill="none" strokeWidth={1} />
                <circle r={19} fill="none" className="wr-nucleo-anel" strokeWidth={1.2} opacity={0.55} />
                <circle r={11} fill="none" className="wr-nucleo-anel" strokeWidth={1} opacity={0.3} />
                <circle r={6} className="wr-nucleo-ponto" />
                <text y={54} textAnchor="middle" className="wr-nucleo-rotulo">HS.OS</text>
              </g>

              {/* Nome do setor por fora do anel, antes dos nós. */}
              {layout.setores.map((s) => (
                <text key={s.nome} x={s.x} y={s.y} textAnchor={s.ancora} className="wr-setor"
                  fontSize={FONTE.setor}>
                  {s.nome.toUpperCase()}
                </text>
              ))}

              {(feed?.pessoas ?? []).map((p, i) => {
                const pos = posPessoa.get(p.id); if (!pos) return null;
                const emConversa = comAgente.has(p.id) || emDm.has(p.id);
                const ponto = corDoPonto(p);
                return (
                  <g key={p.id} transform={`translate(${pos.x} ${pos.y})`}>
                    {emConversa && (
                      <polygon points={hexagono(rP + 7)} fill="none"
                        className="wr-hex-halo" strokeWidth={2} opacity={0.5} />
                    )}
                    <polygon
                      points={hexagono(rP)}
                      className={`wr-corpo-h wr-hex${emConversa ? " wr-viva" : ""}`}
                      strokeWidth={1.6}
                      style={{ animationDelay: `${(i % 8) * 0.55 + 0.3}s` }}
                    />
                    <text textAnchor="middle" dy="0.36em" fontSize={FONTE.inicial * e} fontWeight={800}
                      className={`wr-inicial${emConversa ? " wr-viva" : ""}`}>
                      {p.nome.slice(0, 1).toUpperCase()}
                    </text>
                    {ponto && (
                      <circle cx={rP * 0.78} cy={-rP * 0.78} r={5.5 * e} fill={ponto}
                        stroke="var(--wr-canvas)" strokeWidth={1.5} />
                    )}
                    {/* Linha de base e fonte saem de `ROTULO_PESSOA`/`FONTE`, as
                        mesmas que o teste de sobreposição usa. */}
                    <text y={rP + ROTULO_PESSOA.nome * e} textAnchor="middle" className="wr-nome wr-nome-h"
                      fontSize={FONTE.nome * e}>
                      {p.nome}
                    </text>
                    {p.status && (
                      <text y={rP + ROTULO_PESSOA.status * e} textAnchor="middle" className="wr-status-h"
                        fontSize={FONTE.status * e}>
                        {ROTULO_STATUS[p.status]}
                      </text>
                    )}
                  </g>
                );
              })}

              {(feed?.agentes ?? []).map((a, i) => {
                const pos = posAgente.get(a.id); if (!pos) return null;
                const halo = HALO[a.estado];
                const C = 2 * Math.PI * (R_AGENTE + 6);
                // ⚠️ Era `a.tarefa ?? a.papel`, e `tarefa` era a pergunta em
                // aberto — conteúdo de conversa numa TV pública. Hoje o rótulo
                // é só o estado: com quem e há quanto tempo, ou o papel.
                const parceiro = a.parceiroId ? feed?.pessoas.find((p) => p.id === a.parceiroId)?.nome : null;
                // O tempo desce para uma terceira linha: na fonte de 4 m,
                // "conversando com Karolaine · 12min 30s" numa linha só
                // passava por cima do agente vizinho.
                const ocupado = a.estado !== "ocioso";
                const linha2 = ocupado
                  ? (parceiro ? `conversando com ${parceiro}` : "trabalhando")
                  : a.papel;
                const linha3 = ocupado && a.desde ? decorrido(a.desde) : null;
                return (
                  <g key={a.id} transform={`translate(${pos.x},${pos.y})`}>
                    <circle r={R_AGENTE + 10} fill={halo} filter="url(#wr-brilho)" />
                    <circle r={R_AGENTE + 6} fill="none" className="wr-trilho" strokeWidth={3} />
                    {/* Anel de contexto: quanto da janela do agente está ocupada.
                        ⚠️ Só desenha quando a janela é conhecida. Anel zerado se
                        lê na parede como "contexto limpo", que é afirmação — e
                        `strictNullChecks` está desligado neste projeto, então o
                        compilador não pegaria o nulo virando NaN aqui. */}
                    {a.contexto !== null && a.contexto !== undefined && (
                      <circle r={R_AGENTE + 6} fill="none" strokeWidth={3} strokeLinecap="round"
                        transform="rotate(-90)"
                        className={`wr-ctx${a.contexto > 0.8 ? " wr-longo" : ""}`}
                        strokeDasharray={C} strokeDashoffset={C * (1 - a.contexto)} />
                    )}
                    {/* Fundo opaco: o corpo de cima "respira" opacidade, e sem
                        este disco a linha de um DM que cruza o anel aparecia
                        riscando o agente por dentro. */}
                    <circle r={R_AGENTE} className="wr-corpo" />
                    <circle r={R_AGENTE} className={`wr-corpo wr-anel wr-${a.estado}`} strokeWidth={1.5}
                      style={{ animationDelay: `${(i % 8) * 0.55}s` }} />
                    <text textAnchor="middle" dy="0.36em" fontSize={24} fontWeight={800}
                      className={`wr-sigla wr-${a.estado}`}>
                      {a.nome.slice(0, 2).toUpperCase()}
                    </text>
                    <text textAnchor="middle" y={R_AGENTE + ROTULO_AGENTE.nome} fontSize={FONTE.agente}
                      className="wr-nome">{a.nome}</text>
                    <text textAnchor="middle" y={R_AGENTE + ROTULO_AGENTE.linha2} fontSize={FONTE.agenteSub}
                      className={`wr-tarefa ${ocupado ? "wr-sub-ativo" : "wr-sub-ocioso"}`}>
                      {linha2}
                    </text>
                    {linha3 && (
                      <text textAnchor="middle" y={R_AGENTE + ROTULO_AGENTE.linha3} fontSize={FONTE.agenteSub}
                        className="wr-tarefa wr-sub-ativo">
                        {linha3}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Circulação contínua: enquanto o agente pensa, o caminho dele
                  fica em movimento. Três partículas defasadas por rota. */}
              {rotasVivas.flatMap((r) =>
                [0, 1, 2].map((i) => {
                  // 3,2s para o circuito inteiro, ida e volta.
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
                const ease = 1 - Math.pow(1 - k, 2); // desacelera ao chegar
                return (
                  <circle
                    key={p.id}
                    r={3.5}
                    cx={p.de.x + (p.para.x - p.de.x) * ease}
                    cy={p.de.y + (p.para.y - p.de.y) * ease}
                    opacity={k > 0.85 ? (1 - k) / 0.15 : 1}
                    style={{ fill: p.cor, filter: `drop-shadow(0 0 6px ${p.cor})` }}
                  />
                );
              })}
            </svg>
          </section>

          <section className="wr-painel">
            <header><span>fluxo</span><span>hoje</span></header>
            <div className="wr-fluxo">
              {(feed?.eventos ?? []).length === 0 && (
                <div className="wr-evento">
                  <span className="wr-hora">—</span>
                  <span className="wr-txt">Nenhum trabalho registrado hoje. O time está em repouso.</span>
                </div>
              )}
              {(feed?.eventos ?? []).map((ev, i) => (
                <div key={ev.ts + i} className={`wr-evento ${ev.tipo}`}>
                  <span className="wr-hora">{horaMinuto(ev.ts)}</span>
                  <span className="wr-txt">
                    {/* ⚠️ Filho normal, nunca `dangerouslySetInnerHTML`: React
                        escapa sozinho. E o `texto` é frase fixa montada no
                        backend com nomes — "Atlas publicou…", "Erick e Welton
                        conversaram" —, nunca conteúdo de mensagem. */}
                    <span>{ev.texto}</span>
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
            <span className="wr-nota">documentos publicados</span>
          </div>
          <div className="wr-numero">
            <span className="wr-rotulo">conversas atendidas</span>
            <span className="wr-valor">{feed?.numeros.atendidas ?? 0}</span>
            <span className="wr-nota">pessoa × agente, hoje</span>
          </div>
          <div className="wr-numero">
            <span className="wr-rotulo">pessoas ativas</span>
            <span className="wr-valor">{feed?.numeros.pessoasAtivas ?? 0}</span>
            <span className="wr-nota">de {feed?.pessoas.length ?? 0} no time</span>
          </div>
          <div className="wr-numero">
            <span className="wr-rotulo">conversas no time</span>
            <span className="wr-valor">{feed?.numeros.conversasTime ?? 0}</span>
            <span className="wr-nota">entre pessoas, hoje</span>
          </div>
        </footer>
      </div>

      {/* A parede nunca deve mentir dizendo que está tudo bem quando parou. */}
      {erro && lidoEm !== null && (
        <div className="wr-aviso" title={erro}>sem atualizar desde {horaMinuto(lidoEm)}</div>
      )}
    </div>
  );
}
