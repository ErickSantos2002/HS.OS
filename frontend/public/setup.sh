#!/usr/bin/env bash
# ============================================================
# dnOS Remix — Script de Instalação Automatizada (VPS)
# Versão: 2.1.0 | Atualizado: 2026-07-26
# Uso: curl -sL https://[sua-url].lovable.app/setup.sh | bash -s -- https://[sua-url].lovable.app
#
# O QUE MUDOU NA 2.0
# Antes, o instalador subia o Gateway com a configuração vazia e mandava o
# usuário "configurar a LLM na área de Conectores" — instrução que não
# funcionava: configurar um provider novo com o Gateway já rodando faz ele
# tentar se auto-reiniciar, a porta ainda está ocupada, o restart falha e a
# escrita é revertida.
# Agora o instalador PERGUNTA a LLM e escreve tudo ANTES do primeiro boot, e
# gera sozinho os 8 segredos de integração que o usuário tinha de inventar e
# preencher à mão. No fim, imprime um bloco único para colar na dn.os.
# ============================================================
set -euo pipefail

# ═══════════════════════════════════════════════════════════
# Cores para output
# ═══════════════════════════════════════════════════════════
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# ═══════════════════════════════════════════════════════════
# Funções de log
# ═══════════════════════════════════════════════════════════
log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "\n${CYAN}${BOLD}▶ $1${NC}"; }

# ═══════════════════════════════════════════════════════════
# Entrada interativa
# ═══════════════════════════════════════════════════════════
# O script é executado como `curl -sL ... | bash`, então a stdin do processo é
# o PIPE com o próprio script — um `read` comum consumiria o código-fonte em vez
# da resposta do usuário. Por isso toda leitura vem de /dev/tty, que é o
# terminal de verdade.
# Se não houver terminal (execução automatizada, CI), a função devolve o valor
# padrão em vez de travar esperando algo que nunca chega.
HAS_TTY=false
[[ -r /dev/tty ]] && HAS_TTY=true

# ═══════════════════════════════════════════════════════════
# Endereço da dn.os que serviu este script
# ═══════════════════════════════════════════════════════════
# Chega como primeiro argumento (`curl -sL .../setup.sh | bash -s -- https://…`),
# montado pelo próprio assistente na etapa 1 — o usuário não digita nada.
# Precisamos dele para baixar as skills, que moram no mesmo domínio.
# Quem copiou o comando de uma versão anterior não passa argumento nenhum; nesse
# caso perguntamos, em vez de pular a etapa em silêncio.
DNOS_URL="${1:-}"
DNOS_URL="${DNOS_URL%/}"

ask() {
    local __out=$1 __prompt=$2 __default=${3:-} __silent=${4:-false} __val=""

    if ! $HAS_TTY; then
        printf -v "$__out" '%s' "$__default"
        return
    fi

    if [[ "$__silent" == "true" ]]; then
        read -r -s -p "$__prompt" __val < /dev/tty
        echo "" > /dev/tty
    else
        read -r -p "$__prompt" __val < /dev/tty
    fi

    [[ -z "$__val" ]] && __val="$__default"
    printf -v "$__out" '%s' "$__val"
}

# ═══════════════════════════════════════════════════════════
# Pré-requisitos
# ═══════════════════════════════════════════════════════════
check_prerequisites() {
    log_step "Verificando pré-requisitos..."

    if [[ $EUID -ne 0 ]]; then
        log_error "Este script precisa ser executado como root."
        log_info "Use: sudo bash setup.sh"
        exit 1
    fi
    log_ok "Executando como root"

    if [[ ! -f /etc/os-release ]]; then
        log_error "Sistema operacional não suportado. Precisa ser Ubuntu 22.04+."
        exit 1
    fi
    source /etc/os-release
    if [[ "$ID" != "ubuntu" ]]; then
        log_warn "Este script foi testado no Ubuntu. Seu SO: $PRETTY_NAME"
        log_warn "Continuando, mas podem haver problemas..."
    else
        log_ok "Ubuntu detectado: $PRETTY_NAME"
    fi

    ARCH=$(uname -m)
    if [[ "$ARCH" != "x86_64" ]]; then
        log_error "Arquitetura $ARCH não suportada. Precisa ser x86_64."
        exit 1
    fi
    log_ok "Arquitetura: $ARCH"

    TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
    if [[ $TOTAL_RAM -lt 512 ]]; then
        log_error "RAM insuficiente: ${TOTAL_RAM}MB. Mínimo: 512MB."
        exit 1
    fi
    log_ok "RAM: ${TOTAL_RAM}MB"

    FREE_DISK=$(df -m / | awk 'NR==2 {print $4}')
    if [[ $FREE_DISK -lt 2048 ]]; then
        log_error "Espaço em disco insuficiente: ${FREE_DISK}MB livre. Mínimo: 2GB."
        exit 1
    fi
    log_ok "Disco livre: ${FREE_DISK}MB"
}

