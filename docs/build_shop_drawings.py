#!/usr/bin/env python3
"""Generate scaled shop fit-out drawings (plan + elevation) for 四季果先."""
from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs"

# Real dimensions (metres)
SHOP_W = 3.93
SHOP_D = 4.89
PILLAR_W = 1.28
PILLAR_D = 0.70

# Front counter segments (left → right, metres) — sum = SHOP_W
FRONT_MENU = 0.59
FRONT_COUNTER = 0.79
FRONT_GLASS = 1.18
FRONT_PICKUP = 0.39
FRONT_FRIDGE = SHOP_W - (FRONT_MENU + FRONT_COUNTER + FRONT_GLASS + FRONT_PICKUP)

COUNTER_D = 0.55
FRIDGE_W = FRONT_FRIDGE
FRIDGE_D = 0.68
GLASS_W = 1.95
GLASS_D = 2.35
GLASS_X = 0.90
GLASS_Y = 1.45

GREEN = "#2E7D32"
GREEN_LT = "#E8F5E9"
WOOD = "#C8A46E"
GRAY = "#666666"
LINE = "#222222"
DIM = "#1565C0"
PILLAR = "#BDBDBD"
WHITE = "#FFFFFF"


def mm(v: float) -> float:
    return v * 1000


def fmt_m(v: float) -> str:
    if abs(v - round(v, 2)) < 0.005:
        return f"{v:.2f}".rstrip("0").rstrip(".")
    return f"{v:.2f}"


def fmt_mm(v: float) -> str:
    return str(int(round(v)))


