#!/usr/bin/env python3
"""Build enriched property PPTX with correct image aspect ratios."""
from __future__ import annotations

import shutil
import struct
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path("/home/wujie/work/sijiguoxian")
OUT = ROOT / "docs" / "四季果先-经营说明（致物业）.pptx"
BUILD = Path("/tmp/sijiguoxian_pptx_build")

SW, SH = 12192000, 6858000  # 16:9
GREEN, ORANGE, DARK, GRAY = "4CAF50", "F5A623", "2C2C2C", "666666"
LIGHT, CARD = "F5F9F5", "FFFFFF"
MUTED = "F0F0F0"

LOGO = ROOT / "miniprogram/images/logo.png"
SHOP_MAIN = ROOT / "docs/shop-fitout-v2-highlight.png"
SHOP_ANGLE = ROOT / "docs/shop-fitout-v2-angle.png"
PRODUCTS = [
    (ROOT / "assets/products/menu/fruit-kirin-melon.png", "招牌麒麟瓜", "无黑籽 · 解渴引流"),
    (ROOT / "assets/products/menu/fruit-mango-cup.png", "芒果多多", "整杯芒果丁"),
    (ROOT / "assets/products/menu/fruit-mango-melon.png", "芒瓜双拼", "西瓜 + 芒果"),
    (ROOT / "assets/products/menu/fruit-green-grape.png", "阳光青提", "脆甜清口"),
    (ROOT / "assets/products/menu/fruit-dragon.png", "火龙鲜切", "红心火龙果"),
    (ROOT / "assets/products/menu/fruit-yuanqi-trip.png", "元气三拼", "芒果火龙蜜瓜"),
    (ROOT / "assets/products/menu/fruit-colorful-four.png", "缤纷四拼", "格子盒多拼"),
    (ROOT / "assets/products/menu/fruit-tropical.png", "热带风情", "芒果橙青提"),
]
PACKS = [
    (ROOT / "docs/packaging-cup-single.png", "标准单杯", "平盖透明杯 + 牛皮纸袋"),
    (ROOT / "docs/packaging-dome-cup-400.png", "400g 大份", "圆顶透明杯 + 纸袋"),
    (ROOT / "docs/packaging-grid-box.png", "多拼装", "四方格子盒 + 纸袋"),
]


def emu(inches: float) -> int:
    return int(inches * 914400)