# ═══════════════════════════════════════════════════════════
# Instalar dependências do sistema
# ═══════════════════════════════════════════════════════════
install_system_deps() {
    log_step "Instalando dependências do sistema..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq

    local pkgs=(
        curl wget git build-essential
        ca-certificates gnupg
        ufw python3 python3-pip
        jq
    )
    for pkg in "${pkgs[@]}"; do
        if ! dpkg -s "$pkg" &>/dev/null; then
            apt-get install -y -qq "$pkg"
            log_ok "Instalado: $pkg"
        else
            log_ok "Já instalado: $pkg"
        fi
    done
}

# ═══════════════════════════════════════════════════════════
# Instalar Node.js 22.x
# ═══════════════════════════════════════════════════════════
install_nodejs() {
    log_step "Instalando Node.js 22.x..."

    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$NODE_VERSION" -ge 22 ]]; then
            log_ok "Node.js $(node -v) já instalado"
            return 0
        fi
        log_warn "Node.js $(node -v) detectado — atualizando para 22.x..."
    fi

    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - &>/dev/null
    apt-get install -y -qq nodejs
    log_ok "Node.js $(node -v) instalado"
    log_ok "npm $(npm -v)"
}

# ═══════════════════════════════════════════════════════════
# Instalar OpenClaw
# ═══════════════════════════════════════════════════════════
install_openclaw() {
    log_step "Instalando OpenClaw..."

    if command -v openclaw &>/dev/null; then
        log_ok "OpenClaw já instalado: $(openclaw --version 2>/dev/null || echo 'versão detectada')"
    else
        npm install -g openclaw@latest
        log_ok "OpenClaw instalado: $(openclaw --version 2>/dev/null || echo 'ok')"
    fi
}

# ═══════════════════════════════════════════════════════════
# Ativar plugin admin-http-rpc (control plane HTTP do Gateway)
# ═══════════════════════════════════════════════════════════
# A dnOS gerencia o Gateway inteiramente via HTTP POST /api/v1/admin/rpc:
# criação de agentes, crons, sincronização de status e configuração de
# credenciais de LLM (models.providers.*). Esse plugin é bundled mas vem
# DESLIGADO por padrão — sem ativá-lo, um remix novo sobe o Gateway mas a
# dnOS não consegue gerenciar nada nele. Idempotente: reativar é no-op.
# Resultado da ativação, lido depois em verify_installation (evita re-sondar
# via `plugins list`, cujo formato de saída não é garantido entre versões).
ADMIN_RPC_OK=false

enable_admin_rpc() {
    log_step "Ativando control plane HTTP (admin-http-rpc)..."

    if openclaw plugins enable admin-http-rpc &>/dev/null; then
        ADMIN_RPC_OK=true
        log_ok "Plugin admin-http-rpc ativado"
    else
        # Não aborta a instalação: o Gateway ainda sobe. Mas avisa alto,
        # porque sem isso a dnOS não consegue configurar agentes nem a LLM.
        log_warn "Não foi possível ativar admin-http-rpc automaticamente."
        log_warn "Rode manualmente depois: openclaw plugins enable admin-http-rpc && openclaw gateway restart"
    fi
}

# ═══════════════════════════════════════════════════════════
# Configurar workspace dnOS
# ═══════════════════════════════════════════════════════════
setup_workspace() {
    log_step "Configurando workspace dnOS..."

    WORKSPACE_DIR="/root/.openclaw/workspace"
    mkdir -p "$WORKSPACE_DIR/memory"

    if [[ ! -f "$WORKSPACE_DIR/AGENTS.md" ]]; then
        cat > "$WORKSPACE_DIR/AGENTS.md" << 'AGENTSEOF'
# AGENTS.md — dnOS Remix
## Every Session
1. RESPONDER PRIMEIRO: a resposta ao usuário vem antes de qualquer anotação ou busca
2. Use `memory_search()` APENAS quando a pergunta envolver histórico, decisões passadas ou algo que você não sabe — nunca como ritual
3. Anote em `memory/YYYY-MM-DD.md` apenas ao CONCLUIR uma tarefa relevante — nunca durante conversa comum
## LEARNINGS.md — seu conhecimento portável
Mantenha um `LEARNINGS.md` no seu workspace com aprendizados de DOMÍNIO que
valem para qualquer empresa: técnicas que funcionaram, armadilhas, heurísticas.
REGRAS INVIOLÁVEIS deste arquivo (ele viaja em exportações):
- NUNCA credenciais, tokens, chaves ou URLs internas
- NUNCA nomes de clientes, pessoas, empresas ou números de negócio
- Escreva genérico: "vídeos curtos com gancho nos 2s iniciais performam melhor",
  não "o Reel da {empresa} de terça teve 40k views"
Dados da empresa ficam na memória comum, não aqui.
## Ferramentas
- `exec` — executar comandos no VPS
- `web_search` / `web_fetch` — buscar na web
- `read` / `write` / `edit` — manipular arquivos
## Segurança
- Não execute comandos destrutivos sem confirmação
- Não exponha credenciais em respostas
AGENTSEOF
        log_ok "AGENTS.md criado"
    else
        log_ok "AGENTS.md já existe"
    fi

    # Criar .env vazio para uso futuro
    ENV_FILE="/root/.openclaw/.env"
    if [[ ! -f "$ENV_FILE" ]]; then
        mkdir -p "$(dirname "$ENV_FILE")"
        touch "$ENV_FILE"
        log_ok ".env criado"
    fi
}

