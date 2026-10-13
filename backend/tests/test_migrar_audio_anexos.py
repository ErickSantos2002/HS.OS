"""Os áudios de canal gravados antes de 13/10/2026 viram anexo privado.

Eram URLs públicas do bucket `audio-messages`. O script copia cada um para
`anexos`, cria a linha em `public.anexos` e troca o `audio_url` por
`anexo:<id>`. A parte pura é ler a URL antiga — e recusar o que não for dela,
porque o caminho vira chave no R2.
"""
import importlib.util
from pathlib import Path

_s = importlib.util.spec_from_file_location(
    "migrar_audio_anexos", Path(__file__).parent.parent / "scripts" / "migrar-audio-anexos.py")
_m = importlib.util.module_from_spec(_s)
_s.loader.exec_module(_m)


def test_le_o_caminho_da_url_publica_antiga():
    url = ("https://hsosapi.healthsafetytech.com/storage/audio-messages/"
           "3bc49948-49f5-4ddc-98d0-c4b94648dc5d/e60453f7-2696-43fa-8b9d-c10e24b7071c.webm")
    assert _m.caminho_antigo(url) == ("3bc49948-49f5-4ddc-98d0-c4b94648dc5d/"
                                      "e60453f7-2696-43fa-8b9d-c10e24b7071c.webm")


def test_ja_migrado_ou_outro_bucket_nao_e_lido():
    assert _m.caminho_antigo("anexo:6f1c2d3e-0000-4000-8000-000000000001") is None
    assert _m.caminho_antigo("https://x/storage/agent-files/a/b.webm") is None
    assert _m.caminho_antigo(None) is None


def test_travessia_e_recusada():
    assert _m.caminho_antigo("https://x/storage/audio-messages/../anexos/a.webm") is None
