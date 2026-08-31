"""Descobrir modelos sem a chave no corpo enfileirava para ninguém.

⚠️ **É o mesmo defeito que o próprio `llm.py` já registra como corrigido — em
outro caminho.** O docstring da remoção de provedor diz, com estas palavras:

    Antes daqui saía uma op para `llm_provider_ops` esperando um sincronizador
    que não existe — a remoção ficava `pending` para sempre e a tela dizia que
    ia confirmar. Agora o que dá para fazer é feito na hora, e o que não dá é
    dito.

A descoberta ficou para trás. Com `api_key` no corpo ela pergunta ao provedor e
funciona; sem, enfileirava um `discover_models` que nenhum consumidor lê — o
sincronizador da VPS nunca existiu, e a `llm_provider_ops` tem zero linhas desde
sempre. O admin clicava, recebia `queued: true` e o `/descobrir/{op_id}` nunca
respondia.

⚠️ **Ler a chave do gateway para perguntar na hora foi descartado**, e não por
preguiça: o `CLAUDE.md` registra que o cofre do agente (`auth_profile_store`)
**vence** o `models.providers`, então a chave da config pode não ser a que
funciona. Perguntar com a credencial errada devolveria "o provedor recusou a
chave" para uma chave que está certa — pior que dizer que não dá.
"""
from app.routers import llm


def test_sem_chave_nao_enfileira():
    r = llm._descoberta_sem_chave("deepseek")
    assert r.get("queued") is not True
    assert r.get("ok") is False


def test_sem_chave_diz_o_que_fazer():
    """Mensagem de erro que não diz a saída é só um beco mais educado."""
    r = llm._descoberta_sem_chave("deepseek")
    assert "chave" in r["error"].lower()


def test_a_mensagem_nomeia_o_provedor():
    assert "deepseek" in llm._descoberta_sem_chave("deepseek")["error"].lower()


def test_nada_mais_escreve_na_fila_morta():
    """Se isto falhar, alguém reintroduziu o produtor e a fila volta a crescer
    sem consumidor."""
    fonte = (llm.__file__ or "")
    with open(fonte, encoding="utf-8") as f:
        texto = f.read()
    assert "INSERT INTO public.llm_provider_ops" not in texto
