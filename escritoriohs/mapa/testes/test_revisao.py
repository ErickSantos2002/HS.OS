"""Achados da revisão final (15/10/2026). Cada teste tranca um jeito de perder
o arranjo que o Erick fez no navegador."""
import json, os, tempfile
import pytest
import gerar, modelo, mesclar, objetos, blocos

P = modelo.carregar("planta.json")

# --- Critical: falha ao ler o mapa do ar apagava os 303 móveis -------------
def test_sem_mapa_do_ar_mas_com_publicados_aborta():
    """`curl` falhou (5xx, timeout) → no_ar=None. Com publicados não vazio isso
    subiria um hs.wam sem nenhum objeto e o registro impediria recriá-los."""
    with pytest.raises(mesclar.EnvioInseguro):
        mesclar.mesclar({"entities": {"g1": {}}}, None, {"g1"})

def test_cli_aborta_com_json_do_ar_invalido(tmp_path):
    (tmp_path / "hs.wam").write_text(json.dumps({"entities": {"g1": {}}, "areas": []}))
    (tmp_path / "no-ar.wam").write_text("<html>502 Bad Gateway</html>")
    (tmp_path / "publicados.json").write_text('["g1"]')
    with pytest.raises(SystemExit):
        mesclar.principal([str(tmp_path / "hs.wam"), str(tmp_path / "no-ar.wam"), str(tmp_path / "publicados.json")])

def test_cli_aborta_com_registro_corrompido(tmp_path):
    (tmp_path / "hs.wam").write_text(json.dumps({"entities": {}, "areas": []}))
    (tmp_path / "publicados.json").write_text("{quebrado")
    with pytest.raises(SystemExit):
        mesclar.principal([str(tmp_path / "hs.wam"), "-", str(tmp_path / "publicados.json")])

def test_enviar_so_aceita_mapa_ausente_com_404():
    s = open("enviar.sh").read()
    assert "404" in s and "curl -sf \"$BASE/hs/hs.wam\"" not in s

# --- Important: colisão de objeto na camada do tmj virava parede invisível --
def test_colisao_de_objeto_nao_vai_para_a_camada_do_mapa():
    """O WA aplica a collisionGrid da entidade onde ela ESTÁ. Pintada no tmj, a
    mesa movida colidia no lugar novo e no antigo."""
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        m = json.load(open(os.path.join(d, "hs.tmj")))
    camada = next(l for l in m["layers"] if l["name"] == "colisao")["data"]
    W = P.largura
    for _, peca, x, y, _ in gerar.objetos_do_mapa(P):
        for cx, cy in objetos.celulas_colisao(peca, x, y):
            assert camada[cy * W + cx] == 0 or (cx, cy) in gerar.grade(P)["fixo"], (peca, cx, cy)

# --- Important: id por posição duplicava a última peça ---------------------
def test_inserir_peca_no_meio_nao_muda_id_das_outras():
    antes = {(r, p): i for i, p, _, _, r in gerar.objetos_do_mapa(P)}
    original = gerar.OBJETOS_POR_TIPO["sala"]
    try:
        gerar.OBJETOS_POR_TIPO["sala"] = [original[0], ("livros", lambda a: (a[0] + 3, a[1]))] + original[1:]
        depois = {(r, p): i for i, p, _, _, r in gerar.objetos_do_mapa(P)}
    finally:
        gerar.OBJETOS_POR_TIPO["sala"] = original
    for chave, oid in antes.items():
        assert depois[chave] == oid, chave

def test_ids_antigos_por_posicao_sao_migrados():
    """Os 303 objetos já no ar usam o id antigo (cômodo + índice). A mescla os
    renomeia para o id novo, em vez de criar uma segunda cópia de cada um."""
    novo = {"entities": {"novo1": {"x": 0}}, "areas": []}
    no_ar = {"entities": {"velho1": {"x": 77}}, "areas": []}
    wam, pub = mesclar.mesclar(novo, no_ar, {"velho1"}, renomear={"velho1": "novo1"})
    assert wam["entities"] == {"novo1": {"x": 77}} and pub == {"novo1"}

# --- Important: lastCommandId e dono de área pessoal -----------------------
def test_mescla_preserva_last_command_id_do_ar():
    wam, _ = mesclar.mesclar({"entities": {}, "areas": [], "lastCommandId": "gerador"},
                             {"entities": {}, "areas": [], "lastCommandId": "do-ar"}, set())
    assert wam["lastCommandId"] == "do-ar"

def test_mescla_preserva_dono_da_area_pessoal():
    """Sub-projeto B vai dar dono às salas; o envio não pode zerá-los."""
    prop = lambda dono: {"id": "p1", "type": "personalAreaPropertyData", "accessClaimMode": "static",
                         "allowedTags": [], "ownerId": dono}
    novo = {"entities": {}, "areas": [{"id": "a1", "properties": [prop(None)]}]}
    no_ar = {"entities": {}, "areas": [{"id": "a1", "properties": [prop("uuid-da-pessoa")]}]}
    wam, _ = mesclar.mesclar(novo, no_ar, set())
    assert wam["areas"][0]["properties"][0]["ownerId"] == "uuid-da-pessoa"

# --- Minor ------------------------------------------------------------------
def test_enviar_tem_timeout_e_tira_aspas_do_token():
    s = open("enviar.sh").read()
    assert "--max-time" in s
    linha = next(l for l in s.splitlines() if l.startswith("TOKEN="))
    assert "tr -d" in linha
