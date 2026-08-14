import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Bot, Save, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { useTheme } from "next-themes";
import type { GatewayAgent } from "@/hooks/use-agents";
import type { Person } from "@/hooks/use-people";
import { getSetting, setSetting } from "@/lib/app-settings";
import { getLeaderAgentId } from "@/lib/active-agents";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

interface Props {
  agents: GatewayAgent[];
  avatars: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  people?: Person[];
}

/* ── Deterministic color per agent ─────────────────── */
const AGENT_HUES = [
  280, 200, 340, 160, 45, 20, 120, 310, 60, 180,
  240, 100, 350, 30, 260, 140, 220, 80, 300, 170,
  10, 250, 90, 330, 50, 190, 270, 110, 210, 70,
  320, 150, 40, 230, 130, 290, 0, 360,
];

function agentColor(index: number) {
  const hue = AGENT_HUES[index % AGENT_HUES.length];
  return `hsl(${hue}, 70%, 55%)`;
}
function agentColorDim(index: number) {
  const hue = AGENT_HUES[index % AGENT_HUES.length];
  return `hsl(${hue}, 60%, 25%)`;
}
function agentGlow(index: number) {
  const hue = AGENT_HUES[index % AGENT_HUES.length];
  return `0 0 18px hsl(${hue} 70% 55% / 0.4)`;
}

function statusLabel(status: string) {
  if (status === "active") return "ACTIVE";
  if (status === "inactive") return "OFFLINE";
  return "STALE";
}
function statusBadgeColor(status: string) {
  if (status === "active") return { bg: "hsl(160, 84%, 39%)", text: "#fff" };
  if (status === "inactive") return { bg: "hsl(0, 0%, 30%)", text: "hsl(0,0%,60%)" };
  return { bg: "hsl(38, 80%, 45%)", text: "#fff" };
}

/**
 * O centro é a orquestradora.
 *
 * ⚠️ Antes vinha de `getLeaderAgentId()`, que lê o catálogo estático de agentes
 * — e esse catálogo filtra `isOfficial` e está **vazio** nesta instalação. Sem
 * líder, caía no "primeiro ativo", e o mapa passou a mostrar o `atlas` no
 * centro com a `nina` de satélite. O `isLeader` já vem do banco em cada agente;
 * é ele que manda.
 *
 * O catálogo continua como segunda opção para instalação que o use.
 */
function findCenterAgent(agents: GatewayAgent[]): GatewayAgent | null {
  const lider = agents.find((a) => a.isLeader);
  if (lider) return lider;
  const doCatalogo = getLeaderAgentId();
  if (doCatalogo) {
    const achado = agents.find((a) => a.id === doCatalogo);
    if (achado) return achado;
  }
  return agents.find((a) => a.status === "active") ?? agents[0] ?? null;
}

/**
 * A qual agente cada pessoa está ligada.
 *
 * ⚠️ Antes **toda** pessoa saía do centro, porque o mapa não sabia quem
 * alcançava o quê — 26 linhas idênticas que escondiam a informação real: cada
 * agente atende um grupo, e é isso que o mapa deveria mostrar.
 *
 * A regra é a mesma do backend (`_pode_ver`): `specific_users` vale pela lista;
 * `admins_only` liga só a quem administra; `all` liga a todo mundo.
 */
function ligacaoDasPessoas(
  agents: GatewayAgent[],
  people: Person[],
): Record<string, string[]> {
  const porPessoa: Record<string, string[]> = {};
  for (const p of people) {
    const ehAdmin = (p as { role?: string }).role === "administrador";
    for (const a of agents) {
      const tipo = a.accessType ?? "all";
      const alcanca =
        tipo === "specific_users" ? (a.allowedUserIds ?? []).includes(p.id)
        : tipo === "admins_only" ? ehAdmin
        : true;
      if (alcanca) (porPessoa[p.id] ??= []).push(a.id);
    }
  }
  return porPessoa;
}

