#!/bin/bash
# Instala o sincronizador de skills (dn.os → VPS, por PUXADA).
#
# Por que puxada: o clique na UI gravava a intenção e o Supabase tentava
# POSTar na VPS pelo domínio público — e o Cloudflare engole POSTs na borda
# (GET passa, POST morre com 404 "Not Found", server: cloudflare). Puxar é
# conexão de dentro para fora: funciona em qualquer remix sem tocar em DNS,
# WAF ou proxy.
#
# O serviço roda em loop (7s): puxa intenções do skill-manage, materializa
# arquivos de skill manual no diretório global, registra/desregistra no
# agente pela API local (127.0.0.1:18990) e reporta o resultado — o selo do
# agente na UI fica verde sozinho, via realtime.
#
# Uso:  curl -sL https://SEU-DNOS/install-skill-sync.sh | bash -s -- https://SEU-PROJETO.supabase.co
set -euo pipefail

# Mesmo padrão do install-usage-push: a URL do Supabase mora no .env da VPS
# (o setup.sh a grava). Argumento só como exceção/override.
ENV_FILE=/root/.openclaw/.env
SUPABASE_URL="${1:-}"
if [[ -z "$SUPABASE_URL" ]]; then
    SUPABASE_URL="$(grep '^DNOS_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
fi
if [[ -z "$SUPABASE_URL" ]]; then
    echo "[ERRO] DNOS_SUPABASE_URL não encontrado em $ENV_FILE e nenhum argumento informado."
    echo "       Uso: bash -s -- https://SEU-PROJETO.supabase.co"
    exit 1
fi
DIR=/opt/dnos-skill-sync

mkdir -p "$DIR"
cat > "$DIR/sync.py" <<'PYEOF'
#!/usr/bin/env python3
"""Sincronizador de skills: puxa intenções do dn.os e aplica na VPS."""
import json, os, sys, time, subprocess, urllib.request, urllib.error

SUPABASE_URL = os.environ["DNOS_SUPABASE_URL"].rstrip("/")
ENDPOINT = SUPABASE_URL + "/functions/v1/skill-manage"
SKILLS_DIR = "/usr/lib/node_modules/openclaw/skills"
API_LOCAL = "http://127.0.0.1:18990"
# Long-poll: o servidor segura a resposta até 20s esperando trabalho. Clique
# vira instalação em 1-2s, e o total de chamadas cai. O intervalo aqui é só o
# respiro entre uma espera e a próxima.
INTERVALO = 1
ESPERA_SERVIDOR = 20

def env_openclaw(nome):
    # O secret mora em /root/.openclaw/.env (o mesmo da skills-api) — nenhuma
    # credencial nova é criada para este serviço.
    try:
        for linha in open("/root/.openclaw/.env"):
            linha = linha.strip()
            if linha.startswith(nome + "="):
                return linha.split("=", 1)[1].strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return None

SECRET = env_openclaw("SKILL_SYNC_SECRET")
if not SECRET:
    print("[skill-sync] SKILL_SYNC_SECRET ausente em /root/.openclaw/.env — abortando")
    sys.exit(1)

def token_gateway():
    return json.load(open("/root/.openclaw/openclaw.json"))["gateway"]["auth"]["token"]

def chamar(url, metodo="POST", corpo=None, bearer=None, timeout=30):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {bearer}",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")

def api_disponivel():
    try:
        urllib.request.urlopen(f"{API_LOCAL}/health", timeout=3)
        return True
    except Exception:
        return False

def registrar_direto(agent_id, slug, remover_flag=False):
    """Sem a skills-api (remix limpo), o puller registra sozinho.

    Leitura-modificação-escrita do openclaw.json, como a própria skills-api
    faz. Num remix não há outro escritor concorrendo; nesta VPS a API observa
    o arquivo e absorve mudanças externas.
    """
    caminho = "/root/.openclaw/openclaw.json"
    cfg = json.load(open(caminho))
    for a in cfg.get("agents", {}).get("list", []):
        if a.get("id") != agent_id:
            continue
        skills = a.setdefault("skills", [])
        if remover_flag:
            if slug in skills: skills.remove(slug)
        elif slug not in skills:
            skills.append(slug)
        tmp = caminho + ".tmp"
        with open(tmp, "w") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, caminho)
        return
    raise RuntimeError(f"agente {agent_id} não existe no openclaw.json")

def clonar_git(slug, url):
    destino = os.path.join(SKILLS_DIR, slug)
    if os.path.isdir(os.path.join(destino, ".git")):
        subprocess.run(["git", "-C", destino, "pull", "--ff-only"], check=True,
                       capture_output=True, timeout=90)
    else:
        subprocess.run(["git", "clone", "--depth", "1", url, destino], check=True,
                       capture_output=True, timeout=120)

