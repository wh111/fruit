#!/usr/bin/env python3
"""Shop fit-out board — schematic layout, not mm-accurate (待复尺)."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"
SITE_DIR = OUT / "site-photos"

SITE_PHOTOS = [
    (SITE_DIR / "01-facade-front.png", "正立面：柱在左，门洞偏右"),
    (SITE_DIR / "02-entrance-duct.png", "门洞仰视：上方风管+金属网"),
    (SITE_DIR / "03-interior-floor.png", "铺内：绿磨石地面，后墙制作间"),
    (SITE_DIR / "04-corridor-pillar.png", "走廊侧：柱面+开关"),
]
SITE = SITE_PHOTOS[0][0]

SHOP_W = 3.93
SHOP_D = 4.89
PILLAR_W = 1.28
PILLAR_D = 0.70
OPEN_W = SHOP_W - PILLAR_W

# 开间内分区（比例示意，具体尺寸待复尺）
OPEN_SEG = [
    ("收银台", 0.72),
    ("玻璃制作间\n可视面", 0.98),
    ("取货口", 0.35),
    ("单门展示冷柜", 0.60),
]
assert abs(sum(s[1] for s in OPEN_SEG) - OPEN_W) < 0.01

COUNTER_D = 0.55
FRIDGE_W, FRIDGE_D = 0.60, 0.62
GLASS_W, GLASS_D = 1.85, 2.20
GLASS_X, GLASS_Y = 1.38, 1.50

FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

W, H = 4961, 3508
M = 80
BG = (250, 250, 248)
INK = (30, 30, 30)
RED = (211, 47, 47)
BLUE = (21, 101, 192)
GREEN = (46, 125, 50)
GRAY = (120, 120, 120)
LIGHT = (235, 235, 235)
WOOD = (180, 140, 90)


def approx_m(v: float) -> str:
    """Rough metre label for schematic drawings."""
    if v >= 1:
        return f"约{v:.1f}m".replace(".0m", "m")
    return f"约{int(round(v * 100))}cm"


def f(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size)


def fit(img: Image.Image, w: int, h: int) -> Image.Image:
    s = min(w / img.width, h / img.height)
    nw, nh = int(img.width * s), int(img.height * s)
    canvas = Image.new("RGB", (w, h), LIGHT)
    canvas.paste(img.resize((nw, nh), Image.Resampling.LANCZOS), ((w - nw) // 2, (h - nh) // 2))
    return canvas


def panel(x, y, w, h, title: str, draw: ImageDraw.ImageDraw) -> tuple[int, int, int, int]:
    draw.rounded_rectangle((x, y, x + w, y + h), radius=12, fill=(255, 255, 255), outline=(210, 210, 210), width=2)
    draw.text((x + 24, y + 18), title, font=f(34, True), fill=INK)
    draw.line((x + 24, y + 62, x + w - 24, y + 62), fill=GREEN, width=4)
    return x + 16, y + 78, w - 32, h - 94


def dim_h(draw, x1, x2, y, label, color=BLUE, size=24):
    y2 = y + 30
    draw.line((x1, y, x1, y2), fill=color, width=2)
    draw.line((x2, y, x2, y2), fill=color, width=2)
    draw.line((x1, y2, x2, y2), fill=color, width=2)
    tw = draw.textlength(label, font=f(size, True))
    draw.text(((x1 + x2 - tw) / 2, y2 + 6), label, font=f(size, True), fill=color)


def dim_v(draw, y1, y2, x, label, color=BLUE, size=24):
    x2 = x - 36
    draw.line((x, y1, x2, y1), fill=color, width=2)
    draw.line((x, y2, x2, y2), fill=color, width=2)
    draw.line((x2, y1, x2, y2), fill=color, width=2)
    draw.text((x2 - draw.textlength(label, font=f(size, True)) - 8, (y1 + y2) / 2 - 10), label, font=f(size, True), fill=color)


def hatch(draw, x, y, w, h):
    x, y, w, h = int(x), int(y), int(w), int(h)
    draw.rectangle((x, y, x + w, y + h), fill=(220, 220, 220), outline=INK, width=2)
    for i in range(-h, w + h, 10):
        draw.line((x + i, y, x + i - h, y + h), fill=(150, 150, 150), width=1)


def annotate_site(img: Image.Image) -> Image.Image:
    out = img.copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    fx1, fx2 = int(w * 0.055), int(w * 0.945)
    fy_top, fy_bot = int(h * 0.18), int(h * 0.72)
    px_per_m = (fx2 - fx1) / SHOP_W
    px_pillar = int(PILLAR_W * px_per_m)
    px_open = int(OPEN_W * px_per_m)

    hatch_img = Image.new("RGBA", out.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(hatch_img)
    hatch(hd, fx1, fy_top, px_pillar, int(PILLAR_D * px_per_m * 0.55))
    out = Image.alpha_composite(out.convert("RGBA"), hatch_img).convert("RGB")
    draw = ImageDraw.Draw(out)

    draw.rectangle((fx1, fy_top, fx1 + px_pillar, fy_top + int(PILLAR_D * px_per_m * 0.55)), outline=RED, width=4)
    draw.text((fx1 + 10, fy_top + 6), f"结构柱 {approx_m(PILLAR_W)}", font=f(26, True), fill=RED)
    draw.rectangle((fx1 + px_pillar, fy_top, fx2, fy_bot), outline=GREEN, width=4)
    draw.text((fx1 + px_pillar + 16, fy_top + 8), f"可装门面 {approx_m(OPEN_W)}", font=f(26, True), fill=GREEN)
    dim_h(draw, fx1, fx2, fy_bot + 14, f"总宽 {approx_m(SHOP_W)}", RED, 28)
    dim_h(draw, fx1 + px_pillar, fx2, fy_top - 24, f"开间 {approx_m(OPEN_W)}", GREEN, 26)
    return out


def build_site_survey() -> None:
    """2×2 collage of all on-site photos for designer handoff."""
    cols, rows = 2, 2
    cell_w, cell_h = 1180, 820
    cap_h = 44
    pad = 24
    board = Image.new("RGB", (cols * cell_w + pad * 3, rows * (cell_h + cap_h) + 120 + pad * 2), BG)
    draw = ImageDraw.Draw(board)
    draw.text((pad, 20), "四季果先 · 现场照片汇总（交给设计师量房用）", font=f(40, True), fill=INK)
    draw.text(
        (pad, 68),
        f"示意尺寸 {approx_m(SHOP_W)}×{approx_m(SHOP_D)}  ·  柱约{PILLAR_W}m  ·  开间约{OPEN_W:.1f}m  ·  待设计师复尺",
        font=f(24),
        fill=GRAY,
    )

    for i, (path, caption) in enumerate(SITE_PHOTOS):
        if not path.exists():
            continue
        col, row = i % cols, i // cols
        x = pad + col * (cell_w + pad)
        y = 110 + row * (cell_h + cap_h + pad)
        img = Image.open(path).convert("RGB")
        if i == 0:
            img = annotate_site(fit(img, cell_w, cell_h - cap_h))
        else:
            img = fit(img, cell_w, cell_h - cap_h)
        draw.rectangle((x, y, x + cell_w, y + cell_h), outline=(200, 200, 200), width=2)
        board.paste(img, (x + 2, y + 2))
        draw.text((x + 8, y + cell_h - cap_h + 6), caption, font=f(22, True), fill=GREEN)

    out = OUT / "shop-fitout-site-survey.png"
    board.save(out, quality=95)
    print(f"wrote {out}")


def paste_site_grid(board: Image.Image, draw: ImageDraw.ImageDraw, ox: int, oy: int, iw: int, ih: int) -> None:
    gap = 8
    hw, hh = (iw - gap) // 2, (ih - gap) // 2
    slots = [(0, 0), (hw + gap, 0), (0, hh + gap), (hw + gap, hh + gap)]
    for (path, caption), (sx, sy) in zip(SITE_PHOTOS, slots):
        if not path.exists():
            continue
        img = Image.open(path).convert("RGB")
        if path.name.startswith("01-"):
            img = annotate_site(fit(img, hw, hh - 28))
        else:
            img = fit(img, hw, hh - 28)
        board.paste(img, (ox + sx, oy + sy))
        draw.text((ox + sx + 6, oy + sy + hh - 26), caption[:20], font=f(16, True), fill=(255, 255, 255))
        draw.rectangle((ox + sx, oy + sy, ox + sx + hw, oy + sy + hh), outline=(180, 180, 180), width=1)


def draw_plan(draw: ImageDraw.ImageDraw, ox: float, oy: float, scale: float) -> None:
    def X(m): return ox + m * scale
    def Y(m): return oy + m * scale

    draw.rectangle((X(0), Y(0), X(SHOP_W), Y(SHOP_D)), outline=INK, width=2)
    hatch(draw, X(0), Y(0), PILLAR_W * scale, PILLAR_D * scale)
    draw.text((X(PILLAR_W / 2) - 50, Y(PILLAR_D / 2)), "柱", font=f(20, True), fill=INK)

    # 开间内柜台（从 PILLAR_W 起，水平一字，不斜）
    x = PILLAR_W
    for label, seg_w in OPEN_SEG:
        draw.rectangle((X(x), Y(0), X(x + seg_w), Y(COUNTER_D)), outline=INK, width=2, fill=(252, 248, 240))
        cy = Y(COUNTER_D / 2) - 10
        for ln in label.split("\n"):
            tw = draw.textlength(ln, font=f(18))
            draw.text((X(x + seg_w / 2) - tw / 2, cy), ln, font=f(18), fill=INK)
            cy += 22
        x += seg_w

    # 制作间
    draw.rectangle((X(GLASS_X), Y(GLASS_Y), X(GLASS_X + GLASS_W), Y(GLASS_Y + GLASS_D)), outline=GREEN, width=3)
    draw.text((X(GLASS_X + GLASS_W / 2) - 90, Y(GLASS_Y + GLASS_D / 2) - 12), "鲜切制作间", font=f(22, True), fill=GREEN)

    # 冷柜 footprint（单门 650）
    fx = SHOP_W - FRIDGE_W
    draw.rectangle((X(fx), Y(COUNTER_D), X(SHOP_W), Y(COUNTER_D + FRIDGE_D)), outline=INK, width=2, fill=(230, 236, 240))
    draw.text((X(fx + FRIDGE_W / 2) - 40, Y(COUNTER_D + FRIDGE_D / 2) - 10), "小冷柜", font=f(18), fill=INK)

    # 斜装菜单区示意（立面上，平面用虚线标位置）
    draw.line((X(PILLAR_W), Y(0), X(SHOP_W - FRIDGE_W), Y(0)), fill=(255, 152, 0), width=3)
    draw.text((X(PILLAR_W + 0.3), Y(0) + 8), "← 顶部斜装菜单（立面）→", font=f(18), fill=(230, 120, 0))

    dim_h(draw, X(PILLAR_W), X(SHOP_W), Y(SHOP_D) + 55, f"开间 {approx_m(OPEN_W)}", GREEN, 24)
    dim_h(draw, X(0), X(SHOP_W), Y(SHOP_D) + 95, f"总宽 {approx_m(SHOP_W)}", BLUE, 24)
    dim_v(draw, Y(0), Y(SHOP_D), X(SHOP_W) + 40, approx_m(SHOP_D), BLUE, 24)
    draw.text((X(0), Y(SHOP_D) + 130), "※ 比例示意，非施工图精度", font=f(20), fill=GRAY)


def draw_elevation(draw: ImageDraw.ImageDraw, ox: int, oy: int, pw: int, ph: int) -> None:
    """Corrected front elevation: level counter, slanted top menus, compact fridge."""
    scale = (pw - 80) / SHOP_W
    floor_y = oy + ph - 130
    top_y = oy + 40
    sign_h = 0.38 * scale * (1 / scale)  # 380mm sign band in px
    sign_h = 55
    base_x = ox + 40

    def X(m): return base_x + m * scale
    floor = floor_y

    # Green sign band — full width
    draw.rectangle((X(0), top_y, X(SHOP_W), top_y + sign_h), fill=GREEN, outline=INK, width=2)
    draw.text((X(SHOP_W / 2) - 180, top_y + 14), "四季果先  SEASONAL FRUIT", font=f(22, True), fill=(255, 255, 255))

    # Slanted top menus (3 panels) — above counter, NOT on pillar vertical
    menu_y = top_y + sign_h + 8
    menu_panels = [
        (PILLAR_W + 0.05, 0.55, "扫码"),
        (PILLAR_W + 0.62, 0.70, "产品价目"),
        (PILLAR_W + 1.38, 0.65, "当季推荐"),
    ]
    for mx, mw, txt in menu_panels:
        x1, x2 = X(mx), X(mx + mw)
        y_top = menu_y
        y_bot = menu_y + 72
        slant = 18  # px drop left→right (斜装)
        draw.polygon([(x1, y_top + slant), (x2, y_top), (x2, y_bot), (x1, y_bot + slant)], fill=(255, 250, 240), outline=INK)
        draw.line((x1, y_top + slant, x2, y_top), fill=(255, 152, 0), width=3)
        tw = draw.textlength(txt, font=f(16))
        draw.text(((x1 + x2 - tw) / 2, y_bot - 28), txt, font=f(16), fill=INK)
    draw.text((X(PILLAR_W), menu_y - 4), "斜装菜单（顶部门头下）", font=f(17, True), fill=(230, 120, 0))

    # Pillar
    counter_h = 92
    counter_top = floor - counter_h
    hatch(draw, X(0), counter_top - 20, PILLAR_W * scale, 20 + counter_h)
    draw.text((X(PILLAR_W / 2) - 40, counter_top + 30), "结构柱", font=f(18, True), fill=INK)

    # Level counter — single straight line across opening zone
    cx1, cx2 = X(PILLAR_W), X(SHOP_W)
    draw.rectangle((cx1, counter_top, cx2, floor), fill=WOOD, outline=INK, width=2)
    draw.rectangle((cx1, counter_top - 8, cx2, counter_top), fill=(255, 255, 255), outline=INK, width=1)
    draw.text((X(PILLAR_W + OPEN_W / 2) - 100, counter_top + 38), "水平柜台（整进深一致）", font=f(17), fill=(255, 255, 255))

    # Glass prep window
    g1, g2 = X(PILLAR_W + OPEN_SEG[0][1]), X(PILLAR_W + OPEN_SEG[0][1] + OPEN_SEG[1][1])
    draw.rectangle((g1, counter_top - 130, g2, counter_top), fill=(220, 235, 255), outline=GREEN, width=2)
    draw.text(((g1 + g2) / 2 - 60, counter_top - 80), "鲜切制作间", font=f(17, True), fill=GREEN)

    # Pickup
    p1 = X(PILLAR_W + OPEN_SEG[0][1] + OPEN_SEG[1][1])
    p2 = X(PILLAR_W + OPEN_SEG[0][1] + OPEN_SEG[1][1] + OPEN_SEG[2][1])
    draw.rectangle((p1, counter_top - 50, p2, counter_top - 8), fill=(255, 243, 224), outline=INK, width=1)
    draw.text(((p1 + p2) / 2 - 28, counter_top - 38), "取货", font=f(15), fill=INK)

    # Compact single-door fridge 600mm
    f1, f2 = X(SHOP_W - FRIDGE_W), X(SHOP_W)
    draw.rectangle((f1, counter_top - 165, f2, floor), fill=(210, 218, 225), outline=INK, width=2)
    mid = (f1 + f2) / 2
    draw.line([mid, counter_top - 165, mid, floor], fill=GRAY, width=1)
    draw.text((f1 + 8, counter_top - 90), "单门冷柜", font=f(15, True), fill=INK)

    # 开间分区示意（不标毫米）
    bar_y = floor + 18
    x = X(PILLAR_W)
    for label, seg_w in OPEN_SEG:
        wpx = seg_w * scale
        name = label.split("\n")[0]
        draw.rectangle((x, bar_y, x + wpx, bar_y + 28), outline=INK, width=1, fill=(245, 245, 245))
        tw = draw.textlength(name, font=f(15))
        draw.text((x + wpx / 2 - tw / 2, bar_y + 5), name, font=f(15, True), fill=INK)
        x += wpx
    dim_h(draw, X(PILLAR_W), X(SHOP_W), bar_y + 34, f"开间分区示意 {approx_m(OPEN_W)}", GREEN, 22)


def build() -> None:
    missing = [p for p, _ in SITE_PHOTOS if not p.exists()]
    if missing:
        raise SystemExit(f"missing site photos: {missing}")

    site = Image.open(SITE).convert("RGB")
    board = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(board)

    draw.text((M, 36), "四季果先 · 店铺装修方案示意（待复尺）", font=f(50, True), fill=INK)
    draw.text(
        (M, 96),
        f"约{SHOP_W}m×{SHOP_D}m  ·  左柱约{PILLAR_W}m  ·  开间约{OPEN_W:.1f}m  ·  单门冷柜  ·  顶部门头斜装菜单  ·  水平台面",
        font=f(26),
        fill=GRAY,
    )

    top_h = 1160
    pw = (W - M * 3) // 2
    x1, y1, iw, ih = panel(M, 148, pw, top_h, "01  现场四角度（新增门洞/铺内/走廊）", draw)
    x2, y2, iw2, ih2 = panel(M * 2 + pw, 148, pw, top_h, "02  修正立面（水平台+斜装菜单+小冷柜）", draw)

    paste_site_grid(board, draw, x1, y1, iw, ih)
    draw_elevation(draw, x2, y2, iw2, ih2)

    bot_y = 148 + top_h + 32
    bot_h = H - bot_y - M - 120
    px1, py1, pw1, ph1 = panel(M, bot_y, W - M * 2, bot_h, "03  平面布置示意（比例参考，非精确施工图）", draw)
    scale = min((pw1 - 120) / SHOP_W, (ph1 - 180) / SHOP_D) * 0.85
    draw_plan(draw, px1 + (pw1 - SHOP_W * scale) / 2, py1 + 70, scale)

    note_y = H - 112
    draw.rounded_rectangle((M, note_y, W - M, H - M), radius=8, fill=(255, 243, 224), outline=(255, 183, 77), width=2)
    draw.text(
        (M + 20, note_y + 18),
        "本阶段只做方向示意：门洞上有风管  ·  铺内绿磨石  ·  柱在左前  ·  设备放门洞开间内  ·  "
        "小单门冷柜  ·  斜装菜单  ·  具体毫米数等设计师现场复尺后再定",
        font=f(23),
        fill=(120, 80, 20),
    )

    out = OUT / "shop-fitout-pro-board.png"
    board.save(out, quality=95)
    if SITE.exists():
        annotate_site(Image.open(SITE).convert("RGB")).save(OUT / "shop-fitout-site-annotated.png", quality=95)
    build_site_survey()
    print(f"wrote {out}")


if __name__ == "__main__":
    build()