# ═══════════════════════════════════════════════════════════
# Configurar a LLM
# ═══════════════════════════════════════════════════════════
# ESTA FUNÇÃO RODA ANTES DE O GATEWAY SUBIR PELA PRIMEIRA VEZ — e isso é o
# ponto central do desenho, não um detalhe de ordem.
#
# Configurar LLM com o Gateway JÁ RODANDO (via config.patch remoto da dnOS)
# não funciona hoje: criar um provider novo faz o Gateway tentar se
# auto-reiniciar, a instância antiga ainda segura a porta 18789, o restart
# falha com EADDRINUSE e a escrita é revertida. Testado e reproduzido em
# 2026-07-25. Escrevendo aqui, antes do primeiro boot, não existe processo
# para reiniciar nem porta para disputar — o Gateway simplesmente nasce já
# sabendo qual LLM usar.
#
# Para os provedores oficiais (bundled), a documentação do Gateway é explícita:
#   "Official provider plugins publish their own model catalog rows. These
#    providers require no models.providers model entries; enable the provider
#    plugin, set auth, and pick a model."
# Ou seja: basta a variável de ambiente. Nada de montar JSON, baseUrl ou lista
# de modelos. Só a opção "Outra" precisa do bloco completo, porque aí o Gateway
# trata como custom provider e exige baseUrl + models[].
LLM_PROVIDER=""
LLM_ENV_VAR=""
LLM_CONFIGURED=false

configure_llm() {
    log_step "Configurando a LLM..."

    if ! $HAS_TTY; then
        log_warn "Sem terminal interativo — pulando configuração da LLM."
        log_warn "Configure depois adicionando a chave em /root/.openclaw/.env e reiniciando o Gateway."
        return
    fi

    echo "" > /dev/tty
    cat > /dev/tty << 'MENUEOF'
  Qual LLM os seus agentes vão usar?

    1) DeepSeek           (recomendado — melhor custo-benefício)
    2) OpenAI
    3) Anthropic Claude
    4) Google Gemini
    5) Outra              (avançado — exige URL e modelos)

MENUEOF

    local choice=""
    ask choice "  Escolha [1]: " "1"

    case "$choice" in
        1) LLM_PROVIDER="deepseek";  LLM_ENV_VAR="DEEPSEEK_API_KEY" ;;
        2) LLM_PROVIDER="openai";    LLM_ENV_VAR="OPENAI_API_KEY" ;;
        # Convenção padrão do provedor. Diferente de DEEPSEEK_API_KEY e
        # GEMINI_API_KEY, este nome não foi verificado contra uma instalação
        # real — se o Claude não aparecer no catálogo depois, é o primeiro
        # lugar a conferir.
        3) LLM_PROVIDER="anthropic"; LLM_ENV_VAR="ANTHROPIC_API_KEY" ;;
        4) LLM_PROVIDER="gemini";    LLM_ENV_VAR="GEMINI_API_KEY" ;;
        5) configure_custom_llm; return ;;
        *) log_warn "Opção inválida. Usando DeepSeek."
           LLM_PROVIDER="deepseek"; LLM_ENV_VAR="DEEPSEEK_API_KEY" ;;
    esac

    local key=""
    echo "" > /dev/tty
    ask key "  Cole a chave de API do ${LLM_PROVIDER} (não aparece na tela): " "" true

    if [[ -z "$key" ]]; then
        log_warn "Nenhuma chave informada — a LLM não foi configurada."
        log_warn "Adicione ${LLM_ENV_VAR}=<sua-chave> em /root/.openclaw/.env e reinicie o Gateway."
        return
    fi

    write_env_var "$LLM_ENV_VAR" "$key"

    # Provedores bundled publicam o próprio catálogo, mas o plugin precisa
    # estar habilitado. Falha aqui não aborta: pode já vir ligado por padrão,
    # e a verificação final é que dá a palavra.
    openclaw plugins enable "$LLM_PROVIDER" &>/dev/null || true

    LLM_CONFIGURED=true
    log_ok "LLM configurada: ${LLM_PROVIDER}"
}

