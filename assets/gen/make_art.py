#!/usr/bin/env python3
"""Nine Rings art factory — every bitmap in assets/img/ is generated from this file.

Motif (fixed from the gameplay, not from taste): nine brass rings on a steel blade over a
dark stand. A ring that is 上剑 is threaded *through* the bar (the bar crosses its centre,
the lower arc is drawn over the steel); a ring that is 离剑 hangs *below* the bar. That
on/off contrast is the whole toy, so it is the whole icon — the icon is a screenshot of the
rule, which is also what js/view.js draws.

Palette is read off css/game.css :root (--brass/--steel/--cyan/--bg*), and the icon library
in make_icons.py is the same composition-first idea; this repo's motif is not in that shared
MOTIF table yet, so the generator lives next to the game it describes.

Deterministic: no Math.random, no wall clock. Same input -> byte-identical PNG, so
`python3 assets/gen/make_art.py` is a reviewable command, not a re-roll.

    python3 assets/gen/make_art.py    # writes assets/img/* and prints each PNG's IHDR size

Needs Pillow (the house tool make_icons.py uses it too); no network, no fonts downloaded.
"""
import io
import math
import os
import struct
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: python3 -m pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "assets", "img")

# --bg-2, --bg, --panel, --line, --ink, --brass, --brass-dim, --steel, --cyan
BG = (16, 18, 23)
BG2 = (23, 26, 33)
PANEL = (27, 31, 39)
INK = (230, 233, 239)
BRASS = (216, 161, 60)
BRASS_HI = (255, 238, 205)
BRASS_DIM = (138, 102, 32)
STEEL = (159, 171, 185)
STEEL_HI = (228, 235, 244)
STEEL_LOW = (104, 114, 127)
CYAN = (120, 220, 255)
WOOD = (90, 63, 44)

CJK_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def alpha(c, a):
    return (int(c[0]), int(c[1]), int(c[2]), int(round(a * 255)))


def radial_bg(size, top=None, bottom=None):
    """Vertical light from the top edge, matching body's radial-gradient in game.css."""
    w, h = size
    top = top or BG2
    bottom = bottom or BG
    img = Image.new("RGB", (w, h), bottom)
    px = img.load()
    for y in range(h):
        # Same 120%/100% ellipse as the CSS: strength falls off with normalised distance
        # from the top-centre, not linearly with y, or the icon reads as a flat bar chart.
        t = (y / h) ** 0.62
        c = lerp(top, bottom, min(1.0, t))
        for x in range(w):
            dx = (x - w / 2) / (w * 0.6)
            k = min(1.0, t + dx * 0.18)
            px[x, y] = lerp(top, bottom, k)
    return img


def ring_arc(d, cx, cy, r, thick, colour, a0, a1):
    d.arc([cx - r, cy - r, cx + r, cy + r], a0, a1, fill=colour, width=thick)


def draw_blade(d, x0, x1, bar_y, thick, scaled=1.0):
    """Grip, guard, then the tapered steel bar. Same construction order as drawSword()."""
    grip_w = thick * 2.6
    # grip
    d.rounded_rectangle([x0, bar_y - thick * 1.2, x0 + grip_w, bar_y + thick * 1.2],
                        radius=thick, fill=WOOD)
    for i in range(3):
        gx = x0 + thick * 0.35 + i * thick * 0.75
        d.rounded_rectangle([gx, bar_y - thick * 1.2, gx + thick * 0.34, bar_y + thick * 1.2],
                            radius=thick * 0.2, fill=(61, 42, 30))
    # guard
    d.rounded_rectangle([x0 + grip_w, bar_y - thick * 2.3, x0 + grip_w + thick * 1.2,
                         bar_y + thick * 2.3], radius=thick * 0.35, fill=(141, 122, 74))
    bar_x0 = x0 + grip_w + thick * 1.0
    # blade: full thickness at the guard, tapering to a point at the right
    d.polygon([(bar_x0, bar_y - thick), (x1 - thick * 1.6, bar_y - thick * 0.62),
               (x1, bar_y), (x1 - thick * 1.6, bar_y + thick * 0.62),
               (bar_x0, bar_y + thick)],
              fill=STEEL)
    # the ground edge reads as a lighter band along the spine
    d.line([(bar_x0 + thick * 0.2, bar_y - thick * 0.35), (x1 - thick * 1.9, bar_y - thick * 0.2)],
           fill=STEEL_HI, width=max(1, int(thick * 0.22)))
    d.line([(bar_x0 + thick * 0.2, bar_y + thick * 0.55), (x1 - thick * 1.9, bar_y + thick * 0.3)],
           fill=STEEL_LOW, width=max(1, int(thick * 0.18)))
    return bar_x0


