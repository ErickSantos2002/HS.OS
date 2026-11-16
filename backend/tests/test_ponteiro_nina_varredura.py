"""O ponteiro da Nina para a varredura (`scripts/ponteiro-nina-varredura.py`).

⚠️ O `AGENTS.md` da `nina` vive a ~500 caracteres do teto de 20.000 e o gateway
trunca em silêncio o que passar — e o que se perde é o fim. Por isso o script só
insere se couber, é idempotente e nunca escreve dentro dos blocos gerados
(`hsos:empresa`, `hsos:roster`), que são reescritos inteiros pelo backend.
"""
import importlib.util
import pathlib

_CAMINHO = pathlib.Path(__file__).parent.parent / "scripts" / "ponteiro-nina-varredura.py"
_spec = importlib.util.spec_from_file_location("ponteiro_nina", _CAMINHO)
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

IN_E, FIM_E = "<!-- hsos:empresa:inicio -->", "<!-- hsos:empresa:fim -->"
IN_R, FIM_R = "<!-- hsos:roster:inicio -->", "<!-- hsos:roster:fim -->"


def test_insere_antes_do_primeiro_bloco_gerado():
    atual = f"# AGENTS\n\ntexto\n\n{IN_E}\nempresa\n{FIM_E}\n\n{IN_R}\nroster\n{FIM_R}\n"
    novo = m.inserir_ponteiro(atual)
    assert m.PONTEIRO in novo
    assert novo.index(m.PONTEIRO) < novo.index(IN_E)
    assert novo[novo.index(IN_E):] == atual[atual.index(IN_E):]


def test_sem_bloco_acrescenta_no_fim():
    novo = m.inserir_ponteiro("# AGENTS\n\ntexto\n")
    assert novo.rstrip().endswith(m.PONTEIRO)


def test_idempotente():
    uma = m.inserir_ponteiro("# AGENTS\n\ntexto\n")
    assert m.inserir_ponteiro(uma) is None


def test_texto_do_ponteiro_e_o_do_brief():
    assert m.PONTEIRO == ("Pendências de alguém ou da equipe: `pendencias_da_equipe`; "
                          "resumo velho: `pedir_varredura`.")
