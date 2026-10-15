"""Móveis como OBJETOS do editor (pedido do Erick, 15/10/2026): ele precisa
mover e apagar pelo navegador. Objeto com id de coleção errado não aparece —
sem erro nenhum, só um buraco na sala."""
import json, os, tempfile
import gerar, modelo, objetos, mesclar

P = modelo.carregar("planta.json")

def test_toda_peca_existe_na_colecao():
    for nome in objetos.PECAS:
        assert objetos.item(nome)["imagePath"], nome
        assert os.path.exists(objetos.caminho_imagem(nome)), nome

def test_prefab_id_no_formato_do_wa():
    """`${collectionName}:${name}:${color}:${direction}` —
    libs/map-editor/src/Migrations/EntitiesFileMigration.ts do WA."""
    assert objetos.prefab_id("mesa") == "basic furniture:Basic Wood Table:orange:Down"

def test_colisao_da_mesa_vem_da_grade_da_colecao():
    # mesa 64×96 com grade [[0,0],[1,1],[1,1]]: só as duas linhas de baixo colidem
    assert objetos.celulas_colisao("mesa", 4 * 32, 9 * 32) == {(4, 10), (5, 10), (4, 11), (5, 11)}
    assert objetos.celulas_colisao("cadeira_cima", 0, 0) == set()

def _wam():
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        return json.load(open(os.path.join(d, "hs.wam")))

def test_cada_sala_tem_mesa_cadeira_e_monitor_como_objeto():
    ents = _wam()["entities"]
    for c in P.comodos:
        if c.tipo != "sala":
            continue
        x1, y1, x2, y2 = c.interior()
        dentro = [e for e in ents.values()
                  if x1 * 32 <= e["x"] < (x2 + 1) * 32 and (y1 - 1) * 32 <= e["y"] < (y2 + 1) * 32]
        ids = {e["prefabRef"]["id"] for e in dentro}
        for peca in ("mesa", "cadeira_cima", "monitor"):
            assert objetos.prefab_id(peca) in ids, (c.nome, peca)

def test_ids_dos_objetos_sao_estaveis():
    assert _wam()["entities"].keys() == _wam()["entities"].keys()

def test_mescla_respeita_o_que_o_erick_mexeu():
    novo = {"entities": {"g1": {"x": 0}, "g2": {"x": 32}, "g3": {"x": 64}}, "areas": [1]}
    no_ar = {"entities": {"g1": {"x": 999}, "e-erick": {"x": 5}}, "areas": [0]}
    publicados = {"g1", "g2"}               # g2 já foi publicado e o Erick apagou
    wam, pub = mesclar.mesclar(novo, no_ar, publicados)
    assert wam["entities"] == {"g1": {"x": 999}, "e-erick": {"x": 5}, "g3": {"x": 64}}
    assert wam["areas"] == [1]
    assert pub == {"g1", "g2", "g3"}

def test_primeiro_envio_publica_tudo():
    novo = {"entities": {"g1": {"x": 0}}, "areas": []}
    wam, pub = mesclar.mesclar(novo, None, set())
    assert wam["entities"] == {"g1": {"x": 0}} and pub == {"g1"}
