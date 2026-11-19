"""Os arquivos do Midas, o agente financeiro que substitui a agente anterior.

Cada teste tranca uma lição que custou caro com o agente financeiro anterior:

- **Teto de 20.000 caracteres por arquivo** — passar dele não dá erro, o gateway
  trunca em silêncio e o que se perde é o que foi escrito por último (09/09/2026,
  `AGENTS.md` da `nina`). Por isso o teste mede COM os blocos gerados (o perfil da
  empresa chega a ~4.000 caracteres e é reescrito pela tela).
- **Skill publicada não é skill usada** — sem o ponteiro num dos sete, o agente
  respondeu faturamento do jeito antigo, 48% a mais (14/08/2026).
- **Custo parcial apresentado como total** é o anti-objetivo do Midas: todo
  número diz se é medido, provisório ou incompleto.
- **Dado financeiro em link público**: o Midas não tem `publicar_pagina`, e os
  arquivos não podem mandá-lo usar uma ferramenta que ele não tem.
"""
from app.agentes.midas import arquivos_do_midas
from app.gateway.client import excede_o_teto
from app.time_da_empresa import MARCA_FIM, MARCA_INICIO

SETE_MENOS_NADA = {"SOUL.md", "IDENTITY.md", "AGENTS.md", "USER.md", "TOOLS.md",
                   "HEARTBEAT.md", "MEMORY.md"}


def test_sao_os_sete_canonicos():
    assert set(arquivos_do_midas({})) == SETE_MENOS_NADA


def test_nenhum_arquivo_passa_do_teto():
    for nome, c in arquivos_do_midas({"empresa": "x" * 4000, "time": "y" * 4000}).items():
        assert not excede_o_teto(c), (nome, len(c))


def test_agents_aponta_as_skills():
    a = arquivos_do_midas({})["AGENTS.md"]
    for slug in ("faturamento", "contas-receber", "custos", "calendario-financeiro",
                 "funil-vendas", "funil-servicos", "pipeline-crm", "resultado-mensal",
                 "caixa-projetado", "alertas-financeiros", "margem-por-linha"):
        assert f"`{slug}`" in a, slug


def test_soul_exige_o_tipo_do_numero():
    s = arquivos_do_midas({})["SOUL.md"]
    assert all(p in s for p in ("medido", "provisório", "incompleto"))
    assert "Não afirmo o que não sei — nem número, nem fato" in s


def test_sem_link_publico_e_sem_agente_anterior():
    todos = "".join(arquivos_do_midas({}).values())
    assert "iris" not in todos.lower()
    # Ele não tem a ferramenta; o texto só pode citá-la para dizer que não tem.
    for nome, c in arquivos_do_midas({}).items():
        for linha in c.splitlines():
            if "publicar_pagina" in linha:
                assert "não" in linha.lower() or "nunca" in linha.lower(), (nome, linha)
    assert "publicar_link" not in todos


def test_nao_promete_ferramenta_que_nao_tem():
    todos = "".join(arquivos_do_midas({}).values())
    for proibida in ("sessions_send", "web_search", "web_fetch"):
        for linha in todos.splitlines():
            if proibida in linha:
                assert "não" in linha.lower(), linha


def test_resultado_mensal_so_pela_skill_e_antes_do_cmv():
    """Desde 19/11/2026 o DRE existe (`gold.dre_mensal`); a régua é dele, nunca
    faturamento menos custo montado pelo Midas. Desde o CMV (DataCore f586c3a)
    a `fecha` refaz o DRE COM o custo da mercadoria: sem isso dava falso em 142
    meses e o Midas parava em toda pergunta."""
    a = arquivos_do_midas({})["AGENTS.md"]
    assert "gold.dre_mensal" in a and "`resultado-mensal`" in a
    assert "ainda não existe" not in a
    assert "antes do custo da mercadoria" not in a
    import pathlib
    sk = (pathlib.Path(__file__).resolve().parents[1] / "skills" / "resultado-mensal"
          / "SKILL.md").read_text()
    assert "AS fecha" in sk and "b.lucro_bruto - (b.receita_liquida - b.cmv)" in sk
    assert "antes do custo da mercadoria" not in sk and "cobertura_cmv_pct < 95" in sk


def test_blocos_entram_entre_marcadores():
    a = arquivos_do_midas({"empresa": "EMP"})["AGENTS.md"]
    assert "<!-- hsos:empresa:inicio -->\nEMP\n<!-- hsos:empresa:fim -->" in a
    u = arquivos_do_midas({"time": "TIME"})["USER.md"]
    assert f"{MARCA_INICIO}\nTIME\n{MARCA_FIM}" in u


def test_bloco_que_ja_vem_com_marcadores_nao_duplica():
    """O bloco copiado do agente anterior pode vir com as marcas (o do time é
    gerado assim por `montar_bloco`); entrar com marca dupla quebraria o
    `com_bloco`, que procura a primeira ocorrência."""
    u = arquivos_do_midas({"time": f"{MARCA_INICIO}\nTIME\n{MARCA_FIM}\n"})["USER.md"]
    assert u.count(MARCA_INICIO) == 1 and u.count(MARCA_FIM) == 1
    assert f"{MARCA_INICIO}\nTIME\n{MARCA_FIM}" in u
    a = arquivos_do_midas({"empresa": "<!-- hsos:empresa:inicio -->\nEMP\n<!-- hsos:empresa:fim -->"})["AGENTS.md"]
    assert a.count("hsos:empresa:inicio") == 1


