"""WCAG 2.x contrast check of the token pairs the v3 mockups actually use. Run: python -I contrast-check.py
Reads ../tokens.css, so a token change is re-measured. Exit code 1 if any pair is below its threshold.
Thresholds: 4.5 text, 3.0 for graphics/borders (G), 7.0 for the AAA target of main text (A).
Glass is blended over the two extreme basemap samples from the brief (2.3): sand #E9DDB8 and dark grass #3A4A2E."""
import pathlib, re, sys

css = (pathlib.Path(__file__).resolve().parent.parent / "tokens.css").read_text(encoding="utf-8")
T = {k: v.upper() for k, v in re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})", css)}
SAND, GRASS = "#E9DDB8", "#3A4A2E"

def rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = map(f, c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)
def blend(fg, bg, a): return tuple(round(fg[i] * a + bg[i] * (1 - a)) for i in range(3))
def tok(n): return rgb(T[n]) if n in T else rgb(n)
def col(x):
    if isinstance(x, tuple): return blend(tok(x[1]), tok(x[2]), x[3])
    return tok(x)
def sheet(base): return ("blend", "surface-0", base, 0.93)
def chrome(base): return ("blend", "surface-0", base, 0.86)

P = []
def add(label, fg, bg, th=4.5): P.append((label, fg, bg, th))

for s in ("surface-0", "surface-1", "surface-2"):
    add("ink on " + s + " (AAA)", "ink", s, 7.0)
    add("ink-2 on " + s + " (AAA)", "ink-2", s, 7.0)
    add("ink-3 on " + s, "ink-3", s, 4.5)
    add("primary on " + s + " (tertiary buttons, links)", "primary", s, 4.5)
    add("ok on " + s, "ok", s)
    add("warning on " + s, "warning", s)
    add("signal on " + s, "signal", s)
    add("offline on " + s, "offline", s)
add("ink-3 on surface-0 (AAA)", "ink-3", "surface-0", 7.0)
for nm, b in (("sand", SAND), ("dark grass", GRASS)):
    for t in ("ink", "ink-2", "ink-3", "primary", "signal", "offline"):
        add(t + " on sheet glass .93 over " + nm, t, sheet(b))
    add("ink on top chrome glass .86 over " + nm, "ink", chrome(b))
    add("ink on pill-less map plate .88 over " + nm, "ink", ("blend", "surface-0", b, 0.88))
add("white on primary", "on-primary", "primary")
add("white on primary-pressed", "on-primary", "primary-pressed")
add("white on signal (destructive, server banner)", "on-primary", "signal")
add("white on signal-pressed", "on-primary", "signal-pressed")
add("white on ink (toast)", "on-primary", "ink")
add("white on primary (selected chip, language row, cluster number)", "on-primary", "primary")
add("ink on signal-map (alerts tab counter)", "ink", "signal-map")
add("ink on surface-0 (current tab on the pill)", "ink", "surface-0")
add("signal on surface-2-white (out-of-zone tile number)", "signal", "surface-2-white")
add("ink on surface-2-white (tile label)", "ink", "surface-2-white")
for st in ("surface-3-a", "surface-3-b", "surface-3-c"):
    add("nav label (inactive) on " + st, "nav-text", st)
    add("white on " + st, "on-primary", st)
add("primary on surface-0 (current tab icon)", "primary", "surface-0", 3.0)
add("line on surface-2 (input border, G)", "line", "surface-2", 3.0)
add("line on surface-0 (G)", "line", "surface-0", 3.0)
add("focus outer ring vs inner ring (G)", "focus-outer", "focus-inner", 3.0)
add("focus outer ring vs sand (G)", "focus-outer", SAND, 3.0)
add("focus inner ring vs dark grass (G)", "focus-inner", GRASS, 3.0)
add("focus inner ring vs primary (G)", "focus-inner", "primary", 3.0)
add("marker casing vs white dot (G)", "marker-casing", "surface-2-white", 3.0)
add("white ring vs dark grass (G)", "surface-2-white", GRASS, 3.0)
add("white ring vs signal-map dot (G)", "surface-2-white", "signal-map", 1.0)
add("signal-map dot vs marker casing (G)", "signal-map", "marker-casing", 3.0)
add("primary cluster vs white ring (G)", "primary", "surface-2-white", 3.0)

bad = 0
print("%-66s %-8s %-6s %s" % ("pair", "ratio", "min", "result"))
for label, fg, bg, th in P:
    r = ratio(col(fg), col(bg))
    ok = r >= th
    bad += not ok
    print("%-66s %-8.2f %-6.1f %s" % (label, r, th, "pass" if ok else "FAIL"))
print("\n%d pairs, %d failures" % (len(P), bad))
print("Informational (disabled controls are exempt): disabled-text on surface-0 = %.2f, on surface-1 = %.2f" % (ratio(tok("disabled-text"), tok("surface-0")), ratio(tok("disabled-text"), tok("surface-1"))))
sys.exit(1 if bad else 0)
