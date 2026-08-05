/**
 * Gera o Design System completo da HS.OS em formato YAML.
 * Esse YAML é otimizado para ser consumido por LLMs (Claude, GPT, Gemini)
 * ao gerar artifacts, telas ou componentes que precisem respeitar a
 * identidade visual "Glass Aurora" da HS.OS.
 */
export function generateDesignSystemYaml(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `##############################################################################
# HS.OS — Design System "Glass Aurora"
# Identidade visual oficial da plataforma HS.OS Operating System
# Versão: 1.0 | Atualizado: ${today}
#
# Use este arquivo como contexto ao gerar UIs, artifacts ou componentes
# que precisem respeitar a identidade visual da HS.OS.
##############################################################################

meta:
  nome: Glass Aurora
  inspiracao: Glassmorphism + Aurora gradients + Mission Control
  modo_padrao: dark
  background_base_dark: "#0A0A0A"
  background_base_light: "hsl(220 33% 98%)"

# ═══════════════════════════════════════════════════════════════════════════
# 1. CORES (HSL — use sempre via tokens semânticos, nunca hardcoded)
# ═══════════════════════════════════════════════════════════════════════════
cores:
  primary:
    hex: "#3D61FF"
    hsl: "231 100% 62%"
    descricao: Azul Elétrico HS.OS — ações principais, links, foco
  accent:
    hex: "#E41A11"
    hsl: "4 87% 48%"
    descricao: Vermelho Energia HS.OS — destaque, alerta, CTA energético
  destructive:
    hex: "#E41A11"
    hsl: "4 87% 48%"
  success:
    hsl: "160 84% 39%"
  warning:
    hsl: "38 92% 50%"
  info:
    hsl: "231 100% 62%"
  agent_accent:
    hsl: "160 84% 45%"
    descricao: Verde dos agentes (bolhas de mensagem distintas do usuário)

tokens_semanticos:
  light:
    background: "220 33% 98%"
    foreground: "224 28% 12%"
    card: "0 0% 100%"
    muted: "220 20% 94%"
    border: "220 16% 86%"
    sidebar_background: "220 25% 97%"
  dark:
    background: "0 0% 4%"
    foreground: "0 0% 98%"
    card: "0 0% 6%"
    muted: "0 0% 12%"
    border: "0 0% 16%"
    sidebar_background: "0 0% 4%"

regras_de_uso_de_cor:
  - NUNCA use classes Tailwind diretas como text-white, bg-black, bg-blue-500.
  - SEMPRE use tokens semânticos: bg-background, text-foreground, bg-primary, text-primary-foreground.
  - Em artifacts (HTML standalone), use os hex #3D61FF (primary) e #E41A11 (accent).

# ═══════════════════════════════════════════════════════════════════════════
# 2. TIPOGRAFIA
# ═══════════════════════════════════════════════════════════════════════════
tipografia:
  fontes:
    display: Rajdhani (400, 500, 600, 700) — títulos, headings
    body: Inter (400, 500, 600, 700) — corpo, UI
    mono: JetBrains Mono (400, 500) — código, valores técnicos
  uso:
    h1_h2: font-display, letter-spacing -0.01em
    body_padrao: font-body (Inter), text-sm padrão
    valores_tecnicos: font-mono (preços, IDs, tokens)

# ═══════════════════════════════════════════════════════════════════════════
# 3. RAIO, ESPAÇAMENTO, ELEVAÇÃO
# ═══════════════════════════════════════════════════════════════════════════
geometria:
  radius_base: 0.375rem  # --radius
  radius_card: 1rem (rounded-2xl) para glass cards
  radius_pill: 9999px (rounded-full) para botões CTA, badges, indicadores
shadow:
  glow_primary: "0 0 30px -10px hsl(var(--primary) / 0.4)"
  glow_accent: "0 0 30px -10px hsl(var(--accent) / 0.4)"
  card_subtle: "0 4px 24px -8px rgba(0,0,0,0.4)"

# ═══════════════════════════════════════════════════════════════════════════
# 4. SUPERFÍCIES GLASS / AURORA
# ═══════════════════════════════════════════════════════════════════════════
glass:
  glass_card:
    background: rgba(255,255,255,0.04) no dark / rgba(0,0,0,0.03) no light
    backdrop_filter: blur(12px)
    border: 1px solid hsl(var(--border) / 0.4)
    classe_utilitaria: .glass-card
  glass_card_glow:
    descricao: Card glass com orb gradiente (100x100) no canto, blur 28px
    gradient: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))
    classe_utilitaria: .glass-card-glow + .glass-card-glow-effect
  glass_input:
    background: rgba(255,255,255,0.03)
    border: 1px solid hsl(var(--border) / 0.4)
    focus: ring-2 ring-primary/40
    classe_utilitaria: .glass-input

ambient_mesh:
  descricao: Mesh aurora ambiental aplicado em body::before e body::after
  blurs: [90px, 110px]
  cores: hsl(var(--primary) / 0.06), hsl(var(--accent) / 0.05)

aurora_glow:
  classe: .aurora-glow
  overlay: linear-gradient(135deg, hsl(var(--primary) / 0.15), transparent 60%)

gradient_border:
  classe: .gradient-border
  tecnica: mask-composite xor com gradiente primary->accent

# ═══════════════════════════════════════════════════════════════════════════
# 5. BOTÕES (variantes shadcn customizadas)
# ═══════════════════════════════════════════════════════════════════════════
botoes:
  variantes:
    default:
      uso: ação principal padrão
      classe: bg-primary text-primary-foreground hover:bg-primary/90
    outline:
      uso: ação secundária
      classe: border border-input bg-background hover:bg-accent/10
    ghost:
      uso: ações inline, low-emphasis
      classe: hover:bg-accent/10
    link:
      uso: link textual
      classe: underline-offset-4 hover:underline text-primary
    destructive:
      classe: bg-destructive text-destructive-foreground hover:bg-destructive/90
    glass:
      uso: superfícies premium, dark surfaces
      classe: "bg-white/4 backdrop-blur-md border border-white/8 rounded-2xl hover:bg-white/8"
    glass_destructive:
      uso: ação destrutiva em superfície glass
      classe: "bg-red-500/10 backdrop-blur-md border border-red-500/30 text-red-400 rounded-2xl hover:bg-red-500/20"
  tamanhos:
    default: h-10 px-4 py-2
    sm: h-9 px-3
    lg: h-11 px-8
    icon: h-10 w-10

# ═══════════════════════════════════════════════════════════════════════════
# 6. CHAT — BOLHAS, COMPOSER, TYPING
# ═══════════════════════════════════════════════════════════════════════════
chat:
  bolhas:
    bubble_user:
      classe: .bubble-user
      background: linear-gradient(135deg, hsl(var(--primary)), hsl(262 83% 58%))
      texto: white
      radius: rounded-2xl
      alinhamento: direita
    bubble_agent:
      classe: .bubble-agent
      background: hsl(var(--chat-bg))
      texto: hsl(var(--foreground))
      borda_lateral: 2px solid hsl(var(--agent-accent))
      alinhamento: esquerda
  typing:
    pill_classe: .typing-pill
    posicao_chat: floating absolute -top-7 left-4 acima do composer
    posicao_sidebar: ao lado do nome do contato/canal na lista de chats
    formato_canal: "Fulano está digitando" ou "Fulano, Ciclano estão digitando" + ... animado
  composer:
    radius: 1.75rem
    backdrop_filter: blur(16px)
    botao_enviar:
      tamanho: 40x40
      classe: .btn-send-gradient (primary -> accent)
  highlight:
    classe: .msg-highlight
    animacao: pulse 2.4s (para mensagens recém-chegadas / mencionadas)

# ═══════════════════════════════════════════════════════════════════════════
# 7. AGENTES — VISUAL IDENTITY
# ═══════════════════════════════════════════════════════════════════════════
agentes:
  avatar:
    classe: .agent-list-avatar
    formato: circular com gradiente radial premium
  status_online:
    classe: .status-online
    indicador: dot pulsante verde (hsl(var(--success)))
  working_pulse:
    classe: .agent-working-pulse
    animacao: scale(1.035) infinito durante processamento
  neural_map:
    humanos: hexágonos cyan/petrol com linhas tracejadas
    agentes: círculos azul primary (#3D61FF) com linhas sólidas
    biblioteca: SVG + Framer Motion custom

# ═══════════════════════════════════════════════════════════════════════════
# 8. FEEDBACK — TOASTER / SONNER
# ═══════════════════════════════════════════════════════════════════════════
toaster:
  biblioteca: sonner
  posicao: top-right
  largura: 380px
  background: linear-gradient(135deg, hsl(var(--card)), hsl(var(--background)))
  border: 1px solid hsl(var(--border) / 0.4)
  shadow: glow primary sutil

# ═══════════════════════════════════════════════════════════════════════════
# 9. NAVEGAÇÃO
# ═══════════════════════════════════════════════════════════════════════════
navegacao:
  sidebar:
    background: hsl(var(--sidebar-background))
    largura_expandida: 16rem (w-64)
    largura_collapsed: 3.5rem (w-14) com ícones
    item_ativo: bg-primary/10 text-primary border-l-2 border-primary
  header:
    altura: 3.5rem (h-14)
    contem: SearchGlobal + ThemeToggle (lado a lado à direita)
  bottom_nav_mobile:
    altura: 4rem (h-16)
    icones: 5 principais (Chat, Super agentes, Times, Resultados, Settings)

# ═══════════════════════════════════════════════════════════════════════════
# 10. ARTIFACTS — REGRAS DE GERAÇÃO
# ═══════════════════════════════════════════════════════════════════════════
artifacts:
  formato: HTML completo dentro de bloco \`\`\`html
  cores_obrigatorias:
    primary: "#3D61FF"
    accent: "#E41A11"
  proibicoes:
    - NUNCA usar links para arquivos externos
    - NUNCA enviar updates incrementais durante streaming
    - SEMPRE entregar o HTML completo de uma vez
  fontes_recomendadas: Inter (Google Fonts) ou system-ui

# ═══════════════════════════════════════════════════════════════════════════
# 11. REGRAS RADIX UI (críticas)
# ═══════════════════════════════════════════════════════════════════════════
radix_rules:
  - Todo Dialog, Sheet, AlertDialog DEVE ter <DialogTitle> e <DialogDescription> (ou SR-only) para evitar crash.
  - Use forwardRef em wrappers de componentes shadcn customizados.

# ═══════════════════════════════════════════════════════════════════════════
# 12. ANIMAÇÕES PADRÃO (Tailwind + Framer Motion)
# ═══════════════════════════════════════════════════════════════════════════
animacoes:
  pulse_subtle: 2.4s ease-in-out infinite
  dash_flow: animação tracejada em arestas do Neural Map
  fade_in_up: framer-motion initial={{opacity:0, y:8}} animate={{opacity:1, y:0}}
  duracao_padrao: 200-300ms
  easing_padrao: cubic-bezier(0.4, 0, 0.2, 1)

##############################################################################
# Fim do Design System HS.OS
##############################################################################
`;
}
