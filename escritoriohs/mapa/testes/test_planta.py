"""A planta é a fonte da verdade do mapa: cada erro aqui vira, lá no jogo,
uma pessoa que não acha a sala ou não consegue entrar nela."""
import modelo

P = modelo.carregar("planta.json")
SALAS = {"Financeiro 01", "Financeiro 02", "RH", "Suporte 01", "Suporte 02", "Suporte 03",
         "TI 01", "TI 02", "TI 03", "Lab 01", "Lab 02", "Lab 03", "Qualidade 01", "Qualidade 02",
         "Expedição 01", "Expedição 02", *{f"Comercial {i:02d}" for i in range(1, 13)}}

def test_as_28_salas_da_spec_estao_la():
    assert {c.nome for c in P.comodos if c.tipo == "sala"} == SALAS

def test_tudo_cabe_no_mapa():
    for c in P.comodos:
        assert c.x >= 0 and c.y >= 0 and c.x + c.w <= P.largura and c.y + c.h <= P.altura, c.nome

def test_interiores_nao_se_sobrepoem():
    """Paredes podem ser compartilhadas; o interior, nunca."""
    ocupado = {}
    for c in P.comodos:
        x1, y1, x2, y2 = c.interior()
        for x in range(x1, x2 + 1):
            for y in range(y1, y2 + 1):
                assert (x, y) not in ocupado, (c.nome, ocupado.get((x, y)))
                ocupado[(x, y)] = c.nome

def test_porta_abre_para_area_livre():
    """A célula do lado de fora da porta não pode ser interior nem parede de
    outro cômodo — senão a porta dá para a parede do vizinho."""
    for c in P.comodos:
        if not c.porta:
            continue
        for (x, y) in c.celulas_porta():
            dx, dy = {"N": (0, -1), "S": (0, 1), "W": (-1, 0), "E": (1, 0)}[c.porta]
            fora = (x + dx, y + dy)
            for outro in P.comodos:
                if outro is c:
                    continue
                assert not outro.contem(*fora), (c.nome, "porta dá para", outro.nome)

def test_placas_unicas_e_so_em_comodo_com_placa():
    placas = [c.placa for c in P.comodos if c.placa]
    assert len(placas) == len(set(placas))
    assert all(c.placa for c in P.comodos if c.tipo == "sala")
