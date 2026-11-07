"""WCAG 2.x contrast check of the token pairs the mockups actually use. Run: python -I contrast-check.py
Reads ../tokens.css, so a token change is re-measured. Exit code 1 if any pair is below its threshold.
Threshold: 4.5 text, 3.0 for icons/borders/graphics (marked G)."""
import pathlib, re, sys

css = (pathlib.Path(__file__).resolve().parent.parent / "tokens.css").read_text(encoding="utf-8")
T = {k: v.upper() for k, v in re.findall(r"--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})", css)}

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
def tok(n): return rgb(T[n])

# (label, fg, bg, threshold). fg/bg are token names, or ("blend", fgToken, bgToken, alpha)
def col(x):
    if isinstance(x, tuple): return blend(tok(x[1]), tok(x[2]), x[3])
    return tok(x)

P = [
 ("tertiary button in UNREAD alert (was 4.19)", "primary-pressed", "primary-tint", 4.5),
 ("tertiary button in read alert / on surface", "primary", "surface", 4.5),
 ("tertiary 'Retry' in server banner (was 4.19)", "danger-text", "danger-bg", 4.5),
 ("Wi-Fi plate text", "info-text", "info-bg", 4.5),
 ("Wi-Fi plate button 'Понятно'", "info-text", "info-bg", 4.5),
 ("pressed secondary/tertiary label on sunken", "primary-pressed", "sunken", 4.5),
 ("secondary button on bg (mini card)", "primary", "bg", 4.5),
 ("secondary button on surface", "primary", "surface", 4.5),
 ("rail active label on primary-tint (was 4.19)", "ink", "primary-tint", 4.5),
 ("bottom-nav active label", "primary", "surface", 4.5),
 ("bottom-nav inactive label", "ink-2", "surface", 4.5),
 ("link / farm accents on bg", "primary", "bg", 4.5),
 ("chip selected text", "ink", "primary-tint", 4.5),
 ("herd row selected: title", "ink", "primary-tint", 4.5),
 ("herd row selected: subtitle", "ink-2", "primary-tint", 4.5),
 ("herd row selected: time", "ink-3", "primary-tint", 4.5),
 ("unread alert: title", "ink", "primary-tint", 4.5),
 ("unread alert: text", "ink-2", "primary-tint", 4.5),
 ("unread alert: time", "ink-3", "primary-tint", 4.5),
 ("mini card caption on bg", "ink-3", "bg", 4.5),
 ("ink-3 on surface", "ink-3", "surface", 4.5),
 ("ink-3 on sunken", "ink-3", "sunken", 4.5),
 ("on-primary on primary", "on-primary", "primary", 4.5),
 ("on-primary on primary-pressed", "on-primary", "primary-pressed", 4.5),
 ("on-primary on danger", "on-primary", "danger-solid", 4.5),
 ("on-primary on danger-pressed", "on-primary", "danger-pressed", 4.5),
 ("nav badge", "on-primary", "danger-solid", 4.5),
 ("toast", "on-primary", "ink", 4.5),
 ("badge ok / connection button / all-ok line", "ok-text", "ok-bg", 4.5),
 ("badge warning", "warning-text", "warning-bg", 4.5),
 ("badge danger / error banner", "danger-text", "danger-bg", 4.5),
 ("badge offline / offline banner", "offline-text", "offline-bg", 4.5),
 ("badge info ('Черновик')", "info-text", "info-bg", 4.5),
 ("summary tile: out of zone", "danger-text", "surface", 4.5),
 ("summary tile: no fence", "warning-text", "surface", 4.5),
 ("summary tile: no connection", "offline-text", "surface", 4.5),
 ("summary tile label", "ink-2", "surface", 4.5),
 ("alert icon danger on tint (G)", "danger-text", "primary-tint", 3.0),
 ("check icon primary on tint (G)", "primary", "primary-tint", 3.0),
 ("map label ink on 90% plate over dark grass", "ink", ("blend", "surface", "map-ph-dark", 0.9), 4.5),
 ("map label ink on 90% plate over sand", "ink", ("blend", "surface", "map-ph-sand", 0.9), 4.5),
 ("top bar text on 94% surface over dark grass", "ink", ("blend", "surface", "map-ph-dark", 0.94), 4.5),
 ("map caption", "ink-2", "surface", 4.5),
 ("input border (G)", "line", "surface", 3.0),
 ("input border on bg (G)", "line", "bg", 3.0),
 ("selected outline primary on tint (G)", "primary", "primary-tint", 3.0),
 ("focus ring on bg (G)", "focus", "bg", 3.0),
 ("focus ring on surface (G)", "focus", "surface", 3.0),
 ("focus ring on sunken (G)", "focus", "sunken", 3.0),
 ("focus ring on primary-tint (G)", "focus", "primary-tint", 3.0),
 ("marker ok glyph (G)", "ink", "marker-ok", 3.0),
 ("marker warning glyph (G)", "ink", "marker-warning", 3.0),
 ("marker danger glyph white (G)", "on-primary", "marker-danger", 3.0),
 ("marker offline glyph (G)", "ink", "marker-offline", 3.0),
 ("marker ring vs halo (G)", "ink", "surface", 3.0),
]
bad = 0
print("%-58s %-8s %-6s %s" % ("pair", "ratio", "min", "result"))
for label, fg, bg, th in P:
    r = ratio(col(fg), col(bg))
    ok = r >= th
    bad += not ok
    print("%-58s %-8.2f %-6.1f %s" % (label, r, th, "pass" if ok else "FAIL"))
print("\n%d pairs, %d failures" % (len(P), bad))
print("Informational (exempt, disabled controls): disabled-text on bg = %.2f, on sunken = %.2f" % (ratio(tok("disabled-text"), tok("bg")), ratio(tok("disabled-text"), tok("sunken"))))
sys.exit(1 if bad else 0)
