"""Converts site/raw/*.jpg to WebP in site/public/img (Pillow, run manually; not part of the bundle).
   python scripts/optimize-images.py"""
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter, ImageStat
root = Path(__file__).resolve().parent.parent
raw, out = root / "raw", root / "public" / "img"
out.mkdir(parents=True, exist_ok=True)
for f in sorted(raw.glob("*.jpg")):
    im = Image.open(f).convert("RGB")
    if f.stem == "strap-texture":
        # central weave only; flatten the low-frequency lighting so tiles do not show seams or bands
        c = im.crop((266, 266, 754, 754)).resize((512, 512), Image.LANCZOS)
        low = c.filter(ImageFilter.GaussianBlur(40))
        flat = ImageChops.add(ImageChops.subtract(c, low, 1, 0), Image.new("RGB", c.size, tuple(int(v) for v in ImageStat.Stat(c).mean)))
        flat.save(out / "strap-texture.webp", "WEBP", quality=72, method=6)
        continue
    im.save(out / f"{f.stem}-1400.webp", "WEBP", quality=70, method=6)
    h = round(800 * im.height / im.width)
    im.resize((800, h), Image.LANCZOS).save(out / f"{f.stem}-800.webp", "WEBP", quality=68, method=6)
