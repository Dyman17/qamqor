"""Hinge pin + retaining cap for the Qamqor enclosure lid hinge (no dependencies).

Matches qamqor_enclosure.scad: pin_d = 3.0, pin_hole = 3.3, hinge span -80..80 (160 mm).
Pin: head D6 x 2 mm, shaft D3 x 163 mm (160 in the knuckles + 3 for the cap), chamfered tip.
The pin has a 0.3 mm flat on one side so it prints lying down without supports.
Cap: ring D6 x 3 mm, hole D2.9 (press fit / glue on the tip).
Usage: python make_hinge_pin.py  -> writes stl/qamqor_hinge_pin.stl and qamqor_hinge_cap.stl
"""
import math, os, struct

N = 48
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stl")


def write_stl(path, tris):
    key = lambda q: tuple(round(x, 5) for x in q)
    tris = [t for t in tris if len({key(q) for q in t}) == 3]  # drop zero-area tris where the flat meets the step
    with open(path, "wb") as f:
        f.write(b"Qamqor hinge part".ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for a, b, c in tris:
            u = [b[i] - a[i] for i in range(3)]
            v = [c[i] - a[i] for i in range(3)]
            n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            l = math.sqrt(sum(x*x for x in n)) or 1.0
            f.write(struct.pack("<12fH", *[x / l for x in n], *a, *b, *c, 0))


def profile(r, flat):
    """Circle of radius r in the YZ plane, clipped at z = flat (bed side)."""
    return [(r*math.cos(2*math.pi*i/N), max(r*math.sin(2*math.pi*i/N), flat)) for i in range(N)]


def loft(sections, flat):
    """sections: [(x, r)] along X. Returns a closed triangle mesh."""
    rings = [[(x, y, z) for y, z in profile(r, flat)] for x, r in sections]
    tris = []
    for A, B in zip(rings, rings[1:]):
        for i in range(N):
            j = (i + 1) % N
            tris += [(A[i], A[j], B[j]), (A[i], B[j], B[i])]
    for ring, rev in ((rings[0], True), (rings[-1], False)):
        c = (ring[0][0], 0.0, sum(p[2] for p in ring) / N)
        for i in range(N):
            j = (i + 1) % N
            tris.append((c, ring[j], ring[i]) if rev else (c, ring[i], ring[j]))
    return tris


def ring_z(r_out, r_in, h):
    tris = []
    o = [(r_out*math.cos(2*math.pi*i/N), r_out*math.sin(2*math.pi*i/N)) for i in range(N)]
    n = [(r_in*math.cos(2*math.pi*i/N), r_in*math.sin(2*math.pi*i/N)) for i in range(N)]
    for i in range(N):
        j = (i + 1) % N
        o0, o1, n0, n1 = o[i], o[j], n[i], n[j]
        tris += [((*o0, 0), (*o1, h), (*o1, 0)), ((*o0, 0), (*o0, h), (*o1, h))]   # outer wall
        tris += [((*n0, 0), (*n1, 0), (*n1, h)), ((*n0, 0), (*n1, h), (*n0, h))]   # inner wall
        tris += [((*o0, h), (*n0, h), (*n1, h)), ((*o0, h), (*n1, h), (*o1, h))]   # top
        tris += [((*o0, 0), (*n1, 0), (*n0, 0)), ((*o0, 0), (*o1, 0), (*n1, 0))]   # bottom
    return tris


if __name__ == "__main__":
    flat = -1.2  # 0.3 mm flat on the D3 shaft; same bed plane for the head
    pin = loft([(0, 3.0), (2, 3.0), (2, 1.5), (164, 1.5), (165, 1.1)], flat)
    pin = [tuple((x, y, z - flat) for x, y, z in t) for t in pin]  # put the flat on z = 0
    write_stl(os.path.join(OUT, "qamqor_hinge_pin.stl"), pin)
    write_stl(os.path.join(OUT, "qamqor_hinge_cap.stl"), [(a, c, b) for a, b, c in ring_z(3.0, 1.45, 3.0)])
    print("ok: qamqor_hinge_pin.stl (", len(pin), "tris ), qamqor_hinge_cap.stl")