# Provider fora da lista oficial (Grok, Mistral, Groq, OpenRouter, modelo local
# via ollama...). Aqui o Gateway EXIGE baseUrl e models[] — confirmado por
# rejeição real: "custom model providers must declare baseUrl" / "must declare
# models". Por isso perguntamos os três dados em vez de adivinhar.
configure_custom_llm() {
    local name="" base_url="" adapter="" models_raw="" key=""

    echo "" > /dev/tty
    echo "  Provedor personalizado — precisamos de alguns dados." > /dev/tty
    echo "  (Consulte a documentação da API que você vai usar.)" > /dev/tty
    echo "" > /dev/tty

    ask name       "  Nome curto, só letras minúsculas (ex: grok): " ""
    ask base_url   "  URL base da API (ex: https://api.x.ai/v1): " ""
    ask models_raw "  IDs dos modelos, separados por vírgula: " ""
    ask key        "  Chave de API (não aparece na tela): " "" true

    if [[ -z "$name" || -z "$base_url" || -z "$models_raw" || -z "$key" ]]; then
        log_warn "Dados incompletos — provedor personalizado não configurado."
        return
    fi

    echo "" > /dev/tty
    echo "  Formato da API deste provedor:" > /dev/tty
    echo "    1) Compatível com OpenAI  (Grok, Mistral, Groq, OpenRouter, Together...)" > /dev/tty
    echo "    2) Anthropic" > /dev/tty
    echo "    3) Google Generative AI" > /dev/tty
    echo "    4) Ollama (modelo local)" > /dev/tty
    local fmt=""
    ask fmt "  Escolha [1]: " "1"
    case "$fmt" in
        2) adapter="anthropic-messages" ;;
        3) adapter="google-generative-ai" ;;
        4) adapter="ollama" ;;
        *) adapter="openai-completions" ;;
    esac

    local env_var
    env_var="$(echo "$name" | tr '[:lower:]-' '[:upper:]_')_API_KEY"
    write_env_var "$env_var" "$key"

    # A chave vai como SecretRef, não em texto puro. Se fosse texto puro, o
    # Gateway a redigiria no disco como "__OPENCLAW_REDACTED__" — e esse
    # sentinela faz QUALQUER config.patch futuro ser rejeitado, travando a
    # config para sempre. Aconteceu de verdade nesta plataforma.
    local models_json
    models_json="$(echo "$models_raw" | tr ',' '\n' | sed 's/^ *//;s/ *$//' \
        | jq -R '{id: .}' | jq -s '.')"

    local cfg="/root/.openclaw/openclaw.json"
    [[ -f "$cfg" ]] || echo '{}' > "$cfg"

    jq --arg n "$name" --arg u "$base_url" --arg a "$adapter" --arg e "$env_var" \
       --argjson m "$models_json" \
       '.models.providers[$n] = {
            api: $a, baseUrl: $u, auth: "api-key",
            apiKey: { source: "env", provider: "default", id: $e },
            models: $m
        }' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"

    LLM_PROVIDER="$name"
    LLM_ENV_VAR="$env_var"
    LLM_CONFIGURED=true
    log_ok "Provedor personalizado configurado: ${name}"
}

# ═══════════════════════════════════════════════════════════
# Segredos internos de integração
# ═══════════════════════════════════════════════════════════
# São valores compartilhados entre a VPS e a plataforma: a VPS os usa para
# autenticar as chamadas que faz de volta (respostas de agente, automações,
# sincronização de skills, coleta de métricas). Não são credenciais de
# terceiros — só precisam ser IGUAIS dos dois lados.
# Gerar aqui, e não pedir ao usuário, é deliberado: são 8 strings aleatórias
# que ninguém deveria ter de inventar nem entender. O script grava no .env e
# imprime no bloco final, para colar de uma vez na dnOS.
INTERNAL_SECRETS=(
    AGENT_REPLY_WEBHOOK_SECRET
    AUTOMATION_WEBHOOK_SECRET
    BROADCAST_API_KEY
    GUARDRAILS_API_TOKEN
    SKILL_SYNC_SECRET
    INGEST_KEY
    COLLECTOR_API_TOKEN
    AGENT_ACTIVITY_BRIDGE_TOKEN
)

generate_internal_secrets() {
    log_step "Gerando segredos de integração..."

    for name in "${INTERNAL_SECRETS[@]}"; do
        # Idempotente: reexecutar o instalador não troca segredos já em uso,
        # o que quebraria a integração com a dnOS já configurada.
        if grep -q "^${name}=" /root/.openclaw/.env 2>/dev/null; then
            log_ok "${name} já existe — mantido"
        else
            write_env_var "$name" "$(openssl rand -hex 32)"
        fi
    done

    log_ok "${#INTERNAL_SECRETS[@]} segredos prontos"
}

# Escreve (ou substitui) uma variável no .env sem duplicar linhas.
write_env_var() {
    local name=$1 value=$2 env_file="/root/.openclaw/.env"
    mkdir -p "$(dirname "$env_file")"
    touch "$env_file"
    chmod 600 "$env_file"

    if grep -q "^${name}=" "$env_file"; then
        sed -i "s|^${name}=.*|${name}=${value}|" "$env_file"
    else
        echo "${name}=${value}" >> "$env_file"
    fi
}

# ═══════════════════════════════════════════════════════════
# Criar serviço systemd
# ═══════════════════════════════════════════════════════════
create_systemd_service() {
    log_step "Configurando serviço systemd..."

    SERVICE_FILE="/etc/systemd/system/openclaw-gateway.service"
    cat > "$SERVICE_FILE" << SYSTEMEOF
[Unit]
Description=OpenClaw Gateway — dnOS Remix
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.openclaw
EnvironmentFile=/root/.openclaw/.env
ExecStart=/usr/bin/openclaw gateway start
ExecStop=/usr/bin/openclaw gateway stop
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw-gateway
MemoryMax=2G
CPUQuota=200%
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
SYSTEMEOF

    systemctl daemon-reload
    systemctl enable openclaw-gateway
    log_ok "Serviço systemd criado e habilitado"
}

