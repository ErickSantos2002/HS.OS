"""Script do mapa que leva o status do perfil do HS.OS ao WA (sub-projeto B).

O WA carrega o que estiver na propriedade `script` do mapa (relativa ao .tmj)
num iframe escondido. Arquivo que não vai no zip do envio é apagado do
map-storage — o upload limpa a pasta antes de gravar — e o script some sem erro
visível. Por isso os três elos (propriedade, cópia em saida/, zip) têm teste."""
import json, os, shutil, subprocess, tempfile
import pytest
import gerar

def _gerado():
    d = tempfile.mkdtemp()
    gerar.gerar("planta.json", d)
    return d

def test_tmj_aponta_o_script():
    d = _gerado()
    try:
        m = json.load(open(os.path.join(d, "hs.tmj")))
    finally:
        shutil.rmtree(d)
    props = {p["name"]: p for p in m["properties"]}
    assert props["script"]["type"] == "string" and props["script"]["value"] == "escritorio.js"

def test_script_e_copiado_para_a_saida():
    d = _gerado()
    try:
        copia = open(os.path.join(d, "escritorio.js"), "rb").read()
    finally:
        shutil.rmtree(d)
    assert copia == open("script/escritorio.js", "rb").read()

def test_enviar_zipa_o_script():
    """O map-storage apaga a pasta hs/ antes de gravar o zip: o que não for no
    zip deixa de existir no ar."""
    linha = next(l for l in open("enviar.sh").read().splitlines() if "zip -qr" in l)
    assert "escritorio.js" in linha.split()

def test_script_aponta_a_api_do_hsos():
    s = open("script/escritorio.js").read()
    assert "https://hsosapi.healthsafetytech.com/escritorio/meu-status" in s

# --- comportamento, rodando o script no node com um WA falso ----------------
_PILOTO = r"""
const fs = require("fs"), vm = require("vm");
const [arquivo, cenarioJson] = process.argv.slice(2);
const cen = JSON.parse(cenarioJson);
const aplicados = [], urls = [];
let ciclo = null, i = 0;
const WA = {
  onInit: () => Promise.resolve(),
  player: {
    get userRoomToken() { if (cen.tokenLanca) throw new Error("not initialized"); return cen.token; },
    setStatus: (s) => aplicados.push(s),
  },
};
const fetch = async (url) => {
  urls.push(url);
  const r = cen.respostas[Math.min(i++, cen.respostas.length - 1)];
  if (r === "rede") throw new TypeError("Failed to fetch");
  return { status: r[0], ok: r[0] >= 200 && r[0] < 300, json: async () => ({ wa_status: r[1] }) };
};
const ctx = { WA, fetch, setInterval: (f) => { ciclo = f; return 1; }, console,
              encodeURIComponent, Promise };
vm.runInNewContext(fs.readFileSync(arquivo, "utf8"), ctx);
(async () => {
  for (let k = 0; k < 20; k++) await new Promise((ok) => setImmediate(ok));
  for (let n = 1; n < cen.ciclos; n++) {
    if (!ciclo) break;
    await ciclo();
    for (let k = 0; k < 5; k++) await new Promise((ok) => setImmediate(ok));
  }
  console.log(JSON.stringify({ aplicados, urls }));
})();
"""

def _rodar(respostas, ciclos=None, token="tok en", token_lanca=False):
    node = shutil.which("node")
    if not node:
        pytest.skip("sem node na máquina")
    cen = {"respostas": respostas, "ciclos": ciclos or len(respostas), "token": token,
           "tokenLanca": token_lanca}
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(_PILOTO)
    try:
        r = subprocess.run([node, f.name, os.path.abspath("script/escritorio.js"), json.dumps(cen)],
                           capture_output=True, text=True, timeout=20)
    finally:
        os.unlink(f.name)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])

def test_node_aceita_a_sintaxe():
    node = shutil.which("node")
    if not node:
        pytest.skip("sem node na máquina")
    r = subprocess.run([node, "--check", "script/escritorio.js"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr

def test_primeiro_online_nao_e_aplicado():
    """Aplicar ONLINE ao abrir desfaria o status que a pessoa escolheu dentro do WA."""
    assert _rodar([[200, "ONLINE"], [200, "ONLINE"]])["aplicados"] == []

def test_aplica_so_quando_muda():
    r = _rodar([[200, "ONLINE"], [200, "BUSY"], [200, "BUSY"], [200, "ONLINE"]])
    assert r["aplicados"] == ["BUSY", "ONLINE"]

def test_primeiro_status_diferente_de_online_e_aplicado():
    assert _rodar([[200, "DO_NOT_DISTURB"]])["aplicados"] == ["DO_NOT_DISTURB"]

def test_401_desiste_ate_recarregar():
    r = _rodar([[401, None], [200, "BUSY"], [200, "BUSY"]])
    assert r["aplicados"] == [] and len(r["urls"]) == 1

def test_erro_de_servidor_e_de_rede_tentam_de_novo():
    r = _rodar([[502, None], "rede", [200, "BUSY"]])
    assert r["aplicados"] == ["BUSY"] and len(r["urls"]) == 3

def test_token_vai_codificado_na_query():
    url = _rodar([[200, "ONLINE"]], token="a+b/c=")["urls"][0]
    assert url.endswith("?t=a%2Bb%2Fc%3D")

def test_sem_token_nao_chama_o_hsos():
    """Sem a Admin API (volta atrás do B) o WA não dá token: o script fica quieto."""
    assert _rodar([[200, "BUSY"]], token="")["urls"] == []

def test_getter_do_token_que_lanca_nao_derruba_o_script():
    """No WA v1.33.11 `WA.player.userRoomToken` LANÇA quando o token é
    `undefined` — é o que o play manda quando a admin API não devolve token
    (LocalAdmin). O script desiste em silêncio em vez de estourar no onInit."""
    assert _rodar([[200, "BUSY"]], token_lanca=True)["urls"] == []
