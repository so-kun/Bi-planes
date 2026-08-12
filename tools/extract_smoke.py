#!/usr/bin/env python3
"""煙あり版のイラストから、煙の「ひと粒」スプライトを切り出す。

被弾したときの煙は、この粒をパーティクルとして連続で出して再現する。
焼き込みの絵をそのまま使うと煙の量を変えられないため、粒に分解しておく。

  python3 tools/extract_smoke.py   （先に tools/cutout.py を実行しておくこと）

切り出し位置は原本 (1536x1024) の座標で、機体に重ならない範囲から選んである。
切り口が目立たないよう、外周は緩やかに透明へ落とす。
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/art/planes/plane-blue-smoke.png")
OUT = os.path.join(ROOT, "assets/art/smoke")

# 濃い煙（煙が出はじめの、機首寄りの部分）
DARK = [(175, 245, 345, 415), (555, 20, 755, 220), (700, 20, 900, 215), (790, 60, 990, 260)]
# 薄い煙（流れて散りはじめた、後方の部分）
LIGHT = [(930, 30, 1130, 230), (1030, 90, 1220, 280), (1160, 95, 1340, 275), (860, 150, 1050, 340)]

# 外周をぼかす幅（短辺に対する割合）
FEATHER = 0.16


def feather(img: Image.Image) -> Image.Image:
    a = np.asarray(img).astype(np.float64)
    h, w = a.shape[:2]
    pad = max(4, int(min(h, w) * FEATHER))

    def ramp(n):
        r = np.ones(n)
        t = np.linspace(0, np.pi / 2, pad)
        r[:pad] = np.sin(t) ** 2
        r[-pad:] = np.sin(t[::-1]) ** 2
        return r

    mask = ramp(h)[:, None] * ramp(w)[None, :]
    a[..., 3] *= mask
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def main():
    if not os.path.exists(SRC):
        raise SystemExit("先に tools/cutout.py を実行してください")
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert("RGBA")

    for kind, boxes in (("dark", DARK), ("light", LIGHT)):
        for i, box in enumerate(boxes, 1):
            puff = feather(src.crop(box))
            dst = os.path.join(OUT, f"puff-{kind}-{i:02d}.png")
            puff.save(dst)
            print(f"puff-{kind}-{i:02d}: {puff.size} -> {os.path.relpath(dst, ROOT)}")


if __name__ == "__main__":
    main()
