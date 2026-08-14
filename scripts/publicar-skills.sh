#!/usr/bin/env bash
# Publica as skills do repositório no gateway.
#
#   bash scripts/publicar-skills.sh            # mostra o que faria
#   bash scripts/publicar-skills.sh --enviar   # envia
#
# As skills vivem em `skills/<slug>/SKILL.md`, versionadas junto do código. Este
# script as copia para o `managedSkillsDir` do gateway na VPS.
#
# ⚠️ **Por que copiar em vez de instalar pelo gateway.** O `skills.install` do
#    OpenClaw aceita três origens — marketplace, `installId` e `uploadId` — e
#    nenhuma delas é conteúdo direto. Marketplace exigiria hospedar um feed
#    HTTPS, que é infraestrutura demais para o problema. Arquivo no
#    `managedSkillsDir` é o caminho que o próprio gateway já lê.
#
# ⚠️ Skill NÃO é arquivo de workspace. Os sete canônicos entram no contexto a
#    cada sessão; a skill só é carregada quando o agente decide usá-la. É por
#    isso que procedimento longo vira skill em vez de virar seção do AGENTS.md.

set -uo pipefail

VPS="${VPS_OPENCLAW:-root@2.24.85.122}"
DESTINO="${SKILLS_DIR:-/root/.openclaw/skills}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORIGEM="$RAIZ/skills"
ENVIAR=0
[ "${1:-}" = "--enviar" ] && ENVIAR=1

pista() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

pista "1. Skills no repositório"
achou=0
for d in "$ORIGEM"/*/; do
  [ -f "$d/SKILL.md" ] || continue
  slug=$(basename "$d")
  linhas=$(wc -l < "$d/SKILL.md")
  # O `name` do frontmatter tem que bater com o diretório, senão o gateway
  # registra a skill com um nome e o agente a invoca por outro.
  nome=$(grep -m1 '^name:' "$d/SKILL.md" | sed 's/^name:[[:space:]]*//')
  if [ "$nome" != "$slug" ]; then
    printf '   \033[31m✗\033[0m %-22s frontmatter diz "%s" — precisa bater com o diretório\n' "$slug" "$nome"
    exit 1
  fi
  printf '   %-22s %s linhas\n' "$slug" "$linhas"
  achou=1
done
[ "$achou" -eq 0 ] && { echo "   nenhuma skill em $ORIGEM"; exit 0; }

if [ "$ENVIAR" -eq 0 ]; then
  printf '\n\033[1mIsto foi só a conferência.\033[0m Para enviar:\n'
  echo "   bash $0 --enviar"
  exit 0
fi

pista "2. Enviando para $VPS:$DESTINO"
# `rsync` em vez de `scp -r`: só manda o que mudou, e o `--delete` some com
# skill removida do repositório em vez de deixá-la viva no gateway.
if command -v rsync >/dev/null; then
  rsync -az --delete --itemize-changes \
        --include='*/' --include='SKILL.md' --include='*/**' --exclude='*' \
        "$ORIGEM/" "$VPS:$DESTINO/" || exit 1
else
  echo "   rsync ausente — usando scp (não remove skill apagada)"
  ssh "$VPS" "mkdir -p '$DESTINO'"
  scp -r "$ORIGEM"/* "$VPS:$DESTINO/" || exit 1
fi

pista "3. O gateway reconheceu?"
# `skills.status` relê o diretório; não precisa reiniciar nada.
ssh "$VPS" "ls -1 '$DESTINO'" | sed 's/^/   /'

printf '\n\033[1mPronto.\033[0m A skill fica disponível para o agente invocar.\n'
printf 'Se não aparecer em `skills.status`, confira o frontmatter — nome e\n'
printf 'description são obrigatórios, e `always: false` é o que a mantém fora\n'
printf 'do contexto até ser usada.\n'
