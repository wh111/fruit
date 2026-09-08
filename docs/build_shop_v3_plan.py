#!/usr/bin/env python3
"""新铺示意平面图 — 5.3m×4.2m，三面开敞，左下消火栓柱 1.4×1.6m，无客座。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
FONT_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

# 外框 mm
W_MM, D_MM = 5300, 4200
# 左下柱（沿开间×进深）
PW, PD = 1400, 1600

SCALE = 0.28  # px per mm
OX, OY = 220, 180


def px(mm: float) -> int:
    return int(round(mm * SCALE))


def font(size: int, bold: bool = False):
    return ImageFont.truetype(FONT_B if bold else FONT_R, size)


def main():
    img_w, img_h = 2200, 1700
    im = Image.new("RGB", (img_w, img_h), (250, 249, 245))
    d = ImageDraw.Draw(im)

    # title
    d.text((40, 36), "四季果先 · 新铺平面布置示意（无客座）", font=font(40, True), fill=(30, 30, 30))
    d.text(
        (40, 90),
        "外框约 5300×4200 · 左下消火栓柱 1400×1600 · 上侧实墙 · 其余三面开敞/玻璃 · 待现场复尺",
        font=font(22),
        fill=(90, 90, 90),
    )

    # coordinate: plan with wall at TOP of drawing
    # x: left→right along 5300, y: top wall→front along 4200
    def R(x_mm, y_mm, w_mm, d_mm):
        x0 = OX + px(x_mm)
        y0 = OY + px(y_mm)
        return [x0, y0, x0 + px(w_mm), y0 + px(d_mm)]

    # outer shop
    shop = R(0, 0, W_MM, D_MM)
    d.rectangle(shop, outline=(30, 30, 30), width=4)

    # back wall thicker
    d.line((shop[0], shop[1], shop[2], shop[1]), fill=(30, 30, 30), width=10)
    d.text((shop[0] + px(2100), shop[1] - 48), "实墙 5300", font=font(22, True), fill=(30, 30, 30))

    # open sides labels
    d.text((shop[0] - 90, shop[1] + px(1800)), "开\n敞", font=font(20), fill=(46, 125, 50))
    d.text((shop[2] + 16, shop[1] + px(1800)), "开\n敞", font=font(20), fill=(46, 125, 50))
    d.text((shop[0] + px(2200), shop[3] + 12), "开敞 / 门向（朝走廊）", font=font(20), fill=(46, 125, 50))

    # pillar bottom-left
    pillar = R(0, D_MM - PD, PW, PD)
    d.rectangle(pillar, fill=(220, 220, 220), outline=(120, 40, 40), width=3)
    # hatch
    x0, y0, x1, y1 = pillar
    for i in range(0, px(PW) + px(PD), 18):
        d.line((x0 + i, y0, x0, y0 + i), fill=(180, 140, 140), width=1)
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    d.text((cx - 50, cy - 28), "消火栓柱", font=font(22, True), fill=(120, 40, 40))
    d.text((cx - 70, cy + 6), "1400×1600", font=font(18), fill=(120, 40, 40))

    # storage top-left
    stor = R(0, 0, 1200, 1100)
    d.rectangle(stor, fill=(232, 245, 233), outline=(46, 125, 50), width=2)
    d.text((stor[0] + 24, stor[1] + 24), "储物间", font=font(26, True), fill=(27, 94, 32))
    d.text((stor[0] + 24, stor[1] + 60), "约1.2×1.1m", font=font(18), fill=(70, 70, 70))
    d.text((stor[0] + 24, stor[1] + 90), "原料/包材", font=font(18), fill=(70, 70, 70))

    # back workbench: sink + process + cold storage along wall (right of storage)
    work = R(1200, 0, 4100, 900)
    d.rectangle(work, fill=(255, 248, 225), outline=(245, 124, 0), width=2)
    # sink
    sink = R(1300, 100, 700, 600)
    d.rectangle(sink, fill=(187, 222, 251), outline=(21, 101, 192), width=2)
    d.text((sink[0] + 40, sink[1] + 80), "水池", font=font(24, True), fill=(13, 71, 161))
    # process
    proc = R(2100, 100, 1500, 700)
    d.rectangle(proc, fill=(255, 236, 179), outline=(245, 124, 0), width=2)
    d.text((proc[0] + 60, proc[1] + 60), "加工台", font=font(24, True), fill=(230, 81, 0))
    d.text((proc[0] + 40, proc[1] + 100), "果切 / 水果捞", font=font(18), fill=(90, 90, 90))
    # fridge cabinets
    fridge = R(3700, 50, 1500, 800)
    d.rectangle(fridge, fill=(227, 242, 253), outline=(2, 119, 189), width=2)
    d.text((fridge[0] + 40, fridge[1] + 50), "水果储藏冷柜", font=font(22, True), fill=(1, 87, 155))
    d.text((fridge[0] + 40, fridge[1] + 90), "原料冷藏", font=font(18), fill=(70, 70, 70))

    d.text((work[0] + 20, work[3] - 36), "靠实墙：水池 · 加工 · 储藏柜（连续操作台）", font=font(18), fill=(120, 70, 0))

    # glass partition - L shape / middle aisle
    # vertical glass from front of work area down, leaving path
    glass_v = R(1600, 1100, 60, 2000)
    d.rectangle(glass_v, fill=(200, 230, 255), outline=(66, 165, 245), width=2)
    d.text((glass_v[0] - 8, glass_v[1] + 80), "玻", font=font(18), fill=(21, 101, 192))
    d.text((glass_v[0] - 8, glass_v[1] + 110), "璃", font=font(18), fill=(21, 101, 192))

    # door in glass toward front-ish
    door = R(1550, 2800, 160, 60)
    d.rectangle(door, fill=(255, 255, 255), outline=(21, 101, 192), width=3)
    d.text((door[0] - 10, door[1] + 70), "门", font=font(20, True), fill=(21, 101, 192))

    # path label
    d.text((OX + px(2200), OY + px(2200)), "顾客通道", font=font(28, True), fill=(120, 120, 120))

    # right retail + service: railing / iron shelves / fruit / POS
    retail = R(4200, 1000, 1100, 2800)
    d.rectangle(retail, fill=(255, 243, 224), outline=(191, 54, 12), width=2)
    # iron shelves strips
    for i, label in enumerate(["铁架陈列", "精选零售水果", "成品展示"]):
        yy = 1100 + i * 700
        box = R(4300, yy, 900, 550)
        d.rectangle(box, fill=(255, 255, 255), outline=(191, 54, 12), width=1)
        d.text((box[0] + 30, box[1] + 40), label, font=font(20, True), fill=(191, 54, 12))

    # fence / counter toward open right side
    fence = R(5100, 1200, 80, 2200)
    d.rectangle(fence, fill=(161, 136, 127), outline=(93, 64, 55), width=2)
    d.text((fence[2] + 8, fence[1] + 200), "栅\n栏\n/\n服\n务\n台", font=font(18), fill=(78, 52, 46))

    # cash + small table outside right (as user drew)
    cash = R(5450, 1400, 500, 400) if False else None
    # keep within canvas: put annotation on right margin
    d.rounded_rectangle((OX + px(5400) - 40, OY + px(1300), OX + px(5400) + 200, OY + px(2100)), 12, fill=(255, 255, 255), outline=(30, 30, 30), width=2)
    # Actually shop is only 5300 wide - cash is at right edge inside
    pos = R(4450, 1050, 700, 450)
    d.rectangle(pos, fill=(236, 239, 241), outline=(55, 71, 79), width=2)
    d.text((pos[0] + 40, pos[1] + 40), "收银机", font=font(22, True), fill=(38, 50, 56))
    d.text((pos[0] + 40, pos[1] + 80), "取餐口旁", font=font(18), fill=(90, 90, 90))

    small = R(4450, 1550, 700, 350)
    d.rectangle(small, fill=(255, 255, 255), outline=(55, 71, 79), width=2)
    d.text((small[0] + 40, small[1] + 40), "小柜/容器", font=font(20, True), fill=(38, 50, 56))
    d.text((small[0] + 40, small[1] + 75), "杯盖勺/袋", font=font(18), fill=(90, 90, 90))

    # exit mark top-right of back wall
    d.text((OX + px(4800), OY - 48), "↑ 出口方向", font=font(20), fill=(198, 40, 40))

    # front entrance arrow
    d.polygon(
        [
            (OX + px(2800), OY + px(D_MM) + 70),
            (OX + px(3000), OY + px(D_MM) + 20),
            (OX + px(3200), OY + px(D_MM) + 70),
        ],
        fill=(46, 125, 50),
    )
    d.text((OX + px(2500), OY + px(D_MM) + 80), "主入口（人流动线）", font=font(22, True), fill=(46, 125, 50))

    # dimension ticks
    d.text((OX + px(W_MM) // 2 - 40, OY + px(D_MM) + 130), "开间 5300", font=font(24, True), fill=(30, 30, 30))
    d.text((OX + px(W_MM) + 30, OY + px(D_MM) // 2), "进深\n4200", font=font(24, True), fill=(30, 30, 30))

    # legend
    ly = img_h - 220
    d.rounded_rectangle((40, ly, img_w - 40, img_h - 30), 12, fill=(255, 255, 255), outline=(210, 210, 210), width=2)
    d.text((60, ly + 16), "图例与说明", font=font(24, True), fill=(30, 30, 30))
    d.text(
        (60, ly + 55),
        "· 无客桌椅，中间为取餐/通行通道  · 后墙连续操作：储物→水池→加工→冷柜  · 右侧零售铁架+栅栏服务面  · 左下柱为消火栓，不可封死需留检修面",
        font=font(18),
        fill=(70, 70, 70),
    )
    d.text(
        (60, ly + 95),
        "· 品牌：四季果先 · 现切现做 · 新鲜一小时  · 本图为布置示意，装修前请现场复尺后出 CAD",
        font=font(18),
        fill=(70, 70, 70),
    )
    d.text((60, ly + 135), "面积约 22.3㎡（5.3×4.2）", font=font(20, True), fill=(46, 125, 50))

    out = OUT / "shop-fitout-v3-plan.png"
    im.save(out, "PNG")
    print("wrote", out)


if __name__ == "__main__":
    main()