def instalar(t, tok):
    slug = t["slug"]
    if t.get("source") == "git" and t.get("source_url"):
        if api_disponivel():
            # A API local clona, registra e reativa o gateway sozinha.
            chamar(f"{API_LOCAL}/admin/agents/{t['agent_id']}/skills", "POST",
                   {"skill": slug, "source": "git", "source_url": t["source_url"]}, tok, timeout=120)
            return False  # restart já feito pela API
        clonar_git(slug, t["source_url"])
        registrar_direto(t["agent_id"], slug)
        return True
    # Skill manual: materializa os arquivos — era o elo que não existia; a API
    # só escrevia arquivos para source=git, e skill criada no editor do dn.os
    # nunca chegava ao disco.
    conteudo = (t.get("content") or "").strip()
    if not conteudo:
        raise RuntimeError("skill sem conteúdo no dn.os — nada para materializar")
    pasta = os.path.join(SKILLS_DIR, slug)
    os.makedirs(pasta, exist_ok=True)
    caminho = os.path.join(pasta, "SKILL.md")
    mudou = not (os.path.exists(caminho) and open(caminho, encoding="utf-8", errors="replace").read() == conteudo)
    if mudou:
        with open(caminho, "w", encoding="utf-8") as f:
            f.write(conteudo)
        os.chmod(caminho, 0o644)
    if api_disponivel():
        chamar(f"{API_LOCAL}/admin/agents/{t['agent_id']}/skills", "POST", {"skill": slug}, tok)
    else:
        registrar_direto(t["agent_id"], slug)
    return mudou  # arquivos novos pedem restart para o gateway carregar

def remover(t, tok):
    # Desregistra do agente; os arquivos ficam (outro agente pode usar).
    if not api_disponivel():
        registrar_direto(t["agent_id"], t["slug"], remover_flag=True)
        return
    try:
        chamar(f"{API_LOCAL}/admin/agents/{t['agent_id']}/skills/{t['slug']}", "DELETE", None, tok)
    except urllib.error.HTTPError as e:
        if e.code != 404:  # já não estava registrada = removida
            raise

ENDPOINT_LLM = SUPABASE_URL + "/functions/v1/configure-llm-provider"
CONFIG = "/root/.openclaw/openclaw.json"

def escrever_config(cfg):
    tmp = CONFIG + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    os.replace(tmp, CONFIG)

