"""Planta do mapa: cômodos em blocos de 32 px, com paredes por fora e porta."""
import json
from dataclasses import dataclass

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

def carregar(caminho):
    d = json.load(open(caminho, encoding="utf-8"))
    return Planta(d["largura"], d["altura"], tuple(Comodo(**c) for c in d["comodos"]),
                  tuple(d.get("decoracao", [])))
