"""Dono de sala vindo da planta (sub-projeto B, spec 2026-10-15-escritoriohs-b).

O `ownerId` da área pessoal é o `userUuid` que a Admin API do HS.OS devolve, e
ele é o e-mail em minúsculas. Um dono escrito com maiúscula na planta seria
outra pessoa para o WA: a sala ficaria trancada para o próprio dono.

A precedência no envio mudou: antes o ar sempre vencia; agora a planta com dono
vence, e a planta SEM dono preserva o que foi atribuído pelo navegador."""
import json
import pytest
import gerar, mesclar, modelo

def _planta_com(tmp_path, alterar):
    d = json.load(open("planta.json", encoding="utf-8"))
    alterar(d["comodos"])
    caminho = tmp_path / "planta.json"
    caminho.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return str(caminho)

def _primeira(comodos, tipo):
    return next(c for c in comodos if c["tipo"] == tipo)

def _pessoal(wam, nome):
    area = next(a for a in wam["areas"] if a["name"] == nome)
    return next(p for p in area["properties"] if p["type"] == "personalAreaPropertyData")

def test_planta_do_repositorio_nao_tem_dono():
    """Quem é dono de qual sala é dado do Erick: nenhuma sala ganha dono inventado."""
    d = json.load(open("planta.json", encoding="utf-8"))
    assert not any("dono" in c for c in d["comodos"])

def test_dono_vira_owner_id_em_minusculas(tmp_path):
    nome = {}
    def alterar(cs):
        c = _primeira(cs, "sala"); c["dono"] = "  Fulano.Silva@HealthSafetyTech.com "; nome["v"] = c["nome"]
    gerar.gerar(_planta_com(tmp_path, alterar), str(tmp_path / "saida"))
    wam = json.load(open(tmp_path / "saida" / "hs.wam"))
    assert _pessoal(wam, nome["v"])["ownerId"] == "fulano.silva@healthsafetytech.com"

def test_sala_sem_dono_continua_com_owner_id_nulo(tmp_path):
    gerar.gerar("planta.json", str(tmp_path))
    wam = json.load(open(tmp_path / "hs.wam"))
    props = [p for a in wam["areas"] for p in a["properties"] if p["type"] == "personalAreaPropertyData"]
    assert props and all(p["ownerId"] is None for p in props)

@pytest.mark.parametrize("valor", ["fulano", "", "   "])
def test_dono_sem_arroba_e_recusado_com_o_nome_da_sala(tmp_path, valor):
    nome = {}
    def alterar(cs):
        c = _primeira(cs, "sala"); c["dono"] = valor; nome["v"] = c["nome"]
    with pytest.raises(ValueError) as e:
        modelo.carregar(_planta_com(tmp_path, alterar))
    assert nome["v"] in str(e.value)

def test_dono_fora_de_sala_e_recusado(tmp_path):
    """Só `sala` tem área pessoal; dono na recepção não iria a lugar nenhum e
    daria a impressão de que a atribuição foi feita."""
    def alterar(cs):
        _primeira(cs, "recepcao")["dono"] = "a@healthsafetytech.com"
    with pytest.raises(ValueError, match="recepcao|Recep"):
        modelo.carregar(_planta_com(tmp_path, alterar))

# --- mesclar: precedência ---------------------------------------------------
def _wam(dono, tags=None):
    return {"entities": {}, "areas": [{"id": "a1", "properties": [{
        "id": "p1", "type": "personalAreaPropertyData", "accessClaimMode": "static",
        "allowedTags": tags if tags is not None else [], "ownerId": dono}]}]}

def test_planta_com_dono_vence_o_ar():
    wam, _ = mesclar.mesclar(_wam("a@x"), _wam("b@x", ["vip"]), set())
    p = wam["areas"][0]["properties"][0]
    assert p["ownerId"] == "a@x" and p["allowedTags"] == []

def test_planta_sem_dono_preserva_o_ar():
    wam, _ = mesclar.mesclar(_wam(None), _wam("b@x", ["vip"]), set())
    p = wam["areas"][0]["properties"][0]
    assert p["ownerId"] == "b@x" and p["allowedTags"] == ["vip"]

def test_area_que_nao_esta_no_ar_fica_como_gerada():
    no_ar = {"entities": {}, "areas": []}
    wam, _ = mesclar.mesclar(_wam("a@x"), no_ar, set())
    assert wam["areas"][0]["properties"][0]["ownerId"] == "a@x"
    wam, _ = mesclar.mesclar(_wam(None), no_ar, set())
    assert wam["areas"][0]["properties"][0]["ownerId"] is None