def png_wh(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    return struct.unpack(">II", data[16:24])


def fit_box(max_w: int, max_h: int, iw: int, ih: int) -> tuple[int, int]:
    """Contain image in box, preserve aspect."""
    scale = min(max_w / iw, max_h / ih)
    return int(iw * scale), int(ih * scale)


def solid(color: str) -> str:
    return f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill>'


def sp_pr(x, y, w, h, fill=None, line=None) -> str:
    return f"""
      <p:spPr>
        <a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        {fill or "<a:noFill/>"}
        {line or "<a:ln><a:noFill/></a:ln>"}
      </p:spPr>"""


def text_box(x, y, w, h, lines, size=16, bold=False, color=DARK, align="l"):
    al = {"l": "l", "ctr": "ctr", "r": "r"}.get(align, "l")
    paras = []
    for item in lines:
        if isinstance(item, tuple):
            t, sz, b, c = item
        else:
            t, sz, b, c = item, size, bold, color
        if t == "":
            paras.append('<a:p><a:pPr algn="%s"/><a:endParaRPr lang="zh-CN"/></a:p>' % al)
            continue
        battr = ' b="1"' if b else ""
        paras.append(
            f"""
        <a:p>
          <a:pPr algn="{al}" spcBef="60" spcAft="60"/>
          <a:r>
            <a:rPr lang="zh-CN" sz="{int(sz * 100)}"{battr} dirty="0">
              {solid(c)}
              <a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/>
            </a:rPr>
            <a:t>{escape(t)}</a:t>
          </a:r>
        </a:p>"""
        )
    body = "".join(paras) or "<a:p/>"
    return f"""
    <p:sp>
      <p:nvSpPr><p:cNvPr id="{{ID}}" name="T"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
      {sp_pr(x, y, w, h)}
      <p:txBody>
        <a:bodyPr wrap="square" lIns="45720" tIns="22860" rIns="45720" bIns="22860"/>
        <a:lstStyle/>{body}
      </p:txBody>
    </p:sp>"""


def rect(x, y, w, h, color, line=None):
    ln = (
        f'<a:ln w="12700"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>'
        if line
        else '<a:ln><a:noFill/></a:ln>'
    )
    return f"""
    <p:sp>
      <p:nvSpPr><p:cNvPr id="{{ID}}" name="R"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      {sp_pr(x, y, w, h, fill=solid(color), line=ln)}
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>
    </p:sp>"""


def picture(x, y, w, h, rid, name="Pic"):
    return f"""
    <p:pic>
      <p:nvPicPr>
        <p:cNvPr id="{{ID}}" name="{escape(name)}"/>
        <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>
        <p:nvPr/>
      </p:nvPicPr>
      <p:blipFill>
        <a:blip r:embed="{rid}"/>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr>
        <a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:pic>"""


def picture_fit(box_x, box_y, box_w, box_h, path: Path, rid: str, name="Pic"):
    iw, ih = png_wh(path)
    w, h = fit_box(box_w, box_h, iw, ih)
    x = box_x + (box_w - w) // 2
    y = box_y + (box_h - h) // 2
    return picture(x, y, w, h, rid, name)


def assign_ids(xml: str) -> str:
    n = 2
    while "{ID}" in xml:
        xml = xml.replace("{ID}", str(n), 1)
        n += 1
    return xml


def slide_xml(shapes: str) -> str:
    shapes = assign_ids(shapes)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg><p:bgPr>{solid("FFFFFF")}<a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm>
        <a:off x="0" y="0"/><a:ext cx="{SW}" cy="{SH}"/>
        <a:chOff x="0" y="0"/><a:chExt cx="{SW}" cy="{SH}"/>
      </a:xfrm></p:grpSpPr>
      {shapes}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"""


def slide_rels(media: list[tuple[str, str]]) -> str:
    rels = [
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'
    ]
    for rid, target in media:
        rels.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{target}"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        + "\n".join(rels)
        + "\n</Relationships>\n"
    )


def header(title: str, subtitle: str = "") -> str:
    s = rect(0, 0, SW, emu(0.85), GREEN) + rect(0, emu(0.85), SW, emu(0.05), ORANGE)
    s += text_box(emu(0.45), emu(0.18), emu(12), emu(0.5), [(title, 22, True, "FFFFFF")])
    if subtitle:
        s += text_box(emu(0.45), emu(1.0), emu(12), emu(0.35), [(subtitle, 12, False, GRAY)])
    return s


def footer() -> str:
    return text_box(
        emu(0.45),
        emu(7.15),
        emu(12),
        emu(0.25),
        [("四季果先 · 经营说明（致物业）　王恒 18813017847", 9, False, "AAAAAA")],
    )


def card(x, y, w, h, title, body_lines, accent=GREEN):
    s = rect(x, y, w, h, CARD, "E8E8E8")
    s += rect(x, y, emu(0.08), h, accent)
    s += text_box(x + emu(0.25), y + emu(0.15), w - emu(0.4), emu(0.4), [(title, 15, True, accent)])
    items = []
    for b in body_lines:
        items.append((f"• {b}", 12, False, DARK))
    s += text_box(x + emu(0.25), y + emu(0.55), w - emu(0.4), h - emu(0.7), items)
    return s


def build():
    if BUILD.exists():
        shutil.rmtree(BUILD)
    ppt = BUILD / "ppt"
    for d in [
        ppt / "slides" / "_rels",
        ppt / "media",
        ppt / "slideLayouts" / "_rels",
        ppt / "slideMasters" / "_rels",
        ppt / "theme",
        BUILD / "_rels",
        ppt / "_rels",
    ]:
        d.mkdir(parents=True, exist_ok=True)

    media_index: dict[Path, str] = {}

    def add_media(path: Path) -> str:
        path = path.resolve()
        if path in media_index:
            return media_index[path]
        n = len(media_index) + 1
        ext = path.suffix.lower().lstrip(".") or "png"
        name = f"image{n}.{ext}"
        shutil.copy(path, ppt / "media" / name)
        media_index[path] = name
        return name

    slides: list[tuple[str, list[tuple[str, Path]]]] = []

    # ========== 1 Cover ==========
    add_media(LOGO)
    add_media(SHOP_MAIN)
    s = (
        rect(0, 0, SW, SH, "FFFFFF")
        + rect(0, 0, emu(0.18), SH, GREEN)
        + rect(emu(0.18), 0, emu(0.06), SH, ORANGE)
        + picture_fit(emu(5.2), emu(0.35), emu(2.8), emu(2.8), LOGO, "rId2", "logo")
        + text_box(
            emu(1),
            emu(3.2),
            emu(11.2),
            emu(0.6),
            [("四季果先 · 经营说明与品质保证方案", 26, True, DARK)],
            align="ctr",
        )
        + text_box(
            emu(1),
            emu(3.85),
            emu(11.2),
            emu(0.35),
            [("致物业管理方　｜　办公室鲜果 · 现切水果", 14, False, GRAY)],
            align="ctr",
        )
        + rect(emu(3.5), emu(4.5), emu(6.3), emu(2.0), LIGHT, "DCECDC")
        + text_box(
            emu(3.7),
            emu(4.65),
            emu(5.9),
            emu(1.7),
            [
                ("铺位约 12㎡　开间约 2.5m", 13, False, DARK),
                ("新发地百顺果业供货 · 冷藏现切", 13, False, DARK),
                ("固定2人：果切师 + 前台", 13, False, DARK),
                ("", 6, False, DARK),
                ("联系人：王恒　　18813017847", 14, True, GREEN),
            ],
            align="ctr",
        )
    )
    slides.append((s, [("rId2", LOGO)]))

    # ========== 2 定位（左右图文）==========
    add_media(SHOP_ANGLE)
    s = (
        header("01  我们是谁：写字楼里的现切鲜果店", "轻量化、看得见的干净、服务本楼上班族")
        + card(
            emu(0.4),
            emu(1.45),
            emu(6.3),
            emu(5.3),
            "经营内容",
            [
                "主营现切水果杯、拼盘与多拼",
                "到店清洗、分切、分装后冷藏售卖",
                "小程序扫码点餐 + 预约取餐",
                "顾客只到前场取餐，不进操作间",
                "成品经传递窗递出，公共区保持整洁",
                "品类聚焦果切，流程短、出餐快",
            ],
            GREEN,
        )
        + rect(emu(6.9), emu(1.45), emu(5.9), emu(5.3), MUTED)
        + picture_fit(emu(7.05), emu(1.6), emu(5.6), emu(5.0), SHOP_ANGLE, "rId2", "angle")
        + footer()
    )
    slides.append((s, [("rId2", SHOP_ANGLE)]))

    # ========== 3 装修主图（正确比例 3:2）==========
    add_media(SHOP_MAIN)
    s = (
        header("02  店铺效果图（拟落地装修）", "前场取餐收银 · 玻璃鲜切制作间 · 双门展示冷柜")
        + rect(emu(0.5), emu(1.35), emu(12.3), emu(5.4), MUTED)
        + picture_fit(emu(0.5), emu(1.35), emu(12.3), emu(5.4), SHOP_MAIN, "rId2", "shop")
        + footer()
    )
    slides.append((s, [("rId2", SHOP_MAIN)]))

    # ========== 4 空间拆解三卡片 + 局部图 ==========
    add_media(SHOP_MAIN)
    s = (
        header("03  空间怎么用", "分区清晰：看得见干净，切配不朝走廊敞开")
        + card(
            emu(0.35),
            emu(1.4),
            emu(4.0),
            emu(3.5),
            "前场 · 顾客区",
            [
                "双门展示冷柜陈列成品",
                "加长取餐/收银台",
                "扫码点餐、核销取餐",
                "不占用消防通道",
            ],
            ORANGE,
        )
        + card(
            emu(4.55),
            emu(1.4),
            emu(4.0),
            emu(3.5),
            "后场 · 操作间",
            [
                "到顶玻璃封闭制作间",
                "洗、切、装全在内部",
                "密闭门 + 传递窗出杯",
                "独立排风与日常消杀",
            ],
            GREEN,
        )
        + card(
            emu(8.75),
            emu(1.4),
            emu(4.0),
            emu(3.5),
            "现场条件",
            [
                "后墙、右墙围合",
                "左、前朝走廊敞开",
                "不遮挡路牌指示柱",
                "约 12㎡ / 开间约 2.5m",
            ],
            "5B8C5A",
        )
        + text_box(
            emu(0.4),
            emu(5.1),
            emu(12.5),
            emu(1.7),
            [
                ("作业边界", 14, True, GREEN),
                ("• 果切师在玻璃制作间内作业；前台负责接待与交付", 13, False, DARK),
                ("• 原料与成品分开放置；坏果、变质果不进入切配环节", 13, False, DARK),
                ("• 班后清洁消毒，垃圾密封投放至物业指定点位", 13, False, DARK),
            ],
        )
        + footer()
    )
    slides.append((s, []))

    # ========== 5 产品 8 图（正方形，正确比例）==========
    rels = []
    s = header("04  产品示意", "主打现切水果杯 / 拼盘 / 多拼 · 冷藏展示售卖")
    cols = 4
    cell = emu(2.85)
    gap = emu(0.2)
    ox, oy = emu(0.45), emu(1.25)
    for i, (path, name, desc) in enumerate(PRODUCTS):
        if not path.exists():
            continue
        row, col = divmod(i, cols)
        # fix: row = i // cols, col = i % cols
        row, col = i // cols, i % cols
        x = ox + col * (cell + gap)
        y = oy + row * (cell + emu(0.55))
        rid = f"rId{i + 2}"
        add_media(path)
        rels.append((rid, path))
        s += rect(x, y, cell, cell + emu(0.45), CARD, "EEEEEE")
        s += picture_fit(x + emu(0.08), y + emu(0.08), cell - emu(0.16), cell - emu(0.16), path, rid, name)
        s += text_box(
            x,
            y + cell - emu(0.02),
            cell,
            emu(0.45),
            [(name, 11, True, DARK), (desc, 9, False, GRAY)],
            align="ctr",
        )
    s += footer()
    slides.append((s, rels))

    # ========== 6 包装 ==========
    rels = []
    s = header("05  包装与交付", "透明杯看得见新鲜 · 牛皮纸袋控制成本")
    for i, (path, title, desc) in enumerate(PACKS):
        if not path.exists():
            continue
        x = emu(0.4) + i * emu(4.2)
        rid = f"rId{i + 2}"
        add_media(path)
        rels.append((rid, path))
        s += rect(x, emu(1.3), emu(4.0), emu(5.4), LIGHT, "DCECDC")
        s += picture_fit(x + emu(0.2), emu(1.45), emu(3.6), emu(3.6), path, rid, title)
        s += text_box(
            x + emu(0.15),
            emu(5.2),
            emu(3.7),
            emu(1.2),
            [(title, 14, True, GREEN), (desc, 11, False, DARK)],
            align="ctr",
        )
    s += footer()
    slides.append((s, rels))

    # ========== 7 进货（时间线风格）==========
    s = (
        header("06  进货与新鲜保障", "少囤勤进 · 冷藏保存 · 坏果绝不切售")
        + card(
            emu(0.4),
            emu(1.4),
            emu(6.2),
            emu(2.4),
            "进货渠道",
            [
                "北京新发地水果批发市场",
                "供应商：百顺果业",
                "同城物流配送到店",
            ],
            GREEN,
        )
        + card(
            emu(6.85),
            emu(1.4),
            emu(6.0),
            emu(2.4),
            "进货节奏",
            [
                "每周 2–3 次（视销量浮动）",
                "以销定进，避免长时间囤货",
                "到店验收后立即冷藏",
            ],
            ORANGE,
        )
        + card(
            emu(0.4),
            emu(4.0),
            emu(6.2),
            emu(2.6),
            "储存与使用",
            [
                "原料全程冷藏保存",
                "先进先出，当天优先使用",
                "分切后限时售卖与报废",
            ],
            "5B8C5A",
        )
        + card(
            emu(6.85),
            emu(4.0),
            emu(6.0),
            emu(2.6),
            "品质红线",
            [
                "坏果、变质果绝不切块销售",
                "异常原料当场隔离退换",
                "进货票据留存备查",
            ],
            "C45C26",
        )
        + footer()
    )
    slides.append((s, []))

    # ========== 8 流程（步骤条）==========
    steps = [
        ("01", "验收入冷藏", "到货验收\n合格入库"),
        ("02", "清洗沥干", "清洗消毒\n沥干备用"),
        ("03", "封闭间切配", "分切分装\n贴标完成"),
        ("04", "冷柜陈列", "展示冷藏\n传递出杯"),
        ("05", "扫码取餐", "核销交付\n顾客取走"),
        ("06", "班后清洁", "消毒归位\n垃圾清运"),
    ]
    s = header("07  标准化作业流程", "每一步可检查、可追溯")
    for i, (num, title, body) in enumerate(steps):
        x = emu(0.35) + i * emu(2.15)
        s += rect(x, emu(1.5), emu(2.0), emu(4.6), LIGHT, "DCECDC")
        s += rect(x, emu(1.5), emu(2.0), emu(0.7), GREEN)
        s += text_box(x, emu(1.55), emu(2.0), emu(0.6), [(num, 20, True, "FFFFFF")], align="ctr")
        s += text_box(x + emu(0.08), emu(2.4), emu(1.85), emu(0.7), [(title, 13, True, DARK)], align="ctr")
        lines = [(ln, 11, False, GRAY) for ln in body.split("\n")]
        s += text_box(x + emu(0.08), emu(3.3), emu(1.85), emu(2.4), lines, align="ctr")
    s += text_box(
        emu(0.4),
        emu(6.3),
        emu(12.4),
        emu(0.6),
        [("工具色标管理 · 砧板刀具班后消毒 · 操作间独立排风与日常消杀", 12, False, GRAY)],
        align="ctr",
    )
    s += footer()
    slides.append((s, []))

    # ========== 9 人员 ==========
    s = (
        header("08  人员配置（固定 2 人）", "岗位清晰 · 持证上岗 · 切配不离开操作间")
        + rect(emu(0.5), emu(1.45), emu(6.0), emu(5.2), LIGHT, "DCECDC")
        + rect(emu(0.5), emu(1.45), emu(6.0), emu(0.7), GREEN)
        + text_box(emu(0.5), emu(1.55), emu(6.0), emu(0.5), [("果切师 × 1", 18, True, "FFFFFF")], align="ctr")
        + text_box(
            emu(0.7),
            emu(2.4),
            emu(5.6),
            emu(3.8),
            [
                ("核心职责", 13, True, GREEN),
                ("• 原料验收、清洗、切配、分装", 13, False, DARK),
                ("• 操作间卫生、消杀与工具管理", 13, False, DARK),
                ("• 冷藏储存与先进先出", 13, False, DARK),
                ("• 坏果隔离，不进入销售环节", 13, False, DARK),
                ("", 8, False, DARK),
                ("工作边界", 13, True, GREEN),
                ("• 作业区域限定在玻璃制作间内", 13, False, DARK),
                ("• 成品通过传递窗交予前台", 13, False, DARK),
            ],
        )
        + rect(emu(6.8), emu(1.45), emu(6.0), emu(5.2), "FFF8F0", "F5D9B8")
        + rect(emu(6.8), emu(1.45), emu(6.0), emu(0.7), ORANGE)
        + text_box(emu(6.8), emu(1.55), emu(6.0), emu(0.5), [("前台 × 1", 18, True, "FFFFFF")], align="ctr")
        + text_box(
            emu(7.0),
            emu(2.4),
            emu(5.6),
            emu(3.8),
            [
                ("核心职责", 13, True, ORANGE),
                ("• 接待、扫码点餐、取餐核销", 13, False, DARK),
                ("• 展示冷柜陈列与前场卫生", 13, False, DARK),
                ("• 客诉对接与物业日常沟通", 13, False, DARK),
                ("• 高峰协助传递与出餐节奏", 13, False, DARK),
                ("", 8, False, DARK),
                ("合规要求", 13, True, ORANGE),
                ("• 全员持健康证上岗", 13, False, DARK),
                ("• 岗前卫生与操作规范培训", 13, False, DARK),
            ],
        )
        + footer()
    )
    slides.append((s, []))

    # ========== 10 卫生 ==========
    s = (
        header("09  卫生与物业协同", "污水、垃圾、消杀按物业要求执行")
        + card(
            emu(0.35),
            emu(1.4),
            emu(4.1),
            emu(5.2),
            "店内卫生",
            [
                "操作间班前班后清洁",
                "垃圾桶加盖放操作间内",
                "台面、地面无积水积渣",
                "刀具砧板日消日洁",
                "展示柜定期擦拭消毒",
            ],
            GREEN,
        )
        + card(
            emu(4.65),
            emu(1.4),
            emu(4.1),
            emu(5.2),
            "污水与垃圾",
            [
                "清洗用水走指定下水",
                "不外溢至公共走廊",
                "果皮果渣日产日清",
                "密封投放指定点位",
                "不在走廊堆放杂物",
            ],
            ORANGE,
        )
        + card(
            emu(8.95),
            emu(1.4),
            emu(4.1),
            emu(5.2),
            "公共秩序",
            [
                "门缝密封、门底刷",
                "定期消杀防虫害",
                "不占用消防通道",
                "取餐有序、减少拥堵",
                "配合物业检查整改",
            ],
            "5B8C5A",
        )
        + footer()
    )
    slides.append((s, []))

    # ========== 11 证照 ==========
    s = (
        header("10  证照与合法经营", "证照齐全后正式营业 · 票据备查")
        + card(
            emu(0.5),
            emu(1.5),
            emu(6.0),
            emu(5.0),
            "证照安排",
            [
                "营业执照",
                "食品经营许可（以核准范围为准）",
                "从业人员健康证",
                "开业前完成相关审批与公示",
            ],
            GREEN,
        )
        + card(
            emu(6.8),
            emu(1.5),
            emu(6.0),
            emu(5.0),
            "日常合规",
            [
                "小程序仅服务本店点餐/预约取餐",
                "不改变现场经营性质",
                "进货票据、台账留存备查",
                "证照按要求公示或备查",
            ],
            ORANGE,
        )
        + footer()
    )
    slides.append((s, []))

    # ========== 12 承诺 ==========
    add_media(LOGO)
    s = (
        header("11  我们的承诺", "对物业、对顾客、对自己的基本要求")
        + text_box(
            emu(0.6),
            emu(1.4),
            emu(8.5),
            emu(4.2),
            [
                ("1. 按报批业态规范经营，配合物业管理制度", 15, False, DARK),
                ("2. 勤进快销、冷藏储存，坏果绝不切块销售", 15, False, DARK),
                ("3. 封闭操作、分区作业，保持公共区域整洁", 15, False, DARK),
                ("4. 固定持证人员，切配不进入公共走廊作业", 15, False, DARK),
                ("5. 遇问题及时响应，按物业通知整改到位", 15, False, DARK),
                ("", 10, False, DARK),
                ("恳请物业给予支持，共同维护楼内环境与秩序。", 13, False, GRAY),
            ],
        )
        + rect(emu(9.3), emu(1.5), emu(3.5), emu(4.0), LIGHT, "DCECDC")
        + picture_fit(emu(9.6), emu(1.7), emu(2.9), emu(2.2), LOGO, "rId2", "logo")
        + text_box(
            emu(9.4),
            emu(4.1),
            emu(3.3),
            emu(1.2),
            [
                ("王恒", 16, True, GREEN),
                ("18813017847", 14, True, DARK),
                ("四季果先", 12, False, GRAY),
            ],
            align="ctr",
        )
        + footer()
    )
    slides.append((s, [("rId2", LOGO)]))

    # write slides
    for i, (shapes, media_rels) in enumerate(slides, 1):
        (ppt / "slides" / f"slide{i}.xml").write_text(slide_xml(shapes), encoding="utf-8")
        rel_media = []
        for rid, path in media_rels:
            fname = media_index[path.resolve()]
            rel_media.append((rid, f"../media/{fname}"))
        (ppt / "slides" / "_rels" / f"slide{i}.xml.rels").write_text(
            slide_rels(rel_media), encoding="utf-8"
        )

    n = len(slides)
    sld_ids = "\n".join(f'<p:sldId id="{255 + i}" r:id="rId{i}"/>' for i in range(1, n + 1))
    (ppt / "presentation.xml").write_text(
        f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId{n + 1}"/></p:sldMasterIdLst>
  <p:sldIdLst>{sld_ids}</p:sldIdLst>
  <p:sldSz cx="{SW}" cy="{SH}"/><p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
""",
        encoding="utf-8",
    )
    pres_rels = [
        f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>'
        for i in range(1, n + 1)
    ]
    pres_rels.append(
        f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
    )
    pres_rels.append(
        f'<Relationship Id="rId{n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>'
    )
    (ppt / "_rels" / "presentation.xml.rels").write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        + "\n".join(pres_rels)
        + "\n</Relationships>\n",
        encoding="utf-8",
    )

    (ppt / "slideMasters" / "slideMaster1.xml").write_text(
        f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:bg><p:bgPr>{solid("FFFFFF")}<a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{SW}" cy="{SH}"/><a:chOff x="0" y="0"/><a:chExt cx="{SW}" cy="{SH}"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>
""",
        encoding="utf-8",
    )
    (ppt / "slideMasters" / "_rels" / "slideMaster1.xml.rels").write_text(
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>
""",
        encoding="utf-8",
    )
    (ppt / "slideLayouts" / "slideLayout1.xml").write_text(
        f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{SW}" cy="{SH}"/><a:chOff x="0" y="0"/><a:chExt cx="{SW}" cy="{SH}"/></a:xfrm></p:grpSpPr>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
""",
        encoding="utf-8",
    )
    (ppt / "slideLayouts" / "_rels" / "slideLayout1.xml.rels").write_text(
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>
""",
        encoding="utf-8",
    )
    (ppt / "theme" / "theme1.xml").write_text(
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="四季果先">
  <a:themeElements>
    <a:clrScheme name="四季果先">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="2C2C2C"/></a:dk2>
      <a:lt2><a:srgbClr val="F5F9F5"/></a:lt2>
      <a:accent1><a:srgbClr val="4CAF50"/></a:accent1>
      <a:accent2><a:srgbClr val="F5A623"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill>
        <a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="100000"/><a:shade val="100000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="50000"/><a:shade val="100000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="0"/></a:gradFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>
""",
        encoding="utf-8",
    )

    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    ]
    for i in range(1, n + 1):
        overrides.append(
            f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        )
    (BUILD / "[Content_Types].xml").write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="xml" ContentType="application/xml"/>\n'
        '  <Default Extension="png" ContentType="image/png"/>\n'
        '  <Default Extension="jpg" ContentType="image/jpeg"/>\n'
        + "\n".join(overrides)
        + "\n</Types>\n",
        encoding="utf-8",
    )
    (BUILD / "_rels" / ".rels").write_text(
        """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>
""",
        encoding="utf-8",
    )

    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in BUILD.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(BUILD).as_posix())
    print(f"OK {OUT} slides={n} media={len(media_index)}")


if __name__ == "__main__":
    build()
