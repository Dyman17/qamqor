"""Проверка STL: замкнутость (каждое ребро у 2 граней), габариты, объём, масса.
Только стандартная библиотека + numpy. Запуск: python check_stl.py stl/*.stl
"""
import struct
import sys
from collections import Counter

import numpy as np

DENSITY = {"PETG": 1.27, "ASA": 1.07}


def load(path):
    data = open(path, "rb").read()
    if data[:5] == b"solid" and b"facet" in data[:400]:
        v = [list(map(float, ln.split()[1:4])) for ln in data.decode().splitlines() if ln.strip().startswith("vertex")]
        return np.array(v).reshape(-1, 3, 3)
    n = struct.unpack("<I", data[80:84])[0]
    arr = np.frombuffer(data[84:84 + n * 50], dtype=np.dtype([("n", "<3f4"), ("v", "<9f4"), ("a", "<u2")]))
    return arr["v"].reshape(-1, 3, 3).astype(float)


def check(path):
    t = load(path)
    if len(t) == 0:
        return f"{path}: ПУСТО (0 треугольников)"
    keys = np.round(t, 4)
    edges = Counter()
    for tri in keys:
        p = [tuple(x) for x in tri]
        for a, b in ((0, 1), (1, 2), (2, 0)):
            edges[tuple(sorted((p[a], p[b])))] += 1
    bad = sum(1 for c in edges.values() if c != 2)
    vol = np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6.0
    lo, hi = t.reshape(-1, 3).min(0), t.reshape(-1, 3).max(0)
    cm3 = vol / 1000
    mass = ", ".join(f"{k} {cm3 * d:.0f} г" for k, d in DENSITY.items())
    return (f"{path}: треугольников {len(t)}, рёбер не по 2 граням: {bad}, "
            f"габарит {hi[0]-lo[0]:.1f}×{hi[1]-lo[1]:.1f}×{hi[2]-lo[2]:.1f} мм, "
            f"объём {cm3:.1f} см³ (сплошная масса: {mass})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for p in sys.argv[1:]:
        print(check(p))