# ═══════════════════════════════════════════════════════════
# Configurar firewall (UFW)
# ═══════════════════════════════════════════════════════════
configure_firewall() {
    log_step "Configurando firewall..."

    if ! command -v ufw &>/dev/null; then
        apt-get install -y -qq ufw
    fi

    ufw allow 22/tcp comment "SSH"
    ufw allow 18789/tcp comment "OpenClaw Gateway"

    if command -v nginx &>/dev/null; then
        ufw allow 80/tcp comment "HTTP"
        ufw allow 443/tcp comment "HTTPS"
    fi

    if ! ufw status | grep -q "Status: active"; then
        echo "y" | ufw enable
        log_ok "UFW ativado"
    else
        log_ok "UFW já ativo"
    fi

    ufw status verbose | grep -v "^$" | while read -r line; do
        log_info "  $line"
    done
}

# ═══════════════════════════════════════════════════════════
# Iniciar Gateway
# ═══════════════════════════════════════════════════════════
start_gateway() {
    log_step "Iniciando OpenClaw Gateway..."

    systemctl start openclaw-gateway
    sleep 3

    if systemctl is-active --quiet openclaw-gateway; then
        log_ok "Gateway iniciado com sucesso"
    else
        log_error "Falha ao iniciar o Gateway"
        log_info "Logs: journalctl -u openclaw-gateway -n 20"
        systemctl status openclaw-gateway --no-pager || true
    fi
}

# ═══════════════════════════════════════════════════════════
# Verificação final
# ═══════════════════════════════════════════════════════════
verify_installation() {
    log_step "Verificando instalação..."
    local all_ok=true

    echo ""
    if command -v node &>/dev/null; then
        log_ok "Node.js: $(node -v)"
    else
        log_error "Node.js: NÃO instalado"
        all_ok=false
    fi

    if command -v npm &>/dev/null; then
        log_ok "npm: $(npm -v)"
    else
        log_error "npm: NÃO instalado"
        all_ok=false
    fi

    if command -v openclaw &>/dev/null; then
        log_ok "OpenClaw: instalado"
    else
        log_error "OpenClaw: NÃO instalado"
        all_ok=false
    fi

    if systemctl is-active --quiet openclaw-gateway; then
        log_ok "Gateway: rodando"
    else
        log_warn "Gateway: parado (pode precisar de configuração adicional)"
    fi

    # Control plane HTTP — sem ele a dnOS não gerencia o Gateway (agentes,
    # crons, LLM). Falha aqui é motivo de instalação com ressalva.
    if $ADMIN_RPC_OK; then
        log_ok "Control plane (admin-http-rpc): ativo"
    else
        log_error "Control plane (admin-http-rpc): NÃO ativo — a dnOS não conseguirá configurar agentes nem a LLM"
        all_ok=false
    fi

    if ufw status | grep -q "Status: active"; then
        log_ok "Firewall: ativo"
    else
        log_warn "Firewall: inativo"
    fi

    # Os dois pré-requisitos da ativação do time. Sem eles a instalação parece
    # perfeita e o assistente falha lá na última etapa, longe daqui.
    if [[ -f /root/.openclaw/workspace/skills/superagent-onboards/SKILL.md ]]; then
        log_ok "Skill de onboarding: instalada"
    else
        log_error "Skill de onboarding: AUSENTE — o assistente não conseguirá ativar o time"
        all_ok=false
    fi

    if [[ -d /root/.openclaw/workspace-lia ]]; then
        log_ok "Agente orquestradora: pronta"
    else
        log_error "Agente orquestradora: AUSENTE — o assistente não conseguirá ativar o time"
        all_ok=false
    fi

    echo ""
    if $all_ok; then
        echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}${BOLD}║  ✅ dnOS Remix instalado com sucesso!   ║${NC}"
        echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
    else
        echo -e "${YELLOW}${BOLD}⚠️  Instalação concluída com ressalvas.${NC}"
        echo -e "${YELLOW}Verifique os itens acima marcados como erro.${NC}"
    fi

    echo ""
    print_handoff_block
}

# ═══════════════════════════════════════════════════════════
# Bloco de entrega para a dnOS
# ═══════════════════════════════════════════════════════════
# Tudo que a plataforma precisa saber sobre esta VPS, em um único bloco para
# copiar de uma vez. Antes, o usuário tinha de preencher 12 campos à mão no
# painel da Lovable e ainda anotar o IP e o token do terminal — os segredos
# internos, que ninguém deveria precisar entender, eram parte disso.
# O token de admin é gerado pelo próprio OpenClaw. O caminho na config pode
# variar entre versões, então tentamos os mais prováveis e devolvemos vazio se
# nenhum responder — quem chama decide o que fazer, em vez de imprimir algo
# errado.
read_gateway_token() {
    local t
    t="$(openclaw config get gateway.auth.token 2>/dev/null \
      || openclaw config get gateway.token 2>/dev/null \
      || echo "")"
    echo "$t" | tr -d '"' | tr -d '[:space:]'
}

