"""Planta do mapa: cômodos em blocos de 32 px, com paredes por fora e porta."""
import json
from dataclasses import dataclass

TEM_DONO = ("sala", "diretoria")

@dataclass(frozen=True)
class Comodo:
    nome: str
    tipo: str
    x: int
    y: int
    w: int
    h: int
    porta: str | None = None
    placa: str | None = None
    # E-mail do dono (sala e diretoria). Vira o `ownerId` da área pessoal, em
    # minúsculas: é o `userUuid` que a Admin API do HS.OS devolve.
    # ⚠️ Dono e pessoa NÃO vêm do planta.json (o repositório é público): vêm de
    # ~/escritoriohs-donos.json, mesclado em `carregar` — ver README.
    dono: str | None = None
    # Nome na segunda faixa da placa, embaixo do setor.
    pessoa: str | None = None
    # Deslocamento da placa na parede, em blocos (a da Diretoria ficava atrás
    # da estante grande).
    placa_dx: int = 0

    def __post_init__(self):
        if self.dono is None:
            return
        if self.tipo not in TEM_DONO:
            raise ValueError(f"{self.nome}: `dono` só vale em sala ou diretoria "
                             f"(este é {self.tipo}) — só elas têm área pessoal")
        if "@" not in self.dono.strip():
            raise ValueError(f"{self.nome}: `dono` tem que ser o e-mail da pessoa "
                             f"(veio {self.dono!r})")

    def interior(self):
        return (self.x + 1, self.y + 1, self.x + self.w - 2, self.y + self.h - 2)

    def contem(self, x, y):
        """Paredes inclusive."""
        return self.x <= x < self.x + self.w and self.y <= y < self.y + self.h

    def celulas_porta(self):
        if not self.porta:
            return []
        if self.porta in ("N", "S"):
            y = self.y if self.porta == "N" else self.y + self.h - 1
            meio = self.x + self.w // 2
            return [(meio - 1, y), (meio, y)]
        x = self.x if self.porta == "W" else self.x + self.w - 1
        meio = self.y + self.h // 2
        return [(x, meio), (x, meio + 1)]

@dataclass(frozen=True)
class Planta:
    largura: int
    altura: int
    comodos: tuple
    decoracao: tuple = ()

def carregar(caminho, donos=None):
    """`donos`: {nome do cômodo: {"dono": e-mail, "pessoa": nome na placa}},
    lido de fora do repositório. Cômodo que não existe na planta para com erro —
    um nome digitado errado deixaria a sala sem dono sem ninguém perceber."""
    d = json.load(open(caminho, encoding="utf-8"))
    comodos = [dict(c) for c in d["comodos"]]
    por_nome = {c["nome"]: c for c in comodos}
    for nome, extra in (donos or {}).items():
        if nome not in por_nome:
            raise ValueError(f"donos: não há cômodo chamado {nome!r} na planta")
        desconhecido = set(extra) - {"dono", "pessoa"}
        if desconhecido:
            raise ValueError(f"donos: {nome}: campo desconhecido {sorted(desconhecido)}")
        por_nome[nome].update(extra)
    return Planta(d["largura"], d["altura"], tuple(Comodo(**c) for c in comodos),
                  tuple(d.get("decoracao", [])))
