"""O ponto em que o vigia compacta, depois que a janela virou 1.000.000.

Em 31/08/2026 o `contextWindow` do DeepSeek foi corrigido de 65.536 para
1.000.000 (o `deepseek-chat` roteia para o V4 Flash desde 24/07). O vigia lê a
janela do gateway, então o limiar acompanhou sozinho — e saltou de 35.306 para
~829.600. Sessão crescendo 23× antes de compactar não é conserto: é custo e
latência por turno, já que o prompt inteiro é reenviado.

O teto existe para separar as duas coisas: acabar com o estouro em 41K (que era
o defeito) sem deixar a sessão inchar sem limite.
"""
from app import vigia_sessoes as v


def test_janela_pequena_mantem_o_calculo_de_antes():
    """O mundo até 31/08: 65.536 de janela, 24.000 de reserva."""
    assert v._ponto_de_compactar(65_536, 24_000) == int(41_536 * 0.85)


def test_janela_de_um_milhao_para_no_teto():
    """Sem teto isto daria 829.600."""
    assert v._ponto_de_compactar(1_000_000, 24_000) == v._TETO


def test_o_teto_deixa_folga_sobre_a_maior_sessao_ja_vista():
    """A maior sessão real medida foi a do atlas, 66k em 31/08."""
    assert v._TETO > 66_000 * 2


def test_reserva_maior_que_a_janela_nao_zera_o_limiar():
    """Config errada não pode virar 'compacte tudo, sempre'."""
    assert v._ponto_de_compactar(10_000, 24_000) >= 1
