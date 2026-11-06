#!/usr/bin/env python3
"""Generate compressed product thumbs for miniprogram.

list  : max 480px jpeg q72  (~列表)
detail: max 800px jpeg q78  (~详情)
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'products'
OUT = ROOT / 'thumbs'
SIZES = [('list', 480, 72), ('detail', 800, 78)]


def main():
    imgs = [
        p
        for p in ROOT.rglob('*')
        if p.is_file()
        and p.suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}
        and 'thumbs' not in p.parts
    ]
    print('source', len(imgs))
    for label, max_side, quality in SIZES:
        n = 0
        for src in imgs:
            rel = src.relative_to(ROOT)
            dest = OUT / label / rel.with_suffix('.jpg')
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
                continue
            im = Image.open(src).convert('RGB')
            w, h = im.size
            scale = min(1.0, max_side / max(w, h))
            if scale < 1:
                im = im.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
            im.save(dest, 'JPEG', quality=quality, optimize=True, progressive=True)
            n += 1
        print(label, 'wrote', n)


if __name__ == '__main__':
    main()
