#!/usr/bin/env python3
"""四季果先 · 玻璃贴（产品介绍 · 白字割字）

参考茶铺窗贴：左对齐白字 +「|」分隔，无底图无彩图。
成品建议：约 1800 × 900 mm（贴在玻璃中左眼平高度即可，不必铺满）。
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PHOTO_A = Path(
    "/home/wujie/.cursor/projects/home-wujie-work-sijiguoxian/assets/"
    "_____20261112152043_190_208-860c273f-987c-4fec-81bb-0aafbe881bf4.png"
)
PHOTO_B = Path(
    "/home/wujie/.cursor/projects/home-wujie-work-sijiguoxian/assets/"
    "_____20261112152035_189_208-eb6b70c9-3a8b-47f5-a470-f889a8961030.png"
)
REF = Path(
    "/home/wujie/.cursor/projects/home-wujie-work-sijiguoxian/assets/"
    "b2fb90902614f85745377d7d9891791c-879e0422-fe25-42f0-bb02-0578d738bd6b.png"
)

FONT_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_M = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"

# 贴块尺寸：像参考图那样一块菜单，不铺满整面玻璃
PRINT_W_MM = 1800
PRINT_H_MM = 900
DPI = 150

# 产品介绍 + 活动（白字 | 分隔）
ROWS = [
    "鲜果切杯 | 水果捞 | 免洗什锦",
    "现切现做 | 新鲜40分钟",
    "周五会员日 | 无门槛券",
    "充值有礼 | 提前订更优惠",
    "小盒什锦 | 饭后来一盒",
]


def mm(ppm: float, v: float) -> int:
    return int(round(v * ppm))


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size=size)
    except OSError:
        return ImageFont.truetype(FONT_R, size=size)


def tsize(fnt, text: str) -> tuple[int, int]:
    b = fnt.getbbox(text)
    return b[2] - b[0], b[3] - b[1]


def make_decal(W: int, H: int) -> Image.Image:
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 字号接近参考：一行菜单感，不要巨大招牌字
    fnt = font(FONT_R, max(36, int(H * 0.095)))
    line_gap = max(28, int(H * 0.085))

    # 测算总高，垂直略偏上（眼平）
    heights = [tsize(fnt, row)[1] for row in ROWS]
    total_h = sum(heights) + line_gap * (len(ROWS) - 1)
    y = max(int(H * 0.12), (H - total_h) // 3)
    x = int(W * 0.08)

    for row, th in zip(ROWS, heights):
        # 纯白字，轻微描边增强玻璃可读
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            draw.text((x + dx, y + dy), row, font=fnt, fill=(255, 255, 255, 50))
        draw.text((x, y), row, font=fnt, fill=(255, 255, 255, 235))
        y += th + line_gap

    return img


def mock(photo: Path, out: Path, region: tuple[float, float, float, float]) -> None:
    if not photo.exists():
        return
    base = Image.open(photo).convert("RGBA")
    W, H = base.size
    l, t, r, b = region
    x0, y0, x1, y1 = int(W * l), int(H * t), int(W * r), int(H * b)
    decal = make_decal(max(1, x1 - x0), max(1, y1 - y0))
    composed = base.copy()
    composed.alpha_composite(decal, (x0, y0))
    composed.convert("RGB").save(out, quality=93)
    print("wrote", out.name)


def main() -> None:
    ppm = DPI / 25.4
    W, H = mm(ppm, PRINT_W_MM), mm(ppm, PRINT_H_MM)
    decal = make_decal(W, H)

    png = ROOT / "四季果先-玻璃贴-产品介绍-透明底.png"
    decal.save(png)
    # 兼容旧文件名
    decal.save(ROOT / "四季果先-玻璃贴-活动卖点-透明底.png")
    print("wrote", png.name, decal.size)

    preview = Image.new("RGB", (W, H), (55, 62, 58))
    preview.paste(decal, (0, 0), decal)
    preview.save(ROOT / "四季果先-玻璃贴-产品介绍-预览.jpg", quality=92)
    thumb = preview.copy()
    thumb.thumbnail((1400, 800), Image.Resampling.LANCZOS)
    thumb.save(ROOT / "四季果先-玻璃贴-产品介绍-字样预览.jpg", quality=92)
    thumb.save(ROOT / "四季果先-玻璃贴-活动卖点-字样预览.jpg", quality=92)

    # 贴在玻璃中左，类似参考图位置
    mock(PHOTO_B, ROOT / "效果示意-通道正面.jpg", (0.30, 0.14, 0.72, 0.58))
    mock(PHOTO_A, ROOT / "效果示意-店内视角.jpg", (0.28, 0.18, 0.74, 0.60))

    y = 220
    size = 78
    svg_rows = []
    for row in ROWS:
        svg_rows.append(
            f'<text x="120" y="{y}" font-family="Noto Sans CJK SC, Source Han Sans SC, sans-serif" '
            f'font-size="{size}" fill="#FFFFFF">{row}</text>'
        )
        y += size + 70
    (ROOT / "四季果先-玻璃贴-产品介绍.svg").write_text(
        f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="{PRINT_W_MM}mm" height="{PRINT_H_MM}mm"
     viewBox="0 0 {PRINT_W_MM} {PRINT_H_MM}">
  <title>四季果先 · 玻璃贴产品介绍 · 白字割字</title>
  <desc>无底色，仅白字；工艺：PVC白字镂空贴 / 白透割字</desc>
  {''.join(svg_rows)}
</svg>
""",
        encoding="utf-8",
    )
    # 旧名指向同内容
    (ROOT / "四季果先-玻璃贴-活动卖点.svg").write_text(
        (ROOT / "四季果先-玻璃贴-产品介绍.svg").read_text(encoding="utf-8"),
        encoding="utf-8",
    )

    (ROOT / "README.md").write_text(
        f"""# 四季果先 · 玻璃贴（产品介绍 · 白字）

## 尺寸（给广告店）
**{PRINT_W_MM} × {PRINT_H_MM} mm**  
贴玻璃**中左眼平**即可，不要铺满整面。

## 工艺
白字镂空贴（像茶铺窗贴），无底、无彩图。

## 文案
{chr(10).join('- ' + r for r in ROWS)}

## 文件
- `四季果先-玻璃贴-产品介绍.svg` ← 优先用这个割字
- `四季果先-玻璃贴-产品介绍-透明底.png`
""",
        encoding="utf-8",
    )
    print("done")


if __name__ == "__main__":
    main()