# ═══════════════════════════════════════════════════════════
# Skills
# ═══════════════════════════════════════════════════════════
# Sem isto, o botão "Ativar time" do assistente manda a Lia rodar
# `superagent-onboards` e ela não acha skill nenhuma: o arquivo existe só no
# repositório, servido pelo domínio da dn.os, e nada o trazia para a VPS.
# O caminho é o que a própria skill declara no rodapé dela.
install_skills() {
    log_step "Instalando skills..."

    if [[ -z "$DNOS_URL" ]]; then
        log_warn "O endereço da sua dn.os não veio no comando de instalação."
        ask DNOS_URL "  Cole o endereço publicado da sua dn.os (ex: https://minhaempresa.lovable.app): " ""
        DNOS_URL="${DNOS_URL%/}"
    fi

    if [[ -z "$DNOS_URL" ]]; then
        log_warn "Sem o endereço, as skills não podem ser baixadas."
        log_warn "O time não vai poder ser ativado pelo assistente até isso ser resolvido."
        return
    fi

    local skills_dir="/root/.openclaw/workspace/skills"
    local name ok=0
    for name in superagent-onboards export-agent; do
        mkdir -p "$skills_dir/$name"
        if curl -fsSL --max-time 20 "$DNOS_URL/skills/$name/SKILL.md" \
             -o "$skills_dir/$name/SKILL.md" 2>/dev/null; then
            log_ok "Skill $name instalada"
            ok=$((ok + 1))
        else
            # Falha aqui quase sempre é a dn.os não publicada — o domínio existe
            # mas o arquivo não. Dizer isso é mais útil que "erro de download".
            log_warn "Não foi possível baixar a skill $name de $DNOS_URL"
            rmdir "$skills_dir/$name" 2>/dev/null || true
        fi
    done

    if [[ $ok -eq 0 ]]; then
        log_warn "Nenhuma skill instalada. Verifique se a dn.os já foi publicada (botão Publicar)."
    fi
}

# ═══════════════════════════════════════════════════════════
# Ponte de arquivos (dnos-files-bridge)
# ═══════════════════════════════════════════════════════════
# O gateway não expõe leitura nem escrita de arquivo por HTTP (sondado em
# 27/07: /tools/invoke só tem tools de sessão). Sem esta ponte, exportar um
# agente dependia de um LLM transcrever arquivos, e importar gravava numa
# tabela que nunca chegava ao disco.
#
# A ponte é determinística e minúscula: a cada 60s,
#   1) empurra os .md alterados dos workspaces para a dn.os (tabela
#      agent_files, via sync-agent-files com o GUARDRAILS_API_TOKEN);
#   2) puxa os arquivos marcados pending_write (importação) e escreve em
#      /root/.openclaw/workspace-{agente}/, confirmando um a um.
install_files_bridge() {
    log_step "Instalando ponte de arquivos (dnos-files-bridge)..."

    if [[ -z "$DNOS_URL" ]]; then
        log_warn "Sem o endereço da dn.os — ponte de arquivos não instalada."
        return
    fi

    local supabase_url
    # A URL do Supabase está compilada no bundle JS que a própria dn.os serve —
    # extrai de lá, determinístico. Cada remix tem seu próprio projeto, então
    # não dá para fixar.
    supabase_url="$(curl -fsSL --max-time 20 "$DNOS_URL" 2>/dev/null \
        | grep -o 'src="[^"]*\.js"' | head -1 | sed 's/src="//;s/"//' \
        | xargs -I{} curl -fsSL --max-time 20 "$DNOS_URL{}" 2>/dev/null \
        | grep -o 'https://[a-z0-9]*\.supabase\.co' | head -1 || true)"
    if [[ -z "$supabase_url" ]]; then
        # Fallback: pergunta (instalação interativa) ou pula com aviso.
        ask supabase_url "  URL do Supabase do projeto (https://<ref>.supabase.co, vazio pula a ponte): " ""
    fi
    if [[ -z "$supabase_url" ]]; then
        log_warn "Ponte de arquivos não instalada — exportar/importar agentes não vai funcionar até isso ser resolvido."
        return
    fi

    cat > /usr/local/bin/dnos-files-bridge << 'BRIDGEEOF'
#!/usr/bin/env bash
# dnos-files-bridge — espelho determinístico workspace ↔ dn.os. Sem LLM.
set -u
ENV_FILE="/root/.openclaw/.env"
STATE="/root/.openclaw/.files-bridge-state"
BASE="/root/.openclaw"
TOKEN="$(grep '^GUARDRAILS_API_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
SUPABASE_URL="$(grep '^DNOS_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
[[ -z "$TOKEN" || -z "$SUPABASE_URL" ]] && exit 0
SYNC="$SUPABASE_URL/functions/v1/sync-agent-files"
mkdir -p "$STATE"

# 1) push: workspaces -> tabela (só arquivos .md alterados desde o último push)
for ws in "$BASE"/workspace-*; do
    [[ -d "$ws" ]] || continue
    agent="${ws##*/workspace-}"
    for f in "$ws"/*.md; do
        [[ -f "$f" ]] || continue
        name="${f##*/}"
        stamp="$STATE/${agent}__${name}.pushed"
        [[ -f "$stamp" && ! "$f" -nt "$stamp" ]] && continue
        python3 - "$agent" "$name" "$f" "$SYNC" "$TOKEN" <<'PYEOF'