class Svg:
    def __init__(self, w: float, h: float, title: str) -> None:
        self.w = w
        self.h = h
        self.title = title
        self.parts: list[str] = []
        self.defs: list[str] = []
        self._pat = 0

    def add(self, s: str) -> None:
        self.parts.append(s)

    def rect(self, x, y, w, h, fill=WHITE, stroke=LINE, sw=1.2, dash=None, rx=0):
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        rx_attr = f' rx="{rx}"' if rx else ""
        self.add(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" '
            f'fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash_attr}{rx_attr}/>'
        )

    def line(self, x1, y1, x2, y2, stroke=LINE, sw=1.2, dash=None):
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(
            f'<line x1="{x1:.2f}" y1="{y1:.2f}" x2="{x2:.2f}" y2="{y2:.2f}" '
            f'stroke="{stroke}" stroke-width="{sw}"{dash_attr}/>'
        )

    def text(self, x, y, t, size=14, fill=LINE, anchor="start", weight="normal"):
        self.add(
            f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" fill="{fill}" '
            f'text-anchor="{anchor}" font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif" '
            f'font-weight="{weight}">{t}</text>'
        )

    def dim_h(self, x1, x2, y, label: str, off=28):
        yd = y + off
        self.line(x1, y, x1, yd + 8, stroke=DIM, sw=1)
        self.line(x2, y, x2, yd + 8, stroke=DIM, sw=1)
        self.line(x1, yd, x2, yd, stroke=DIM, sw=1)
        for xa, xb in ((x1, x1 + 8), (x2 - 8, x2)):
            self.line(xa, yd - 4, xb, yd + 4, stroke=DIM, sw=1)
        self.text((x1 + x2) / 2, yd + 18, label, size=13, fill=DIM, anchor="middle", weight="bold")

    def dim_v(self, y1, y2, x, label: str, off=34):
        xd = x - off
        self.line(x, y1, xd - 8, y1, stroke=DIM, sw=1)
        self.line(x, y2, xd - 8, y2, stroke=DIM, sw=1)
        self.line(xd, y1, xd, y2, stroke=DIM, sw=1)
        for ya, yb in ((y1, y1 + 8), (y2 - 8, y2)):
            self.line(xd - 4, ya, xd + 4, yb, stroke=DIM, sw=1)
        self.text(xd - 10, (y1 + y2) / 2 + 5, label, size=13, fill=DIM, anchor="end", weight="bold")

    def hatch(self, x, y, w, h, color=PILLAR):
        pid = f"hatch{self._pat}"
        self._pat += 1
        self.defs.append(
            f'<pattern id="{pid}" width="8" height="8" patternUnits="userSpaceOnUse" '
            f'patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#888" '
            f'stroke-width="1.2"/></pattern>'
        )
        self.add(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" '
            f'fill="{color}" stroke="{LINE}" stroke-width="1.5"/>'
        )
        self.add(
            f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" fill="url(#{pid})"/>'
        )

    def legend_item(self, x, y, fill, label, stroke=LINE):
        self.rect(x, y - 12, 18, 18, fill=fill, stroke=stroke, sw=1)
        self.text(x + 26, y + 2, label, size=13, fill=LINE)

    def title_block(self, ox, oy, drawing_name: str, scale: str):
        bw, bh = 360, 118
        self.rect(ox, oy, bw, bh, fill=WHITE, stroke=LINE, sw=1.5)
        self.text(ox + 16, oy + 30, "四季果先 · 店铺装修施工图", size=18, weight="bold")
        self.text(ox + 16, oy + 54, drawing_name, size=15, fill=GRAY)
        self.text(ox + 16, oy + 78, f"铺位内净尺寸 {fmt_m(SHOP_W)}m × {fmt_m(SHOP_D)}m", size=13, fill=GRAY)
        self.text(ox + 16, oy + 98, f"比例 {scale}  ·  单位 mm  ·  2026-08", size=12, fill=GRAY)

    def save(self, path: Path) -> None:
        body = "\n  ".join(self.parts)
        defs = "\n    ".join(self.defs)
        defs_block = f"<defs>\n    {defs}\n  </defs>\n  " if defs else ""
        svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{self.w:.0f}" height="{self.h:.0f}" viewBox="0 0 {self.w:.0f} {self.h:.0f}">
  {defs_block}<rect width="100%" height="100%" fill="#FAFAFA"/>
  <text x="{self.w/2:.0f}" y="42" text-anchor="middle" font-size="26" font-weight="bold"
        font-family="Noto Sans CJK SC, Microsoft YaHei, sans-serif" fill="{LINE}">{self.title}</text>
  {body}
</svg>
"""
        path.write_text(svg, encoding="utf-8")
        print(f"wrote {path}")


def px(m: float, scale: float) -> float:
    """Metres → drawing units (1 unit ≈ 1 px at export resolution)."""
    return m * 1000 / scale


def build_plan(scale: float = 50) -> Svg:
    """Scale 1:50 — shop metres mapped to drawing units."""
    margin = 180
    draw_w = px(SHOP_W, scale)
    draw_d = px(SHOP_D, scale)
    svg = Svg(draw_w + margin * 2 + 220, draw_d + margin * 2 + 260, "平面图")

    ox = margin + 110
    oy = margin + 70

    def X(m: float) -> float:
        return ox + px(m, scale)

    def Y(m: float) -> float:
        return oy + px(m, scale)

    def W(m: float) -> float:
        return px(m, scale)

    # Outer wall
    svg.rect(X(0), Y(0), W(SHOP_W), W(SHOP_D), fill=WHITE, stroke=LINE, sw=2.5)
    svg.text(X(SHOP_W / 2), Y(SHOP_D) + 46, "公共走廊", size=14, fill=GRAY, anchor="middle")

    # Structural pillar (front-left)
    svg.hatch(X(0), Y(0), W(PILLAR_W), W(PILLAR_D))
    svg.text(X(PILLAR_W / 2), Y(PILLAR_D / 2) + 5, "结构柱", size=12, anchor="middle", fill="#444")
    svg.text(X(PILLAR_W / 2), Y(PILLAR_D / 2) + 22, f"{fmt_mm(mm(PILLAR_W))}×{fmt_mm(mm(PILLAR_D))}", size=11, anchor="middle", fill="#444")

    # Door clear opening note
    open_w = SHOP_W - PILLAR_W
    svg.line(X(PILLAR_W), Y(0), X(SHOP_W), Y(0), stroke=GREEN, sw=3)
    svg.text(X(PILLAR_W + open_w / 2), Y(0) - 14, f"门面可视开间 ≈ {fmt_m(open_w)}m", size=12, fill=GREEN, anchor="middle", weight="bold")

    # Front counter band
    x = 0.0
    segs = [
        (FRONT_MENU, "菜单灯箱\n柱面", WOOD),
        (FRONT_COUNTER, "收银/扫码台", GREEN_LT),
        (FRONT_GLASS, "玻璃观察面", "#E3F2FD"),
        (FRONT_PICKUP, "取货口", "#FFF3E0"),
        (FRONT_FRIDGE, "冷柜区", "#ECEFF1"),
    ]
    for w, label, color in segs:
        svg.rect(X(x), Y(0), W(w), W(COUNTER_D), fill=color, stroke=LINE, sw=1.2)
        svg.text(X(x + w / 2), Y(COUNTER_D / 2) + 5, label, size=11, anchor="middle")
        x += w

    # Glass prep room (plan)
    svg.rect(X(GLASS_X), Y(GLASS_Y), W(GLASS_W), W(GLASS_D), fill="#F1F8E9", stroke=GREEN, sw=2)
    svg.text(X(GLASS_X + GLASS_W / 2), Y(GLASS_Y + 0.35), "鲜切制作间（到顶玻璃）", size=13, anchor="middle", weight="bold", fill=GREEN)
    svg.rect(X(GLASS_X + 0.15), Y(GLASS_Y + 0.55), W(GLASS_W - 0.30), W(0.70), fill=WHITE, stroke=GRAY, sw=1)
    svg.text(X(GLASS_X + GLASS_W / 2), Y(GLASS_Y + 0.92), "不锈钢切配台", size=11, anchor="middle", fill=GRAY)
    svg.rect(X(GLASS_X + 0.15), Y(GLASS_Y + 1.45), W(0.55), W(0.45), fill=WHITE, stroke=GRAY, sw=1)
    svg.text(X(GLASS_X + 0.42), Y(GLASS_Y + 1.72), "洗手池", size=10, anchor="middle", fill=GRAY)
    svg.rect(X(GLASS_X + GLASS_W - 0.70), Y(GLASS_Y + 1.45), W(0.55), W(0.45), fill=WHITE, stroke=GRAY, sw=1)
    svg.text(X(GLASS_X + GLASS_W - 0.42), Y(GLASS_Y + 1.72), "消毒/工具", size=10, anchor="middle", fill=GRAY)

    # Pass-through aligned with pickup
    pu_x = FRONT_MENU + FRONT_COUNTER + FRONT_GLASS
    svg.rect(X(pu_x + 0.08), Y(0.05), W(FRONT_PICKUP - 0.16), W(0.35), fill="#FFE082", stroke=LINE, sw=1.2)
    svg.text(X(pu_x + FRONT_PICKUP / 2), Y(0.24), "传递窗", size=10, anchor="middle")

    # Display fridge footprint
    fr_x = SHOP_W - FRIDGE_W
    svg.rect(X(fr_x), Y(COUNTER_D), W(FRIDGE_W), W(FRIDGE_D), fill="#CFD8DC", stroke=LINE, sw=1.5)
    svg.text(X(fr_x + FRIDGE_W / 2), Y(COUNTER_D + FRIDGE_D / 2) + 5, "双门展示冷柜", size=11, anchor="middle")

    # Rear storage
    svg.rect(X(0.25), Y(SHOP_D - 0.65), W(0.55), W(0.55), fill=WHITE, stroke=GRAY, sw=1, dash="5,4")
    svg.text(X(0.52), Y(SHOP_D - 0.37), "储物", size=10, anchor="middle", fill=GRAY)

    # Customer zone
    svg.rect(X(PILLAR_W), Y(COUNTER_D), W(SHOP_W - PILLAR_W - FRIDGE_W - 0.15), W(0.75), fill=WHITE, stroke=GRAY, sw=1, dash="6,5")
    svg.text(X(PILLAR_W + 0.55), Y(COUNTER_D + 0.42), "顾客等候/取餐动线", size=11, fill=GRAY)

    # Dimensions
    svg.dim_h(X(0), X(SHOP_W), Y(SHOP_D), f"{fmt_mm(mm(SHOP_W))}", off=36)
    svg.dim_v(Y(0), Y(SHOP_D), X(SHOP_W), f"{fmt_mm(mm(SHOP_D))}", off=42)
    svg.dim_h(X(0), X(PILLAR_W), Y(PILLAR_D), f"柱 {fmt_mm(mm(PILLAR_W))}", off=22)
    svg.dim_v(Y(0), Y(PILLAR_D), X(0), f"{fmt_mm(mm(PILLAR_D))}", off=28)

    # Legend + title block
    lx = ox
    ly = oy + W(SHOP_D) + 88
    svg.legend_item(lx, ly, PILLAR, "结构柱（不可拆）")
    svg.legend_item(lx + 170, ly, GREEN_LT, "前场收银区")
    svg.legend_item(lx + 340, ly, "#F1F8E9", "玻璃封闭制作间")
    svg.legend_item(lx + 530, ly, "#CFD8DC", "展示冷柜")
    svg.title_block(svg.w - 390, svg.h - 150, "平面图", f"1:{int(scale)}")

    return svg


def build_elevation(scale: float = 50) -> Svg:
    margin = 180
    facade_w = px(SHOP_W, scale)
    facade_h = px(2.75, scale)
    svg = Svg(facade_w + margin * 2 + 220, facade_h + margin * 2 + 280, "正立面图")

    ox = margin + 110
    oy = margin + 90
    floor_y = oy + px(2.75, scale)

    def X(m: float) -> float:
        return ox + px(m, scale)

    def Y(m: float) -> float:
        return floor_y - px(m, scale)

    def W(m: float) -> float:
        return px(m, scale)

    def H(m: float) -> float:
        return px(m, scale)

    # Floor line
    svg.line(ox - 30, floor_y, ox + W(SHOP_W) + 30, floor_y, stroke=LINE, sw=2)
    svg.text(ox + W(SHOP_W) / 2, floor_y + 28, "走廊地面 ±0.00", size=13, fill=GRAY, anchor="middle")

    # Pillar mass at left
    svg.hatch(X(0), Y(PILLAR_D), W(PILLAR_W), H(PILLAR_D))
    svg.text(X(PILLAR_W / 2), Y(PILLAR_D / 2) + 5, "结构柱", size=12, anchor="middle")

    # Sign band
    sign_h = 0.42
    svg.rect(X(0), Y(2.75), W(SHOP_W), H(sign_h), fill=GREEN, stroke=LINE, sw=1.5)
    svg.text(X(SHOP_W / 2), Y(2.75 - sign_h / 2) + 8, "四季果先  SEASONAL FRUIT  ·  门头招牌（绿色铝塑/发光字）", size=13, anchor="middle", fill=WHITE, weight="bold")

    # Counter front
    counter_h = 0.95
    x = 0.0
    parts = [
        (FRONT_MENU, WOOD, "菜单灯箱"),
        (FRONT_COUNTER, WOOD, "木饰面柜台"),
        (FRONT_GLASS, "#E3F2FD", "钢化玻璃"),
        (FRONT_PICKUP, WOOD, "取货口"),
        (FRONT_FRIDGE, "#CFD8DC", "双门冷柜"),
    ]
    for w, color, label in parts:
        svg.rect(X(x), Y(counter_h), W(w), H(counter_h), fill=color, stroke=LINE, sw=1.2)
        if color == WOOD:
            svg.line(X(x + 0.04), Y(counter_h - 0.08), X(x + w - 0.04), Y(counter_h - 0.08), stroke="#FFFFFF88", sw=3)
        if color == "#E3F2FD":
            svg.rect(X(x + 0.06), Y(counter_h - 0.05), W(w - 0.12), H(counter_h - 0.55), fill="#FFFFFFAA", stroke=GREEN, sw=1.5)
            svg.text(X(x + w / 2), Y(counter_h - 0.62), "鲜切制作间", size=12, anchor="middle", fill=GREEN, weight="bold")
        if color == "#CFD8DC":
            svg.line(X(x + w / 2), Y(counter_h - 0.05), X(x + w / 2), Y(0.15), stroke=GRAY, sw=1.5)
            for gx in (0.18, 0.36, 0.64, 0.82):
                svg.line(X(x + w * gx), Y(counter_h - 0.05), X(x + w * gx), Y(0.15), stroke="#90A4AE", sw=0.8)
        svg.text(X(x + w / 2), Y(counter_h / 2) + 5, label, size=11, anchor="middle")
        x += w

    # Counter top
    svg.rect(X(0), Y(counter_h + 0.05), W(SHOP_W), H(0.05), fill=WHITE, stroke=LINE, sw=1)

    # Opening width dim
    svg.dim_h(X(PILLAR_W), X(SHOP_W), Y(0), f"可视开间 {fmt_m(SHOP_W - PILLAR_W)}m", off=24)
    svg.dim_h(X(0), X(SHOP_W), Y(2.75), f"总宽 {fmt_mm(mm(SHOP_W))}", off=40)
    svg.dim_v(Y(0), Y(2.75), X(0), f"{fmt_mm(mm(2750))}", off=36)

    lx = ox
    ly = floor_y + 72
    svg.legend_item(lx, ly, GREEN, "品牌绿色系")
    svg.legend_item(lx + 150, ly, WOOD, "木饰面/柜台")
    svg.legend_item(lx + 320, ly, "#E3F2FD", "玻璃制作间可视面")
    svg.title_block(svg.w - 390, svg.h - 150, "正立面图", f"1:{int(scale)}")

    return svg


def build_section(scale: float = 50) -> Svg:
    """Longitudinal section through prep room."""
    margin = 180
    sec_w = px(SHOP_D, scale)
    sec_h = px(2.75, scale)
    svg = Svg(sec_w + margin * 2 + 220, sec_h + margin * 2 + 260, "剖面图 A-A'（过制作间）")

    ox = margin + 110
    oy = margin + 90
    base = oy + sec_h

    def X(m: float) -> float:
        return ox + px(m, scale)

    def Y(m: float) -> float:
        return base - px(m, scale)

    def W(m: float) -> float:
        return px(m, scale)

    def H(m: float) -> float:
        return px(m, scale)

    svg.line(ox - 20, base, ox + W(SHOP_D), base, stroke=LINE, sw=2)
    svg.text(ox + W(SHOP_D) / 2, base + 26, "店铺进深方向", size=13, fill=GRAY, anchor="middle")

    # Floor slab
    svg.rect(X(0), Y(0.08), W(SHOP_D), H(0.08), fill="#9E9E9E", stroke=LINE, sw=1)

    # Front counter
    svg.rect(X(0), Y(COUNTER_D), W(COUNTER_D), H(COUNTER_D), fill=WOOD, stroke=LINE, sw=1.2)
    svg.rect(X(0), Y(COUNTER_D + 0.05), W(COUNTER_D + 0.05), H(0.05), fill=WHITE, stroke=LINE, sw=1)

    # Glass room
    g0 = GLASS_Y
    svg.rect(X(g0), Y(0.08), W(GLASS_D), H(2.45), fill="#F1F8E9", stroke=GREEN, sw=2)
    svg.line(X(g0), Y(2.45), X(g0 + GLASS_D), Y(2.45), stroke=GREEN, sw=2)
    svg.text(X(g0 + GLASS_D / 2), Y(1.35), "到顶钢化玻璃 + 铝合金框", size=12, anchor="middle", fill=GREEN, weight="bold")
    svg.rect(X(g0 + 0.25), Y(0.85), W(GLASS_D - 0.50), H(0.75), fill=WHITE, stroke=GRAY, sw=1)
    svg.text(X(g0 + GLASS_D / 2), Y(1.25), "切配台  H850", size=11, anchor="middle", fill=GRAY)

    # Back wall
    svg.line(X(SHOP_D), Y(0), X(SHOP_D), Y(2.75), stroke=LINE, sw=2.5)
    svg.text(X(SHOP_D - 0.15), Y(1.4), "后墙", size=12, anchor="end", fill=GRAY)

    svg.dim_h(X(0), X(SHOP_D), Y(0), f"进深 {fmt_mm(mm(SHOP_D))}", off=30)
    svg.dim_v(Y(0.08), Y(2.45), X(SHOP_D), "制作间净高 2450", off=40)
    svg.title_block(svg.w - 390, svg.h - 150, "剖面图 A-A'", f"1:{int(scale)}")
    return svg


def build_sheet() -> Svg:
    """Combined presentation sheet."""
    svg = Svg(2480, 3508, "四季果先 · 店铺装修施工图（比例依据实测尺寸）")
    svg.text(120, 110, "说明：左侧结构柱 1280×700 占用了门面左侧，故入口视觉开间约 2.65m；", size=15, fill=GRAY)
    svg.text(120, 138, "前场按效果图落地：菜单柱面 + 收银台 + 玻璃鲜切间 + 取货口 + 双门展示冷柜。", size=15, fill=GRAY)
    svg.text(120, 166, "制作间到顶玻璃封闭，洗切装均在内部完成，经传递窗交付。", size=15, fill=GRAY)

    specs = [
        ("铺位净尺寸", f"{fmt_m(SHOP_W)} m × {fmt_m(SHOP_D)} m  （约 {SHOP_W * SHOP_D:.1f} ㎡）"),
        ("结构柱", f"{fmt_mm(mm(PILLAR_W))} × {fmt_mm(mm(PILLAR_D))} mm（左前角）"),
        ("门面可视开间", f"{fmt_m(SHOP_W - PILLAR_W)} m（总宽 {fmt_m(SHOP_W)} m 减柱宽）"),
        ("前场柜台进深", f"{fmt_mm(mm(COUNTER_D))} mm"),
        ("玻璃制作间", f"{fmt_mm(mm(GLASS_W))} × {fmt_mm(mm(GLASS_D))} mm（到顶玻璃）"),
        ("展示冷柜", f"{fmt_mm(mm(FRIDGE_W))} × {fmt_mm(mm(FRIDGE_D))} mm 双门款"),
    ]
    y = 210
    for k, v in specs:
        svg.text(120, y, f"{k}：", size=14, weight="bold")
        svg.text(250, y, v, size=14, fill=GRAY)
        y += 28

    svg.rect(120, 430, 2240, 900, fill=WHITE, stroke=LINE, sw=1.5)
    svg.text(130, 460, "▌ 平面布置示意（1:50）", size=16, weight="bold", fill=GREEN)
    svg.text(130, 1280, "▌ 正立面（1:50）", size=16, weight="bold", fill=GREEN)
    svg.text(130, 2140, "▌ 剖面 A-A'（1:50）", size=16, weight="bold", fill=GREEN)
    svg.title_block(1860, 3220, "装修说明页", "1:50")
    return svg


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_plan().save(OUT_DIR / "shop-fitout-plan.svg")
    build_elevation().save(OUT_DIR / "shop-fitout-elevation.svg")
    build_section().save(OUT_DIR / "shop-fitout-section.svg")
    build_sheet().save(OUT_DIR / "shop-fitout-drawing-sheet.svg")
    print("Done. Open SVG in browser or import to CAD.")


if __name__ == "__main__":
    main()