/* ── Organic layout using golden angle + jitter ────── */
function organicPositions(count: number, cx: number, cy: number, w: number, h: number) {
  if (count === 0) return [];
  const positions: { x: number; y: number }[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const scaleFactor = Math.min(0.46, 0.25 + count * 0.006);
  const maxR = Math.min(w, h) * scaleFactor;
  const minR = Math.min(w, h) * 0.18;

  for (let i = 0; i < count; i++) {
    const angle = i * goldenAngle;
    const t = count === 1 ? 0.5 : i / (count - 1);
    const r = minR + (maxR - minR) * Math.sqrt(t);
    const jitterAmt = Math.min(25, 10 + count * 0.5);
    const jitterX = Math.sin(i * 7.3) * jitterAmt;
    const jitterY = Math.cos(i * 11.1) * jitterAmt;
    positions.push({
      x: cx + r * Math.cos(angle) + jitterX,
      y: cy + r * Math.sin(angle) + jitterY,
    });
  }
  return positions;
}

/** Human-specific organic positions — offset angle to interleave with agents */
function humanPositions(count: number, agentCount: number, cx: number, cy: number, w: number, h: number) {
  if (count === 0) return [];
  const positions: { x: number; y: number }[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const scaleFactor = Math.min(0.46, 0.25 + (agentCount + count) * 0.006);
  const maxR = Math.min(w, h) * scaleFactor;
  const minR = Math.min(w, h) * 0.20;
  const angleOffset = Math.PI * 0.618; // offset to interleave

  for (let i = 0; i < count; i++) {
    const angle = (agentCount + i) * goldenAngle + angleOffset;
    const t = count === 1 ? 0.5 : i / (count - 1);
    const r = minR + (maxR - minR) * Math.sqrt(t);
    const jitterX = Math.sin((agentCount + i) * 9.7) * 15;
    const jitterY = Math.cos((agentCount + i) * 13.3) * 15;
    positions.push({
      x: cx + r * Math.cos(angle) + jitterX,
      y: cy + r * Math.sin(angle) + jitterY,
    });
  }
  return positions;
}

function getInitials(name: string | null) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const SETTINGS_KEY = "neural_map_positions_pct";
type SavedPositions = Record<string, { x: number; y: number }>;

const HUMAN_COLOR = "hsl(185, 70%, 50%)";
const HUMAN_COLOR_DIM = "hsl(185, 50%, 20%)";
const HUMAN_GLOW = "0 0 14px hsl(185 70% 50% / 0.35)";
const HEXAGON_CLIP = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

export default function NeuralMap({ agents, avatars, selectedId, onSelect, people = [] }: Props) {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === "light";
  const canvasBg = isLight ? "hsl(0 0% 98%)" : "hsl(0 0% 5%)";
  const nodeBg = isLight ? "hsl(0 0% 100%)" : "hsl(0 0% 8%)";
  const inactiveBorder = isLight ? "hsl(0 0% 82%)" : "hsl(0 0% 22%)";
  const gridStroke = isLight ? "hsl(231 100% 45%)" : "hsl(231 100% 62%)";
  const gridOpacity = isLight ? 0.12 : 0.06;
  const radialAlpha = isLight ? 0.05 : 0.06;
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  // Zoom & pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta * 2)));
  }, []);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP)), []);
  const handleZoomReset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const center = useMemo(() => findCenterAgent(agents), [agents]);
  const satellites = useMemo(() => agents.filter((a) => a.id !== center?.id), [agents, center]);
  const agentIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    agents.forEach((a, i) => map.set(a.id, i));
    return map;
  }, [agents]);

  const cx = dims.w / 2;
  const cy = dims.h / 2;
  // A orquestradora é maior de propósito: ela coordena os demais, e o mapa
  // deve mostrar isso sem legenda.
  const centerR = 54;
  const satR = satellites.length > 25 ? 26 : 34;
  const humanR = 20;

  // A quem cada pessoa está ligada. Vazio = ninguém a alcança.
  const ligacoes = useMemo(
    () => ligacaoDasPessoas(agents, people),
    [agents, people],
  );

  // Default computed positions for agents
  const defaultPositions = useMemo(() => {
    const pos = organicPositions(satellites.length, cx, cy, dims.w, dims.h);
    const map: Record<string, { x: number; y: number }> = {};
    satellites.forEach((agent, i) => {
      map[agent.id] = pos[i];
    });
    if (center) {
      map[center.id] = { x: cx, y: cy };
    }
    // ⚠️ Pessoa orbita o AGENTE que a atende, não o centro. Com todas em volta
    // do centro o mapa mostrava 26 raios idênticos — bonito e sem informação.
    // Agrupar por agente faz o desenho responder "quem atende quem" de relance.
    const porAgente: Record<string, Person[]> = {};
    const soltas: Person[] = [];
    for (const pessoa of people) {
      const donos = ligacoes[pessoa.id] ?? [];
      // Quem fala com mais de um agente orbita o primeiro; a linha para os
      // demais continua sendo desenhada.
      if (donos.length) (porAgente[donos[0]] ??= []).push(pessoa);
      else soltas.push(pessoa);
    }

    for (const [agentId, pessoas] of Object.entries(porAgente)) {
      const base = agentId === center?.id ? { x: cx, y: cy } : map[agentId];
      if (!base) continue;
      // Leque em volta do agente, virado para fora do centro.
      const anguloBase = Math.atan2(base.y - cy, base.x - cx) || 0;
      const raio = 96 + Math.min(pessoas.length, 8) * 7;
      pessoas.forEach((pessoa, i) => {
        const espalha = (i - (pessoas.length - 1) / 2) * (Math.PI / Math.max(pessoas.length, 6));
        const ang = anguloBase + espalha;
        map[`human-${pessoa.id}`] = {
          x: base.x + Math.cos(ang) * raio,
          y: base.y + Math.sin(ang) * raio,
        };
      });
    }
    // Sem agente que as alcance: ficam na borda, longe — a distância é a
    // informação.
    const hPos = humanPositions(soltas.length, satellites.length, cx, cy, dims.w, dims.h);
    soltas.forEach((pessoa, i) => {
      map[`human-${pessoa.id}`] = hPos[i];
    });
    return map;
  }, [satellites, center, cx, cy, dims.w, dims.h, people, ligacoes]);

  // Custom positions from drag
  const [customPositions, setCustomPositions] = useState<SavedPositions>({});
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetting<SavedPositions>(SETTINGS_KEY).then((saved) => {
      if (cancelled) return;
      // Layout salvo antes de 14/08/2026 pode conter posição de pessoa. Elas
      // deixaram de ser fixadas — descartar na leitura evita que um mapa antigo
      // continue prendendo gente ao lado do agente errado.
      if (saved) {
        setCustomPositions(
          Object.fromEntries(
            Object.entries(saved).filter(([id]) => !id.startsWith("human-")),
          ),
        );
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Posição de um nó: a salva, quando existe, senão a calculada.
   *
   * ⚠️ **Pessoa não usa posição salva.** Ela orbita o agente que a atende, e
   * isso muda quando alguém ganha ou perde acesso. Posição fixada venceria o
   * cálculo e deixaria a pessoa parada ao lado do agente antigo — o mapa
   * afirmando uma ligação que não existe mais, sem nada indicando o
   * desencontro. É o mesmo defeito que passamos o dia caçando, e aqui teria a
   * agravante de parecer certo.
   *
   * Arrastar uma pessoa continua funcionando na sessão; só não sobrevive ao
   * recarregar. O layout que vale a pena guardar é o dos agentes.
   */
  const getPos = useCallback(
    (nodeId: string) => {
      const pct = nodeId.startsWith("human-") ? undefined : customPositions[nodeId];
      if (pct) return { x: pct.x * dims.w, y: pct.y * dims.h };
      return defaultPositions[nodeId] ?? { x: cx, y: cy };
    },
    [customPositions, defaultPositions, cx, cy, dims.w, dims.h]
  );

  // Drag state
  const dragRef = useRef<{
    agentId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const hasDraggedRef = useRef(false);

  const handlePointerDown = useCallback(
    (nodeId: string, e: React.PointerEvent, isHuman = false) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos(nodeId);
      dragRef.current = {
        agentId: nodeId,
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      hasDraggedRef.current = false;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getPos]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Panning background
      if (isPanningRef.current) {
        setPan({
          x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
          y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
        });
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / zoom;
      const dy = (e.clientY - d.startY) / zoom;
      if (!hasDraggedRef.current && Math.abs(dx) + Math.abs(dy) > 4) {
        hasDraggedRef.current = true;
      }
      if (!hasDraggedRef.current) return;

      const r = humanR;
      const newX = Math.max(r, Math.min(dims.w - r, d.origX + dx));
      const newY = Math.max(r, Math.min(dims.h - r, d.origY + dy));

      setCustomPositions((prev) => ({
        ...prev,
        [d.agentId]: { x: newX / dims.w, y: newY / dims.h },
      }));
    },
    [dims.w, dims.h, zoom]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }
      if (dragRef.current) {
        if (hasDraggedRef.current) {
          setDirty(true);
        } else if (!dragRef.current.agentId.startsWith("human-")) {
          onSelect(dragRef.current.agentId);
        }
        dragRef.current = null;
      }
    },
    [onSelect]
  );

  const handleSave = useCallback(async () => {
    // Só agentes vão para o disco — ver `getPos`. Guardar posição de pessoa
    // seria guardar um dado que o próximo acesso invalida.
    const soAgentes = Object.fromEntries(
      Object.entries(customPositions).filter(([id]) => !id.startsWith("human-")),
    );
    await setSetting(SETTINGS_KEY, soAgentes);
    setDirty(false);
  }, [customPositions]);

  const handleReset = useCallback(async () => {
    setCustomPositions({});
    setDirty(false);
    await setSetting(SETTINGS_KEY, {});
  }, []);

  const positions = useMemo(
    () => satellites.map((agent) => ({ agent, ...getPos(agent.id) })),
    [satellites, getPos]
  );

  const humanNodes = useMemo(
    () => people.map((p) => ({ person: p, ...getPos(`human-${p.id}`) })),
    [people, getPos]
  );

  const centerPos = center ? getPos(center.id) : { x: cx, y: cy };

  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    // Only start pan if clicking directly on the container background
    if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === "svg") {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, [pan]);

  const zoomPercent = Math.round(zoom * 100);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[400px] overflow-hidden rounded-2xl border border-border select-none"
      style={{ background: canvasBg, touchAction: "none", cursor: isPanningRef.current ? "grabbing" : "default" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerDown={handleBackgroundPointerDown}
      onWheel={handleWheel}
    >
      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 bg-card/80 backdrop-blur-sm border border-border rounded-lg px-1 py-1">
        <button onClick={handleZoomOut} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] font-mono text-muted-foreground w-10 text-center">{zoomPercent}%</span>
        <button onClick={handleZoomIn} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <div className="w-px h-4 bg-border mx-0.5" />
        <button onClick={handleZoomReset} className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground" title="Reset">
          <Maximize className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Transform wrapper for zoom & pan */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          willChange: "transform",
        }}
      >
      {/* Grid background */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: gridOpacity }}>
        <defs>
          <pattern id="cmd-grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke={gridStroke} strokeWidth="0.3" />
          </pattern>
          <pattern id="cmd-grid-lg" width="128" height="128" patternUnits="userSpaceOnUse">
            <path d="M 128 0 L 0 0 0 128" fill="none" stroke={gridStroke} strokeWidth="0.6" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cmd-grid)" />
        <rect width="100%" height="100%" fill="url(#cmd-grid-lg)" />
      </svg>

      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 50% 50%, hsl(231 100% 62% / ${radialAlpha}) 0%, transparent 60%)`,
        }}
      />

      {/* SVG connections */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${dims.w} ${dims.h}`}>
        <defs>
          <filter id="line-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Agent connections */}
        {positions.map(({ agent, x, y }) => {
          const idx = agentIndexMap.get(agent.id) ?? 0;
          const isSelected = agent.id === selectedId;
          const color = agentColor(idx);
          return (
            <g key={`edge-${agent.id}`}>
              <line
                x1={centerPos.x} y1={centerPos.y} x2={x} y2={y}
                stroke={isSelected ? "hsl(231, 100%, 62%)" : color}
                strokeWidth={isSelected ? 2.5 : 1.2}
                strokeOpacity={agent.status === "inactive" ? 0.12 : 0.35}
                filter="url(#line-glow)"
              />
              <line
                x1={centerPos.x} y1={centerPos.y} x2={x} y2={y}
                stroke={isSelected ? "hsl(231, 100%, 72%)" : color}
                strokeWidth={isSelected ? 1.5 : 0.8}
                strokeOpacity={agent.status === "inactive" ? 0.08 : 0.6}
                strokeDasharray="4 6"
                className="neural-edge"
              />
            </g>
          );
        })}

        {/* Pessoa → agente(s) que a atendem. Uma linha por agente: quem fala
            com dois aparece ligado aos dois, que é o fato. */}
        {humanNodes.flatMap(({ person, x, y }) => {
          const donos = ligacoes[person.id] ?? [];
          // Sem agente que a alcance: um traço fraco para o centro, só para a
          // pessoa não flutuar solta e parecer erro de renderização.
          const alvos = donos.length ? donos : [center?.id].filter(Boolean) as string[];
          return alvos.map((agentId) => {
            const origem = agentId === center?.id ? centerPos : getPos(agentId);
            const orfa = donos.length === 0;
            return (
          <g key={`edge-human-${person.id}-${agentId}`}>
            <line
              x1={origem.x} y1={origem.y} x2={x} y2={y}
              stroke={HUMAN_COLOR}
              strokeWidth={1}
              strokeOpacity={orfa ? 0.06 : 0.2}
              filter="url(#line-glow)"
            />
            <line
              x1={origem.x} y1={origem.y} x2={x} y2={y}
              stroke={HUMAN_COLOR}
              strokeWidth={0.8}
              strokeOpacity={orfa ? 0.12 : 0.45}
              strokeDasharray="3 8"
              className="neural-edge"
            />
          </g>
            );
          });
        })}
      </svg>

      {/* Save / Reset buttons */}
      {loaded && (
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
          {dirty && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-mono font-bold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Save className="h-3 w-3" /> SALVAR LAYOUT
            </button>
          )}
          {Object.keys(customPositions).length > 0 && (
            <button
              onClick={handleReset}
              className="px-2.5 py-1.5 text-[10px] font-mono font-bold rounded-md bg-secondary text-muted-foreground hover:text-foreground border border-border transition-colors"
            >
              REORGANIZAR
            </button>
          )}
        </div>
      )}

      {/* Center node */}
      {center && (() => {
        const cIdx = agentIndexMap.get(center.id) ?? 0;
        const cColor = agentColor(cIdx);
        const sBadge = statusBadgeColor(center.status);
        return (
          <div
            onPointerDown={(e) => handlePointerDown(center.id, e)}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 group cursor-grab active:cursor-grabbing"
            style={{ left: centerPos.x, top: centerPos.y }}
          >
            <div className="absolute inset-[-12px] rounded-full opacity-20 pointer-events-none" style={{ background: `radial-gradient(circle, ${cColor}, transparent 70%)` }} />
            {center.status === "active" && (
              <div className="absolute inset-[-8px] rounded-full animate-ping opacity-10 pointer-events-none" style={{ backgroundColor: cColor }} />
            )}
            <div
              className="relative flex items-center justify-center rounded-full border-2 transition-all duration-300 overflow-hidden"
              style={{
                width: centerR * 2,
                height: centerR * 2,
                borderColor: cColor,
                boxShadow: `0 0 24px ${cColor}66, inset 0 0 20px ${cColor}22`,
              }}
            >
              <div className="absolute inset-0 bg-card rounded-full" />
              <div className="relative z-10 flex items-center justify-center w-full h-full">
                {avatars[center.id] ?? avatars[center.id.replace(/^openclaw:/, "")] ? (
                  <img src={avatars[center.id] ?? avatars[center.id.replace(/^openclaw:/, "")]} alt={center.name} className="w-full h-full object-cover rounded-full pointer-events-none" />
                ) : (
                  <Bot className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
            </div>
            <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 pointer-events-none">
              <span className="text-[11px] font-display font-bold text-foreground whitespace-nowrap tracking-wide">
                {center.name.toUpperCase()}
              </span>
              <span
                className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-sm whitespace-nowrap tracking-wider"
                style={{ backgroundColor: sBadge.bg, color: sBadge.text }}
              >
                {statusLabel(center.status)}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Satellite agent nodes (circles) */}
      {positions.map(({ agent, x, y }) => {
        const idx = agentIndexMap.get(agent.id) ?? 0;
        const color = agentColor(idx);
        const dimColor = agentColorDim(idx);
        const isSelected = selectedId === agent.id;
        const sBadge = statusBadgeColor(agent.status);

        return (
          <div
            key={agent.id}
            onPointerDown={(e) => handlePointerDown(agent.id, e)}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 group cursor-grab active:cursor-grabbing"
            style={{ left: x, top: y }}
          >
            {agent.status === "active" && (
              <div className="absolute inset-[-6px] rounded-full animate-pulse opacity-15 pointer-events-none" style={{ backgroundColor: color }} />
            )}
            <div
              className={`relative flex items-center justify-center rounded-full border-2 transition-all duration-300 overflow-hidden ${
                isSelected ? "scale-[1.2]" : "hover:scale-110"
              }`}
              style={{
                width: satR * 2,
                height: satR * 2,
                borderColor: agent.status === "inactive" ? inactiveBorder : color,
                boxShadow: isSelected
                  ? `0 0 28px hsl(231 100% 62% / 0.6)`
                  : agent.status === "inactive"
                  ? "none"
                  : agentGlow(idx),
              background: agent.status === "inactive" ? nodeBg : `linear-gradient(135deg, ${nodeBg}, ${dimColor})`,
            }}
          >
            <div className="relative z-10 flex items-center justify-center w-full h-full">
              {avatars[agent.id] ?? avatars[agent.id.replace(/^openclaw:/, "")] ? (
                <img src={avatars[agent.id] ?? avatars[agent.id.replace(/^openclaw:/, "")]} alt={agent.name} className="w-full h-full object-cover rounded-full pointer-events-none" />
              ) : (
                <Bot className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            </div>
            <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 pointer-events-none">
              <span className={`text-[9px] font-display font-semibold whitespace-nowrap transition-colors ${
                isSelected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
              }`}>
                {agent.name}
              </span>
              <span
                className="text-[7px] font-mono font-bold px-1 py-px rounded-sm whitespace-nowrap tracking-wider"
                style={{ backgroundColor: sBadge.bg, color: sBadge.text }}
              >
                {statusLabel(agent.status)}
              </span>
            </div>
          </div>
        );
      })}

      {/* Human nodes (hexagons) */}
      {humanNodes.map(({ person, x, y }) => {
        const nodeId = `human-${person.id}`;
        const hasAvatar = !!person.avatar_url;
        return (
          <div
            key={nodeId}
            onPointerDown={(e) => handlePointerDown(nodeId, e, true)}
            className="absolute -translate-x-1/2 -translate-y-1/2 z-10 group cursor-grab active:cursor-grabbing"
            style={{ left: x, top: y }}
          >
            {/* Glow */}
            <div
              className="absolute inset-[-5px] opacity-20 pointer-events-none"
              style={{ clipPath: HEXAGON_CLIP, backgroundColor: HUMAN_COLOR }}
            />
            {/* Hexagonal node */}
            <div
              className="relative flex items-center justify-center transition-all duration-300 hover:scale-110 overflow-hidden"
              style={{
                width: humanR * 2,
                height: humanR * 2,
                clipPath: HEXAGON_CLIP,
                boxShadow: HUMAN_GLOW,
                background: hasAvatar ? undefined : `linear-gradient(135deg, ${nodeBg}, ${HUMAN_COLOR_DIM})`,
              }}
            >
              {/* Border effect via inset shadow on a pseudo-bg */}
              <div
                className="absolute inset-0"
                style={{
                  clipPath: HEXAGON_CLIP,
                  background: `linear-gradient(135deg, ${HUMAN_COLOR}, ${HUMAN_COLOR_DIM})`,
                }}
              />
              <div
                className="absolute flex items-center justify-center"
                style={{
                  inset: 2,
                  clipPath: HEXAGON_CLIP,
                  background: hasAvatar ? undefined : `linear-gradient(135deg, ${nodeBg}, ${HUMAN_COLOR_DIM})`,
                }}
              >
                {hasAvatar ? (
                  <img src={person.avatar_url!} alt={person.full_name ?? ""} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] font-bold" style={{ color: HUMAN_COLOR }}>
                    {getInitials(person.full_name)}
                  </span>
                )}
              </div>
            </div>
            {/* Label */}
            <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 pointer-events-none">
              <span className="text-[9px] font-display font-semibold text-muted-foreground group-hover:text-foreground whitespace-nowrap transition-colors">
                {person.full_name ?? person.email.split("@")[0]}
              </span>
              <span
                className="text-[7px] font-mono font-bold px-1 py-px rounded-sm whitespace-nowrap tracking-wider"
                style={{ backgroundColor: "hsl(185, 60%, 25%)", color: HUMAN_COLOR }}
              >
                HUMANO
              </span>
            </div>
          </div>
        );
      })}

      {/* CSS for edge animation */}
      <style>{`
        .neural-edge {
          animation: neural-flow 1.5s linear infinite;
        }
        @keyframes neural-flow {
          to { stroke-dashoffset: -20; }
        }
      `}</style>
      </div>{/* end transform wrapper */}
    </div>
  );
}