import json, sys, urllib.request
agent, name, path, sync, token = sys.argv[1:6]
content = open(path, encoding="utf-8", errors="replace").read()[:490000]
body = json.dumps({"agent_id": agent, "files": [{"file_name": name, "content": content}], "origin": "vps"}).encode()
req = urllib.request.Request(sync, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
urllib.request.urlopen(req, timeout=20).read()
PYEOF
        [[ $? -eq 0 ]] && touch -r "$f" "$stamp"
    done
done

# 2) pull: pendências de escrita (importação) -> disco, com confirmação 1 a 1
python3 - "$SYNC" "$TOKEN" "$BASE" <<'PYEOF'
import json, os, re, sys, urllib.request
sync, token, base = sys.argv[1:4]
def call(payload):
    req = urllib.request.Request(sync, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())
pending = call({"action": "pull_pending"}).get("files", [])
acked = []
for f in pending:
    agent, name = f.get("agent_id", ""), f.get("file_name", "")
    # Guardas: id e nome saneados, sem travessia de diretório.
    if not re.fullmatch(r"[a-z0-9-]{2,32}", agent): continue
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", name) or ".." in name: continue
    ws = os.path.join(base, f"workspace-{agent}")
    os.makedirs(ws, exist_ok=True)
    with open(os.path.join(ws, name), "w", encoding="utf-8") as out:
        out.write(f.get("content") or "")
    acked.append({"agent_id": agent, "file_name": name})
if acked:
    call({"action": "ack_written", "files": acked})
PYEOF
BRIDGEEOF
    chmod +x /usr/local/bin/dnos-files-bridge

    # A URL do Supabase fica no .env junto dos demais valores da instalação.
    write_env_var "DNOS_SUPABASE_URL" "$supabase_url"

    cat > /etc/systemd/system/dnos-files-bridge.service << 'SVCEOF'
[Unit]
Description=dnOS files bridge (workspace <-> dn.os)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/dnos-files-bridge
SVCEOF

    cat > /etc/systemd/system/dnos-files-bridge.timer << 'TMREOF'
[Unit]
Description=Run dnos-files-bridge every minute
[Timer]
OnBootSec=90s
OnUnitActiveSec=60s
[Install]
WantedBy=timers.target
TMREOF

    systemctl daemon-reload
    systemctl enable --now dnos-files-bridge.timer &>/dev/null \
        && log_ok "Ponte de arquivos ativa (timer de 60s)" \
        || log_warn "Não foi possível ativar o timer da ponte"
}

# ═══════════════════════════════════════════════════════════
# Coletor de uso (dnos-usage-push)
# ═══════════════════════════════════════════════════════════
# O OpenClaw registra cada chamada de LLM num arquivo de trajetória local,
# com modelo real, data e divisão de cache — mas não expõe isso por API
# (sondado em 30/07). Sem este coletor, o painel de uso da dn.os nasce cego.
# Envia SÓ medição: nenhum conteúdo de conversa sai do servidor.
install_usage_push() {
    log_step "Instalando coletor de uso (dnos-usage-push)..."
    if [[ -z "$DNOS_URL" ]]; then
        log_warn "Sem o endereço da dn.os — coletor de uso não instalado."
        return
    fi
    if curl -fsSL --max-time 30 "$DNOS_URL/install-usage-push.sh" | bash &>/dev/null; then
        log_ok "Coletor de uso ativo (timer de 5min)"
    else
        log_warn "Não foi possível instalar o coletor de uso — o painel de uso ficará vazio."
    fi
}

# ═══════════════════════════════════════════════════════════
# Sincronizador de skills (dnos-skill-sync)
# ═══════════════════════════════════════════════════════════
# O clique na UI de skills grava a intenção; este serviço puxa e aplica na
# VPS. É puxada (de dentro para fora) de propósito: o empurrão do Supabase
# para o domínio público morre no Cloudflare, e cada remix teria de mexer em
# WAF/DNS para funcionar — aqui, nada a configurar. Usa o SKILL_SYNC_SECRET
# e a DNOS_SUPABASE_URL que este instalador já gravou no .env.
install_skill_sync() {
    log_step "Instalando sincronizador de skills (dnos-skill-sync)..."
    if [[ -z "$DNOS_URL" ]]; then
        log_warn "Sem o endereço da dn.os — sincronizador de skills não instalado."
        return
    fi
    if curl -fsSL --max-time 30 "$DNOS_URL/install-skill-sync.sh" | bash &>/dev/null; then
        log_ok "Sincronizador de skills ativo (loop de 7s)"
    else
        log_warn "Não foi possível instalar o sincronizador — instalar skills pela UI não vai funcionar."
    fi
}

