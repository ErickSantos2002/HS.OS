"""O papel do agente sobrevive ao ida-e-volta exportar → importar?

⚠️ **Não sobrevivia.** A exportação manda `role`, que é o campo do schema
original do dn.os. Nesta instalação ele está **vazio nos cinco agentes**: quem
carrega o papel é `specialty` (levantado em 01/09/2026, montando a War room).
A importação faz `specialty = agent.role || agent.description || "Agente
importado do HS.OS"`.

Ou seja: exportar a `nina` — que tem `role` E `description` nulos — e importar
noutra instalação dava um agente chamado "Agente importado do HS.OS" no lugar
de "Orquestradora do time". Os outros quatro degradavam para a descrição longa.

Não é defeito da portagem: a edge original mandava `role` porque lá o `role`
era o campo vivo. O schema mudou embaixo, e a exportação continuou fiel a um
campo que morreu.
"""
from app.routers.agent_export import _bloco_agente


def test_o_papel_vem_do_role_quando_ele_existe():
    bloco = _bloco_agente({"agent_id": "x", "name": "X", "role": "Analista",
                           "specialty": "outra coisa"}, "x")
    assert bloco["role"] == "Analista"


def test_sem_role_o_papel_vem_do_specialty():
    """É o campo que esta instalação usa de verdade."""
    bloco = _bloco_agente({"agent_id": "nina", "name": "Nina", "role": None,
                           "specialty": "Orquestradora do time"}, "nina")
    assert bloco["role"] == "Orquestradora do time"


def test_sem_nenhum_dos_dois_nao_inventa():
    bloco = _bloco_agente({"agent_id": "x", "name": "X"}, "x")
    assert bloco["role"] is None


def test_agente_sem_linha_no_banco_ainda_exporta_com_o_id():
    """Exportar tem que funcionar para agente que só existe no gateway."""
    bloco = _bloco_agente({}, "sozinho")
    assert bloco["agent_id"] == "sozinho" and bloco["name"] == "sozinho"