def compose_icon(S, ring_count=9, hang_from=5, pad=0.0, bg=None, band=0.24):
    """The board as the rule sees it: rings 0..hang_from-1 threaded, the rest hanging below.

    `hang_from=5` of 9 is not arbitrary — it is a mixed row, which is what makes this toy a
    puzzle and not a switchboard; an all-on or all-off icon would read as a decoration.
    `band` is ring stroke width as a fraction of the ring pitch: PIL strokes an arc inward
    from the radius, so a band above ~0.3 fills the ring solid and the icon stops saying
    "ring". It is raised for the small-size master, where a thin band disappears anyway.
    """
    img = bg.copy() if bg else radial_bg((S, S))
    d = ImageDraw.Draw(img, "RGBA")
    bar_y = int(S * (0.40 - pad * 0.2))
    thick = S * 0.028 * (1 + pad * 2.2)
    x0 = S * (0.085 + pad)
    grip_w = thick * 2.4
    guard_w = thick * 1.15
    bar_x0 = x0 + grip_w + guard_w
    x1 = S * (0.945 - pad)
    span = x1 - thick * 1.8 - bar_x0 - thick * 0.9
    pitch = span / max(1, ring_count - 1 + 0.55)
    cx0 = bar_x0 + thick * 0.9 + pitch * 0.28
    r = min(pitch * 0.46, S * 0.088)
    lw = max(2, int(pitch * band))
    swing = S * (0.30 - pad * 0.5)

    d.rounded_rectangle([S * (0.045 + pad), S * (0.06 + pad), S * (0.955 - pad), S * (0.94 - pad)],
                        radius=S * 0.075, fill=alpha(PANEL, 0.6),
                        outline=alpha(INK, 0.10), width=max(1, int(S / 480)))

    # 1) back arcs of the threaded rings, so the steel can pass in front of them
    for k in range(hang_from):
        ring_arc(d, cx0 + k * pitch, bar_y, r, lw, lerp(BRASS_DIM, BRASS, 0.35), 180, 360)

    draw_blade(d, x0, x1, bar_y, thick)

    # 2) the cyan aura on the ring the rule would accept right now
    aura = min(ring_count - 1, hang_from)
    ax, ay = cx0 + aura * pitch, bar_y + (0 if aura < hang_from else swing)
    ring_arc(d, ax, ay, r + lw * 0.75, max(1, int(pitch * 0.07)), alpha(CYAN, 0.34), 0, 360)

    # 3) front arcs: a threaded ring's lower half is drawn over the steel, which is exactly
    # how the real toy reads — the near side of the ring hides the bar.
    for k in range(ring_count):
        cx = cx0 + k * pitch
        on = k < hang_from
        cy = bar_y if on else bar_y + swing
        body = BRASS if on else lerp(BRASS, BRASS_DIM, 0.25)
        if on:
            ring_arc(d, cx, cy, r, lw, body, 0, 180)
            ring_arc(d, cx, cy, r, max(1, lw // 3), alpha(BRASS_DIM, 0.75), 186, 354)
        else:
            ring_arc(d, cx, cy, r, lw, body, 0, 360)
        ring_arc(d, cx, cy, r - lw * 0.42, max(1, int(pitch * 0.11)),
                 alpha(BRASS_HI, 0.8 if on else 0.42), 22, 128)
    return img


def rounded_mask(S, radius):
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    return m


def master():
    return compose_icon(1024)


def master_small():
    """Nine rings do not survive a 16px tab: the bands merge into one gold smudge. The
    favicon chain therefore comes from a 4-ring, wide-band composition of the same motif —
    same sword, same threaded/hanging contrast, fewer, fatter rings."""
    return compose_icon(256, ring_count=4, hang_from=2, pad=0.03, band=0.30)


def save(img, name, quality=100):
    path = os.path.join(OUT, name)
    img.save(path, "PNG", optimize=True)
    return path


def texture_tile(S=96):
    """Tileable dark weave for the stand and the page background.

    Every term is periodic with the tile, so `repeat-x/y` seams are invisible — a texture
    that only *looks* tileable moves the seam onto the player's board.
    """
    img = Image.new("RGB", (S, S))
    px = img.load()
    for y in range(S):
        for x in range(S):
            u, v = x / S * 2 * math.pi, y / S * 2 * math.pi
            weave = 0.55 * math.sin(u * 4 + v * 4) + 0.45 * math.sin(u * 8 - v * 2)
            grain = 0.30 * math.sin(u * 12 + 1.7) * math.cos(v * 9 + 0.4)
            k = 1.0 + (weave + grain) / 6.0
            px[x, y] = (max(0, min(255, int(BG[0] * 1.35 * k + 6 * k))),
                        max(0, min(255, int(BG[1] * 1.35 * k + 7 * k))),
                        max(0, min(255, int(BG[2] * 1.35 * k + 9 * k))))
    return img


def spark(size=64):
    """Additive brass spark sprite for the solve burst; a ring seen head-on, i.e. a glow
    with a bright rim, so the particle reads as the same metal as the board."""
    S = size
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    px = img.load()
    c = (S - 1) / 2.0
    for y in range(S):
        for x in range(S):
            dx, dy = (x - c) / c, (y - c) / c
            r = math.hypot(dx, dy)
            if r >= 1.0:
                continue
            core = max(0.0, 1.0 - r / 0.42) ** 2
            rim = math.exp(-((r - 0.72) ** 2) / 0.012) * 0.9
            a = min(1.0, core + rim)
            col = lerp(BRASS, BRASS_HI, core)
            px[x, y] = (col[0], col[1], col[2], int(round(a * 225)))
    return img


def find_font(size):
    for p in CJK_CANDIDATES:
        if os.path.exists(p):
            try:
                f = ImageFont.truetype(p, size)
                return f, True
            except OSError:
                continue
    return ImageFont.load_default(size=size), False


def social_card(master_img):
    """1200x630 og card: the board on the right, the claim on the left.

    The number has to be on the card, because that is the product: 341 clicks is measured by
    exhausting all 512 positions (js/core/solve.js), not guessed.
    """
    W, H = 1200, 630
    img = radial_bg((W, H))
    tex = texture_tile(96).resize((W, H), Image.BILINEAR)
    img = Image.blend(img, tex, 0.35)
    d = ImageDraw.Draw(img, "RGBA")
    art = master_img.resize((470, 470), Image.LANCZOS)
    img.paste(art, (W - 470 - 56, 82), rounded_mask(470, 40))
    left = 64
    d.rounded_rectangle([left, 76, left + 30, 300], radius=8, fill=alpha(BRASS, 0.9))
    title_y = 96
    ftitle, cjk = find_font(104)
    fsub = ImageFont.load_default(size=40) if not cjk else None
    if cjk:
        d.text((left + 56, title_y), "九连环", font=ftitle, fill=INK)
        latin = "NINE RINGS"
        lsize = 40
    else:
        latin = "NINE RINGS"
        lsize = 76
        d.text((left + 56, title_y + 18), latin, font=ImageFont.load_default(size=lsize), fill=INK)
    fsmall, _ = find_font(30)
    lines = [
        ("解尽九环 · 最少步数是量出来的" if cjk else "SOLVED BY MEASUREMENT", BRASS),
        ("341 步下尽九环" if cjk else "341 clicks to clear the sword", INK),
        ("512 个位置全部穷尽 BFS 对账" if cjk else "all 512 positions, exhaustive BFS", INK),
        ("零依赖 · 浏览器与桌面同一段代码" if cjk else "zero dependencies, web + desktop", (143, 152, 168)),
    ]
    y = title_y + (150 if cjk else 140)
    if cjk:
        d.text((left + 56, y), "NINE RINGS", font=ImageFont.load_default(size=36), fill=(143, 152, 168))
        y += 74
    for text, col in lines:
        d.text((left + 56, y), text, font=fsmall, fill=col)
        y += 46
    d.line([(left + 56, H - 118), (W - 560, H - 118)], fill=alpha(INK, 0.14), width=2)
    d.text((left + 56, H - 96), "z-biz-game · nine-rings", font=ImageFont.load_default(size=22),
           fill=(143, 152, 168))
    return img


def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", head[16:24])


def main():
    os.makedirs(OUT, exist_ok=True)
    m = master()
    wrote = []

    # Favicon chain comes off the same master so a 16px tab icon and a 512px install icon
    # cannot drift into two different brands.
    ms = master_small()
    for S in (1024, 512, 192, 96, 64, 48, 32, 16):
        src = ms if S <= 64 else m
        img = src if S == src.size[0] else src.resize((S, S), Image.LANCZOS)
        wrote.append(save(img, f"icon-{S}.png"))
    # maskable: the OS crops to its own shape and keeps the central 80%, so the art is pushed
    # in and the plate fills the frame instead of leaving transparent corners.
    maskable = Image.alpha_composite(radial_bg((512, 512)).convert("RGBA"),
                                     compose_icon(512, pad=0.15).convert("RGBA")).convert("RGB")
    wrote.append(save(maskable, "icon-maskable-512.png"))
    # apple-touch-icon: iOS does not round it for you and does not like alpha; opaque plate
    # at 180 with the art scaled for the older, tighter safe area.
    at = Image.alpha_composite(radial_bg((180, 180)).convert("RGBA"),
                               compose_icon(180, pad=0.05).convert("RGBA")).convert("RGB")
    wrote.append(save(at, "apple-touch-icon.png"))
    wrote.append(save(texture_tile(96), "texture-weave-96.png"))
    wrote.append(save(spark(64), "sprite-spark-64.png"))
    wrote.append(save(social_card(m), "og-nine-rings.png"))
    # .ico container for the classic favicon link: 16/32/48 in one file
    ico_path = os.path.join(OUT, "favicon.ico")
    sizes = [16, 32, 48]
    blobs = []
    for S in sizes:
        im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        im.paste(ms.resize((S, S), Image.LANCZOS).convert("RGBA"), (0, 0))
        buf = io.BytesIO()
        im.save(buf, "PNG")
        blobs.append(buf.getvalue())
    with open(ico_path, "wb") as fh:
        fh.write(struct.pack("<HHH", 0, 1, len(sizes)))
        off = 6 + 16 * len(sizes)
        for S, blob in zip(sizes, blobs):
            # both size bytes are 0 for 256px and up; 48 and below are literal
            fh.write(struct.pack("<BBBBHHII", S % 256, S % 256, 0, 0, 1, 32, len(blob), off))
            off += len(blob)
        for blob in blobs:
            fh.write(blob)
    wrote.append(ico_path)

    print("generated %d files into %s" % (len(wrote), os.path.relpath(OUT, REPO)))
    for p in wrote:
        print("  %-30s %s  %s" % (os.path.relpath(p, OUT), png_size(p), os.path.getsize(p)))


if __name__ == "__main__":
    main()