def descobrir_modelos_local(pid):
    """Descoberta SEM a chave viajar: usa a credencial que já mora no
    openclaw.json e pergunta à API do provedor o que a conta enxerga."""
    cfg = json.load(open(CONFIG))
    node = cfg.get("models", {}).get("providers", {}).get(pid)
    if not node: raise RuntimeError(f"provedor {pid} não existe no gateway")
    chave = node.get("apiKey") or ""
    base = (node.get("baseUrl") or "").rstrip("/")
    api = node.get("api") or "openai-completions"
    if not chave or not base: raise RuntimeError(f"provedor {pid} sem chave/baseUrl no gateway")

    if api == "google-generative-ai":
        url = f"{base}/models?key={chave}&pageSize=100"
        req = urllib.request.Request(url)
    elif api == "anthropic-messages":
        req = urllib.request.Request(f"{base}/models?limit=100", headers={
            "x-api-key": chave, "anthropic-version": "2023-06-01"})
    else:  # openai-compat
        req = urllib.request.Request(f"{base}/models", headers={"Authorization": f"Bearer {chave}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        corpo = json.loads(r.read().decode())

    modelos = []
    if api == "google-generative-ai":
        for m in corpo.get("models", []):
            if "generateContent" in (m.get("supportedGenerationMethods") or []):
                modelos.append({"id": m.get("name", "").replace("models/", ""), "name": m.get("displayName") or m.get("name")})
    else:
        import re
        ruim = re.compile(r"embed|whisper|tts|audio|dall-e|image|moderation|realtime|transcribe|guard", re.I)
        for m in corpo.get("data", []):
            mid = m.get("id") or ""
            if mid and not ruim.search(mid):
                modelos.append({"id": mid, "name": m.get("display_name") or mid})
    return {"models": modelos}

def aplicar_op_llm(op):
    """Provedor de LLM: o gateway REVERTE hot-add via config.patch (bisseção
    01/08 — o reload crasha). Aqui é o caminho que funciona: escrever o
    arquivo e reiniciar; o gateway nasce com a config pronta, como no setup."""
    cfg = json.load(open(CONFIG))
    provs = cfg.setdefault("models", {}).setdefault("providers", {})
    catalogo = cfg.setdefault("agents", {}).setdefault("defaults", {}).setdefault("models", {})
    pid = op["provider_id"]
    payload = op.get("payload") or {}
    if op["op"] == "upsert_provider":
        provs[pid] = payload.get("node") or {}
        for k, v in (payload.get("catalogo") or {}).items():
            catalogo[k] = v if v is not None else {}
        # entradas velhas deste provedor saem do catálogo — id fantasma no
        # seletor derruba turno com timeout (caso real de 01/08)
        for k in (payload.get("catalogo_remover") or []):
            catalogo.pop(k, None)
    elif op["op"] == "remove_provider":
        provs.pop(pid, None)
        for k in (payload.get("catalogo_remover") or []):
            catalogo.pop(k, None)
    escrever_config(cfg)

def ciclo_llm():
    try:
        resp = chamar(ENDPOINT_LLM, "POST", {"action": "ops_pull"}, SECRET)
    except urllib.error.HTTPError as e:
        # Função antiga no ar (sem ops_pull/gate de sync): espera em silêncio.
        if e.code in (400, 401, 403, 404): return False
        raise
    ops = resp.get("ops") or []
    if not ops: return False
    resultados, mudou = [], False
    for op in ops:
        try:
            if op["op"] == "discover_models":
                resultado = descobrir_modelos_local(op["provider_id"])
                resultados.append({"id": op["id"], "ok": True, "result": resultado})
                print(f"[skill-sync] LLM descoberta {op['provider_id']}: {len(resultado['models'])} modelos")
                continue
            aplicar_op_llm(op)
            mudou = True
            resultados.append({"id": op["id"], "ok": True})
            print(f"[skill-sync] LLM {op['op']} {op['provider_id']} aplicado")
        except Exception as e:
            resultados.append({"id": op["id"], "ok": False, "error": str(e)[:400]})
            print(f"[skill-sync] LLM ERRO {op.get('provider_id')}: {e}")
    if resultados:
        chamar(ENDPOINT_LLM, "POST", {"action": "ops_report", "results": resultados}, SECRET)
    return mudou

def ciclo():
    # LLM primeiro: é raro, e quando existe o usuário está olhando a tela.
    try:
        if ciclo_llm():
            subprocess.Popen(["openclaw", "gateway", "restart", "--safe"],
                             start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print("[skill-sync] gateway reiniciado para carregar provedor de LLM")
    except Exception as e:
        print(f"[skill-sync] ciclo LLM falhou (segue): {e}")
    try:
        resp = chamar(ENDPOINT, "POST", {"action": "pull", "waitSeconds": ESPERA_SERVIDOR},
                      SECRET, timeout=ESPERA_SERVIDOR + 15)
    except urllib.error.HTTPError as e:
        # Antes do deploy da função nova, pull é ação desconhecida: espera quieto.
        if e.code in (400, 404): return
        raise
    tarefas = resp.get("tasks") or []
    if not tarefas: return
    tok = token_gateway()
    resultados, precisa_restart = [], False
    for t in tarefas:
        try:
            if t["op"] == "remove":
                remover(t, tok)
                resultados.append({"skill_id": t["skill_id"], "agent_id": t["agent_id"], "status": "removed"})
                print(f"[skill-sync] removida {t['slug']} de {t['agent_id']}")
            else:
                if instalar(t, tok): precisa_restart = True
                resultados.append({"skill_id": t["skill_id"], "agent_id": t["agent_id"], "status": "synced"})
                print(f"[skill-sync] instalada {t['slug']} em {t['agent_id']}")
        except Exception as e:
            resultados.append({"skill_id": t["skill_id"], "agent_id": t["agent_id"],
                               "status": "error", "error": str(e)[:400]})
            print(f"[skill-sync] ERRO {t.get('slug')} -> {t['agent_id']}: {e}")
    if precisa_restart:
        # Mesmo comando que a skills-api usa para ativar skill de git.
        subprocess.Popen(["openclaw", "gateway", "restart", "--safe"],
                         start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("[skill-sync] gateway reativado para carregar arquivos novos")
    if resultados:
        chamar(ENDPOINT, "POST", {"action": "report", "results": resultados}, SECRET)

print(f"[skill-sync] no ar — long-poll de {ESPERA_SERVIDOR}s em {ENDPOINT}")
while True:
    try:
        ciclo()
    except Exception as e:
        print(f"[skill-sync] ciclo falhou (segue tentando): {e}")
    time.sleep(INTERVALO)
PYEOF
chmod 755 "$DIR/sync.py"

cat > /etc/systemd/system/dnos-skill-sync.service <<UNIT
[Unit]
Description=dn.os Skill Sync — puxa intenções de skill e aplica na VPS
After=network-online.target dnia-skills-api.service

[Service]
Environment=DNOS_SUPABASE_URL=$SUPABASE_URL
# Sem isto o print do Python fica bufferizado e o journal parece morto.
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 $DIR/sync.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now dnos-skill-sync.service
echo "[OK] Sincronizador de skills instalado e rodando (journalctl -u dnos-skill-sync -f)"
