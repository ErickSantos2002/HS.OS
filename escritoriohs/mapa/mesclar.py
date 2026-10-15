"""Junta o .wam recém-gerado com o que está no ar antes de enviar.

Paredes, salas, áreas e placas são do gerador. Os OBJETOS (móveis, plantas…)
viram do Erick depois de publicados: o gerador cria cada um uma vez só e anota
o id em `publicados.json`. Nos envios seguintes:
  - objeto que está no ar fica como está (se o Erick moveu, continua movido);
  - objeto já publicado que sumiu do ar foi apagado pelo Erick — não volta;
  - objeto novo do gerador (sala nova, peça nova) é acrescentado.
Do ar também se preservam o `lastCommandId` (clientes conectados sincronizam
por ele) e o dono das áreas pessoais (sub-projeto B).

⚠️ Sem conseguir ler o mapa do ar NÃO se envia nada, se já houve publicação:
subir sem os objetos do ar apagaria tudo, e o registro impediria recriá-los.

Uso: python3 mesclar.py saida/hs.wam <hs.wam do ar | -> publicados.json [renomear.json]
     (grava publicados.json.novo; o enviar.sh o promove só se o envio der 200)
"""
import json, sys

class EnvioInseguro(Exception):
    pass

def _donos(areas):
    """{(id da área, id da propriedade): (ownerId, allowedTags)} das áreas pessoais."""
    return {(a["id"], p["id"]): (p.get("ownerId"), p.get("allowedTags"))
            for a in areas or [] if isinstance(a, dict) for p in a.get("properties", [])
            if p.get("type") == "personalAreaPropertyData"}

def mesclar(novo, no_ar, publicados, renomear=None):
    renomear = renomear or {}
    if no_ar is None and publicados:
        raise EnvioInseguro("não deu para ler o mapa do ar, e já há objetos publicados — "
                            "enviar agora apagaria todos")
    # ids antigos (por posição na lista) → ids novos (por peça e ocorrência)
    publicados = {renomear.get(i, i) for i in publicados}
    do_ar = {renomear.get(k, k): v for k, v in ((no_ar or {}).get("entities") or {}).items()}

    gerados = novo.get("entities") or {}
    entidades = dict(do_ar)
    for k, v in gerados.items():
        if k not in publicados:
            entidades[k] = v

    r = json.loads(json.dumps(novo))
    r["entities"] = entidades
    if no_ar and no_ar.get("lastCommandId"):
        r["lastCommandId"] = no_ar["lastCommandId"]
    donos = _donos((no_ar or {}).get("areas"))
    for a in r.get("areas", []):
        if not isinstance(a, dict):
            continue
        for p in a.get("properties", []):
            chave = (a["id"], p.get("id"))
            if p.get("type") == "personalAreaPropertyData" and chave in donos:
                p["ownerId"], tags = donos[chave]
                if tags is not None:
                    p["allowedTags"] = tags
    return r, set(publicados) | set(gerados)

def _ler_json(caminho, o_que):
    try:
        return json.load(open(caminho))
    except OSError:
        return None
    except ValueError:
        sys.exit(f"ERRO: {o_que} não é JSON válido ({caminho}) — envio interrompido")

def principal(argv):
    caminho, origem, caminho_pub = argv[0], argv[1], argv[2]
    renomear = _ler_json(argv[3], "o mapa de ids") if len(argv) > 3 else {}
    novo = json.load(open(caminho))
    no_ar = None if origem == "-" else _ler_json(origem, "o mapa baixado do ar")
    if origem != "-" and no_ar is None:
        sys.exit(f"ERRO: não deu para ler {origem} — envio interrompido")
    publicados = _ler_json(caminho_pub, "o registro de publicados")
    try:
        wam, pub = mesclar(novo, no_ar, set(publicados or []), renomear or {})
    except EnvioInseguro as e:
        sys.exit(f"ERRO: {e}")
    json.dump(wam, open(caminho, "w"), sort_keys=True, ensure_ascii=False, indent=1)
    json.dump(sorted(pub), open(caminho_pub + ".novo", "w"), indent=0)
    print(f"objetos no ar mantidos: {len((no_ar or {}).get('entities') or {})} · "
          f"total: {len(wam['entities'])}")

if __name__ == "__main__":
    principal(sys.argv[1:])
