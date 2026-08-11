#!/usr/bin/env bash
# Diagnóstico do túnel para o OpenClaw, rodado NA VPS DA APLICAÇÃO (62.72.11.28).
#
# Responde uma pergunta que muda a decisão de arquitetura: o túnel está CAINDO
# ou nunca SUBIU? As duas coisas se parecem de fora — o gateway não responde —
# e levam a soluções opostas. Trocar o mecanismo por causa de instabilidade que
# não existe é trabalho jogado fora.
#
#   scp scripts/diagnosticar-tunel.sh root@62.72.11.28:/root/
#   ssh root@62.72.11.28 'bash /root/diagnosticar-tunel.sh'
#
# Só leitura: não instala, não reinicia, não altera nada.

set -uo pipefail
SERVICO=openclaw-tunnel
PORTA=18789
BRIDGE_IP=172.18.0.1

echo "═══ 1. O serviço existe? ═══"
if ! systemctl list-unit-files | grep -q "^$SERVICO.service"; then
  echo "  ❌ NÃO INSTALADO — a unidade $SERVICO.service não existe neste host."
  echo
  echo "  Este é o veredito mais provável num deploy novo, e significa que o"
  echo "  túnel nunca caiu: ele nunca existiu. A correção é rodar o instalador,"
  echo "  não trocar de tecnologia."
  echo
  echo "      scp scripts/tunel-openclaw.sh root@62.72.11.28:/root/"
  echo "      ssh root@62.72.11.28 'bash /root/tunel-openclaw.sh'"
  exit 0
fi
echo "  ✅ instalado"

echo
echo "═══ 2. Está ativo agora? ═══"
systemctl is-active "$SERVICO" | sed 's/^/  estado: /'
systemctl is-enabled "$SERVICO" 2>/dev/null | sed 's/^/  no boot: /'

echo
echo "═══ 3. Está caindo? (a pergunta que importa) ═══"
# NRestarts é o contador do systemd desde o último `reset-failed`. É a medida
# direta de instabilidade — sem ele a conversa vira impressão.
reinicios=$(systemctl show -p NRestarts --value "$SERVICO" 2>/dev/null)
desde=$(systemctl show -p ActiveEnterTimestamp --value "$SERVICO" 2>/dev/null)
echo "  reinícios desde o boot : ${reinicios:-?}"
echo "  no ar desde            : ${desde:-?}"
if [ "${reinicios:-0}" -gt 5 ] 2>/dev/null; then
  echo "  ⚠️  ISTO É INSTABILIDADE REAL — vale trocar o mecanismo."
elif [ "${reinicios:-0}" -gt 0 ] 2>/dev/null; then
  echo "  ↺ reiniciou algumas vezes e se recuperou sozinho, que é o desenho."
else
  echo "  ✅ nunca reiniciou — o túnel não é a fonte da instabilidade."
fi

echo
echo "═══ 4. Está escutando onde o container procura? ═══"
if ss -ltn 2>/dev/null | grep -q "$BRIDGE_IP:$PORTA"; then
  echo "  ✅ escutando em $BRIDGE_IP:$PORTA"
else
  echo "  ❌ NÃO está escutando em $BRIDGE_IP:$PORTA"
  echo "     O que está aberto na porta $PORTA:"
  ss -ltn 2>/dev/null | grep ":$PORTA" | sed 's/^/       /' || echo "       nada"
  echo
  echo "  ⚠️ Escutar em 127.0.0.1 não serve: dentro do container isso é o"
  echo "     próprio container. O EasyPanel usa Swarm, e o caminho até o host"
  echo "     é a docker_gwbridge ($BRIDGE_IP)."
  echo "     IPs de bridge existentes neste host:"
  ip -4 -o addr show 2>/dev/null | grep -E 'docker|br-' | awk '{print "       "$2" "$4}'
fi

echo
echo "═══ 5. O gateway responde pelo túnel? ═══"
if command -v curl >/dev/null && curl -s -m 8 -o /dev/null "http://$BRIDGE_IP:$PORTA/health"; then
  echo "  ✅ /health respondeu"
else
  echo "  ❌ /health não respondeu pelo túnel"
fi

echo
echo "═══ 6. Últimas 25 linhas do log ═══"
# O motivo da queda está aqui. "Permission denied (publickey)" = a chave saiu
# do authorized_keys do gateway; "Connection refused" = o gateway caiu do lado
# de lá; silêncio + reinícios = rede instável entre as duas VPS.
journalctl -u "$SERVICO" -n 25 --no-pager 2>/dev/null | sed 's/^/  /'
