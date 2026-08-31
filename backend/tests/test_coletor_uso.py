"""O coletor parou de registrar consumo em 24/08/2026. Ver item 8 do
`docs/ROADMAP-AGENTES-2026-08-31.md`.

`session_key` é fixo por (agente, usuário) — `agent:iris:hsos-<uuid>`. O botão
"Limpar" apaga a sessão no gateway, que recomeça do zero com a MESMA chave. O
acumulado do nosso lado não recomeça, e virou marca d'água: `delta` negativo
para sempre, `continue` para sempre.

Medido: cada agente do CEO parou de registrar no primeiro reset dele —
atlas 20/08, iris 24/08, nina 23/08 — e nunca voltou.
"""
from app import coletor_uso


def test_primeira_vez_registra_tudo():
    assert coletor_uso._delta(1000, None) == 1000


def test_sessao_que_andou_registra_so_a_diferenca():
    assert coletor_uso._delta(1500, 1000) == 500


def test_sessao_parada_nao_registra_nada():
    assert coletor_uso._delta(1000, 1000) == 0


def test_sessao_recriada_apos_reset_volta_a_contar():
    """O gateway zerou e recomeçou: os 300 tokens de agora são todos novos.

    Antes isto devolvia -4.700 e o coletor pulava — para sempre, porque o
    acumulado antigo nunca mais era alcançado.
    """
    assert coletor_uso._delta(300, 5000) == 300


def test_reset_nao_deixa_marca_dagua_no_ciclo_seguinte():
    """O ciclo depois do reset compara com o retrato novo, não com o antigo.

    É aqui que a correção ingênua (`if total < ja: delta = total`) ainda
    falharia: somando à marca d'água, o ciclo seguinte volta a ficar negativo.
    """
    assert coletor_uso._delta(300, 5000) == 300   # ciclo do reset
    assert coletor_uso._delta(800, 300) == 500    # o seguinte, já normal