def test_sem_bloco_as_marcas_ficam_para_a_distribuicao():
    a = arquivos_do_midas({})["AGENTS.md"]
    assert "<!-- hsos:empresa:inicio -->\n<!-- hsos:empresa:fim -->" in a
    u = arquivos_do_midas({})["USER.md"]
    assert f"{MARCA_INICIO}\n{MARCA_FIM}" in u


def test_dado_financeiro_vai_ao_ceo_e_ao_erick_nominalmente():
    """O Erick (quem configura e confere) recebe dado por nome e e-mail do
    diretório; administrador em geral não — a exceção é nominal."""
    u = arquivos_do_midas({})["USER.md"]
    assert "Erick Santos" in u
    assert "ti@healthsafetytech.com" in u
    assert "não \"qualquer administrador\"" in u
    assert "avisar_administrador" in u
    # nunca abrir para qualquer administrador
    assert "qualquer administrador entra" not in u
    assert "todo administrador" not in u.lower()


def test_skills_do_midas_sem_valor_absoluto_da_empresa():
    """Repo público: as skills desta frente trazem régua e consulta, não o
    saldo da dívida nem o a pagar em aberto."""
    import pathlib
    raiz = pathlib.Path(__file__).resolve().parents[1] / "skills"
    for nome in ("contas-receber", "custos", "calendario-financeiro", "resultado-mensal",
                 "caixa-projetado", "alertas-financeiros", "margem-por-linha"):
        t = (raiz / nome / "SKILL.md").read_text()
        for numero in ("3.831.118,83", "714.387,53", "3.116.731,30", "1.678.128,10",
                       "813.795,84", "31.628.116,68"):
            assert numero not in t, (nome, numero)


def test_mes_provisorio_nao_abre_com_lucro_e_pagina_so_quando_pedirem():
    """19/11/2026: outubro (provisório, 72% de margem por falta de lançamento)
    abriu com "lucro de R$ 811 mil" e só na frase seguinte "não é lucro" — quem lê
    a primeira linha no celular leva o lucro embora. O veredito do mês não firme
    sai da CONSULTA, não da instrução. E setembro veio com um painel HTML inteiro
    para uma pergunta de um número."""
    import pathlib
    sk = (pathlib.Path(__file__).resolve().parents[1] / "skills" / "resultado-mensal"
          / "SKILL.md").read_text()
    assert "'ainda não fechou: falta despesa a lançar'" in sk
    assert "veredito_so_meses_medidos" in sk
    a = arquivos_do_midas({})["AGENTS.md"]
    assert "## Página só quando pedirem" in a


def test_caixa_projetado_e_fluxo_e_avisa_a_importacao():
    """O a pagar é lançado depois de pago: a saída é ritmo, o erro do backtest
    passou de 70%, e a importação (R$ 1,5 mi num mês) fica fora se não lançada.
    O Midas responde pelo pior ponto do acumulado PESSIMISTA, nunca pelo
    acumulado simples, e diz que é fluxo, não saldo."""
    import pathlib
    sk = (pathlib.Path(__file__).resolve().parents[1] / "skills" / "caixa-projetado"
          / "SKILL.md").read_text()
    assert "gold.caixa_semanal" in sk and "precisa_ter_em_conta_hoje" in sk
    assert "fluxo_acumulado_conservador" in sk and "importacao_media_mes" in sk
    assert "data_referencia" in sk and "positivo_de_vez_a_partir_de" in sk


def test_alertas_financeiros_tem_limite_medido():
    """Alerta que dispara todo dia ninguém lê: o de cliente inadimplente tem
    piso de R$ 10 mil por cliente (9 de 41 dias úteis em set–nov/2026) e o de
    mês em prejuízo só vale nos 5 primeiros dias úteis, quando o mês vira
    medido. Sem linha, sem seção. (Desde o fechamento mensal, o de prejuízo
    dispara no dia do fechamento, 1º útil a partir do 25, sobre o mês anterior.)"""
    import pathlib
    sk = (pathlib.Path(__file__).resolve().parents[1] / "skills" / "alertas-financeiros"
          / "SKILL.md").read_text()
    assert "HAVING sum(saldo) >= 10000" in sk and "hoje.d = df.d" in sk
    assert "Sem linha = sem seção de alerta" in sk


def test_margem_por_linha_nao_divide_o_lucro_da_tabela():
    """O `lucro_bruto` da tabela é a receita inteira menos o cmv; dividi-lo pela
    receita COM custo deu 107% no consumível e 824% no acessório na primeira
    versão. A margem sai de (receita_com_custo − cmv) ÷ receita_com_custo, e é
    sobre a receita BRUTA (a do resultado-mensal é sobre a líquida)."""
    import pathlib
    sk = (pathlib.Path(__file__).resolve().parents[1] / "skills" / "margem-por-linha"
          / "SKILL.md").read_text()
    assert "100 * (receita_com_custo - cmv) / nullif(receita_com_custo, 0)" in sk
    assert "lucro_bruto / nullif(receita_com_custo" not in sk
    assert "RECEITA BRUTA" in sk