# ═══════════════════════════════════════════════════════════
# Agente líder
# ═══════════════════════════════════════════════════════════
# Ovo e galinha: a skill que cria os agentes roda DENTRO de um agente. Numa VPS
# recém-instalada não existe nenhum, então o assistente chamava `openclaw:lia` e
# não havia Lia. Aqui ela nasce mínima — um casco que sobe e executa a skill. É
# a própria `superagent-onboards` que depois escreve o SOUL/IDENTITY/TOOLS dela,
# já com os dados da empresa, junto com os demais agentes.
#
# O workspace precisa ser EXATAMENTE o que a skill usa (`workspace-lia`): se
# divergir, a skill escreve num lugar e ela lê de outro, e nada acusa erro.
create_leader_agent() {
    log_step "Criando a agente orquestradora (Lia)..."

    local token workspace="/root/.openclaw/workspace-lia"
    token="$(read_gateway_token)"

    if [[ -z "$token" ]]; then
        log_warn "Não foi possível ler o token do gateway — a Lia não foi criada."
        log_warn "Sem ela, o assistente não consegue ativar o time."
        return
    fi

    mkdir -p "$workspace"

    local body http
    body="$(printf '{"method":"agents.create","params":{"name":"Lia","workspace":"%s"}}' "$workspace")"
    http="$(curl -s -o /tmp/dnos-agent-create.json -w '%{http_code}' --max-time 20 \
        -X POST "http://127.0.0.1:18789/api/v1/admin/rpc" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d "$body" 2>/dev/null || echo "000")"

    # "already exists" não é erro: reinstalar por cima é um caso normal.
    if [[ "$http" == "200" ]] || grep -qi "exists" /tmp/dnos-agent-create.json 2>/dev/null; then
        log_ok "Lia registrada no gateway"
    else
        log_warn "Falha ao registrar a Lia (HTTP $http)"
        [[ -s /tmp/dnos-agent-create.json ]] && log_warn "  $(head -c 200 /tmp/dnos-agent-create.json)"
    fi
    rm -f /tmp/dnos-agent-create.json

    # Confere o id que o gateway realmente atribuiu. O assistente chama
    # `openclaw:lia`; se o gateway derivar outro id a partir do nome, o time
    # falha na ativação e o erro aparece longe daqui.
    local agents
    agents="$(curl -s --max-time 10 -X POST "http://127.0.0.1:18789/api/v1/admin/rpc" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d '{"method":"agents.list","params":{}}' 2>/dev/null || echo "")"

    if echo "$agents" | grep -q '"lia"'; then
        log_ok "Confirmado: a Lia responde pelo id 'lia'"
    else
        log_warn "A Lia foi criada, mas o gateway não a listou com o id 'lia'."
        log_warn "O assistente chama 'openclaw:lia' — avise o suporte antes de ativar o time."
    fi
}

print_handoff_block() {
    local ip token
    ip="$(curl -s --max-time 5 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
    token="$(read_gateway_token)"

    echo -e "${CYAN}${BOLD}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║   COPIE O BLOCO ABAIXO E COLE NA SUA dn.os                ║"
    echo "║   (no assistente de configuração, primeira etapa)         ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo "GATEWAY_URL=http://${ip}:18789"

    if [[ -n "$token" ]]; then
        echo "OPENCLAW_ADMIN_TOKEN=${token}"
    else
        echo "# OPENCLAW_ADMIN_TOKEN=<não foi possível ler automaticamente>"
        echo "# Rode na VPS: openclaw config get gateway.auth.token"
    fi

    for name in "${INTERNAL_SECRETS[@]}"; do
        local value
        value="$(grep "^${name}=" /root/.openclaw/.env 2>/dev/null | head -1 | cut -d= -f2-)"
        [[ -n "$value" ]] && echo "${name}=${value}"
    done

    echo ""
    echo -e "${CYAN}───────────────────────────────────────────────────────────${NC}"
    echo ""

    if $LLM_CONFIGURED; then
        log_ok "LLM configurada (${LLM_PROVIDER}) — seus agentes já podem responder"
    else
        log_warn "Nenhuma LLM configurada — os agentes não vão responder até você configurar uma."
    fi

    log_info "Próximos passos:"
    echo "  1. Copie o bloco acima (tudo, da primeira à última linha)"
    echo "  2. Abra sua dn.os no navegador e crie a conta de administrador"
    echo "  3. Cole o bloco no assistente de configuração"
    echo ""
    echo -e "${YELLOW}  Guarde este bloco em local seguro — ele contém credenciais.${NC}"
    echo ""
}

# ═══════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════
main() {
    echo -e "${CYAN}${BOLD}"
    echo "╔══════════════════════════════════════════╗"
    echo "║     🧠 dnOS Remix — Instalador VPS      ║"
    echo "║        v1.1.0 — $(date +%Y-%m-%d)         ║"
    echo "╚══════════════════════════════════════════╝"
    echo -e "${NC}"

    check_prerequisites
    install_system_deps
    install_nodejs
    install_openclaw
    enable_admin_rpc
    setup_workspace
    # A LLM e os segredos entram ANTES do systemd e do start: o Gateway precisa
    # subir pela primeira vez já com tudo no lugar. Configurar depois, com o
    # processo rodando, é o caminho que falha (ver comentário em configure_llm).
    configure_llm
    generate_internal_secrets
    install_skills
    install_files_bridge
    install_usage_push
    install_skill_sync
    create_systemd_service
    configure_firewall
    start_gateway
    # Depois do start: criar agente é chamada de RPC, precisa do gateway no ar.
    create_leader_agent
    verify_installation
}

main "$@"
