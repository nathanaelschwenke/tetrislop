"""Generates the PWA / home-screen icons into public/icons/.

Blocks use the game's beveled cell style and HSL piece colours
(src/config/visualConfig.ts). Run:  python3 scripts/make_icons.py  (needs Pillow)
"""
import colorsys
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
SS = 1024  # supersampled canvas, downscaled per icon size

PIECES = {  # h, s, l  (visualConfig.ts PIECE_COLORS)
    "I": (190, 90, 50), "J": (225, 85, 45), "L": (30, 95, 52), "O": (50, 95, 52),
    "S": (130, 75, 45), "Z": (0, 85, 52), "T": (290, 80, 50),
}

# 6x6 composition: (col, row, piece); row 0 = top. A small stack with one hole.
CELLS = [
    (1, 0, "L"), (1, 1, "L"), (1, 2, "L"), (2, 2, "L"),
    (4, 1, "S"), (4, 2, "S"), (5, 2, "S"), (5, 3, "S"),
    (2, 3, "T"), (3, 3, "T"), (4, 3, "T"), (3, 4, "T"),
    (0, 3, "J"), (0, 4, "J"), (1, 4, "J"), (2, 4, "J"),
    (4, 4, "O"), (5, 4, "O"), (4, 5, "O"), (5, 5, "O"),
    (0, 5, "I"), (1, 5, "I"), (2, 5, "I"), (3, 5, "I"),
]

BG_TOP = (14, 18, 40)
BG_BOTTOM = (4, 5, 11)


def hsl(h, s, l):
    s = max(0, min(100, s)) / 100
    l = max(0, min(100, l)) / 100
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


def draw_cell(d, x, y, size, piece):
    h, s, l = PIECES[piece]
    b = size * 0.06   # outer border
    bev = size * 0.16  # bevel depth
    d.rectangle([x, y, x + size, y + size], fill=hsl(h, s, l - 18))
    x0, y0, x1, y1 = x + b, y + b, x + size - b, y + size - b
    ix0, iy0, ix1, iy1 = x0 + bev, y0 + bev, x1 - bev, y1 - bev
    d.polygon([(x0, y0), (x1, y0), (ix1, iy0), (ix0, iy0)], fill=hsl(h, s - 10, l + 24))  # top
    d.polygon([(x0, y0), (ix0, iy0), (ix0, iy1), (x0, y1)], fill=hsl(h, s - 10, l + 24))  # left
    d.polygon([(x0, y1), (ix0, iy1), (ix1, iy1), (x1, y1)], fill=hsl(h, s, l - 22))       # bottom
    d.polygon([(x1, y0), (x1, y1), (ix1, iy1), (ix1, iy0)], fill=hsl(h, s, l - 22))       # right
    d.rectangle([ix0, iy0, ix1, iy1], fill=hsl(h, s, l + 6))


def render(content_ratio, rounded):
    img = Image.new("RGBA", (SS, SS), (0, 0, 0, 0))
    bg = Image.new("RGBA", (SS, SS))
    bd = ImageDraw.Draw(bg)
    for yy in range(SS):  # vertical gradient
        t = yy / (SS - 1)
        bd.line([(0, yy), (SS, yy)], fill=tuple(round(a + (c - a) * t) for a, c in zip(BG_TOP, BG_BOTTOM)) + (255,))
    mask = Image.new("L", (SS, SS), 0)
    md = ImageDraw.Draw(mask)
    if rounded:
        md.rounded_rectangle([0, 0, SS - 1, SS - 1], radius=round(SS * 0.22), fill=255)
    else:
        md.rectangle([0, 0, SS, SS], fill=255)
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img)
    cell = SS * content_ratio / 6
    off = (SS - cell * 6) / 2
    for col, row, piece in CELLS:
        draw_cell(d, off + col * cell, off + row * cell, cell, piece)
    return img


def save(img, size, name, opaque=False):
    out = img.resize((size, size), Image.LANCZOS)
    if opaque:  # iOS shows transparency as black; keep it explicit
        flat = Image.new("RGB", out.size, BG_BOTTOM)
        flat.paste(out, (0, 0), out)
        out = flat
    out.save(OUT / name, optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    regular = render(content_ratio=0.66, rounded=True)    # "any": rounded tile
    maskable = render(content_ratio=0.56, rounded=False)  # full bleed, content in the safe zone
    save(regular, 192, "icon-192.png")
    save(regular, 512, "icon-512.png")
    save(regular, 32, "favicon-32.png")
    save(maskable, 512, "icon-maskable-512.png")
    save(maskable, 180, "apple-touch-icon.png", opaque=True)
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
