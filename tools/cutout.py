#!/usr/bin/env python3
"""提供イラストの紙地を抜いて、ゲーム用の透過 PNG を作る。

原本 (assets/art/original/) から加工物を再生成する。原本は書き換えない。

  python3 tools/cutout.py

やっていること:
  1. 画像の縁から紙の色を推定する
  2. 紙の色との距離が小さい画素を「紙の候補」とする
  3. candidate のうち画像の縁とつながっている塊＝外側の紙地。ここを透明にする
     （機体の内側にある紙色の面 ―― 赤機のクリーム色の胴体など ―― は
       黒い輪郭線で囲まれていて縁とつながらないので、誤って抜けない）
  4. 支柱や張線の間にできる小さな囲まれた紙の隙間も透明にする
  5. 透明にする領域でも、紙との差が残る画素は薄く残す。
     プロペラの回転ブラーのような淡い線が消えないようにするため
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/art/original")
OUT_PLANES = os.path.join(ROOT, "assets/art/planes")
OUT_BG = os.path.join(ROOT, "assets/art/bg")
OUT_PROPS = os.path.join(ROOT, "assets/art/props")

# 機体（側面・上面・下面）。
# 上面図・下面図は煙なしの差し替え版（末尾 2）を使う。煙ありの初版は参考として残す
PLANES = (
    "plane-blue", "plane-red", "plane-blue-smoke",
    "plane-blue-top2", "plane-blue-under2",
    "plane-red-top2", "plane-red-under2",
)
# その他の絵（気球など）
PROPS = ("baloon",)

# 紙とみなす色距離の上限。これを超える画素は「絵」として不透明で残す
BG_TOLERANCE = 42.0
# 透明領域の中で、薄い線として残しはじめる距離。
# 紙のざらつきは実測で 3x3 平滑後 10 前後までなので、その上から残しはじめる
FAINT_LO, FAINT_HI = 13.0, 34.0
# 囲まれた紙の隙間とみなす面積の上限（画素数）
HOLE_MAX_AREA = 4000
# 面積が大きくても、紙との平均距離がこれ未満なら本物の紙地とみなして抜く。
# 実測: 残った紙地は 8〜10、機体のクリーム色の塗装面は 15〜21 で分離できる
HOLE_MAX_MEAN_DIST = 13.0


def paper_color(rgb: np.ndarray) -> np.ndarray:
    ring = np.concatenate([
        rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3),
        rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3),
    ])
    return np.median(ring, axis=0)


def cut_paper(path: str):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    paper = paper_color(rgb)
    dist = np.sqrt(((rgb - paper) ** 2).sum(axis=2))

    cand = dist < BG_TOLERANCE
    labels, n = ndimage.label(cand)

    # 縁に接している塊 = 外側の紙地
    edge_ids = set(labels[0]) | set(labels[-1]) | set(labels[:, 0]) | set(labels[:, -1])
    edge_ids.discard(0)
    background = np.isin(labels, list(edge_ids))

    # 囲まれた紙の隙間（支柱の間、煙と翼に挟まれた面など）も抜く。
    # 小さいもの、または紙との平均距離が十分小さいものが対象。
    # 機体のクリーム色の塗装面は平均距離が大きいので、この判定では抜けない
    if n:
        areas = np.bincount(labels.ravel(), minlength=n + 1)
        means = ndimage.mean(dist, labels, index=range(1, n + 1))
        holes = [i for i in range(1, n + 1)
                 if i not in edge_ids
                 and (areas[i] <= HOLE_MAX_AREA or means[i - 1] < HOLE_MAX_MEAN_DIST)]
        if holes:
            background |= np.isin(labels, holes)

    # 淡い線を残すため、透明領域は距離に応じた段階的な alpha にする。
    # 平滑してから判定することで、紙のざらつき（孤立した画素）は消え、
    # プロペラのブラーのような連続した線だけが残る
    smooth = ndimage.uniform_filter(dist, size=3)
    ramp = np.clip((smooth - FAINT_LO) / (FAINT_HI - FAINT_LO), 0.0, 1.0)
    alpha = np.where(background, ramp, 1.0)

    # 紙の上に薄く乗っている線は、紙の色を差し引いて本来のインク色に戻す
    a = alpha[..., None]
    ink = np.where(a > 0.15, (rgb - (1 - a) * paper) / np.maximum(a, 1e-6), rgb)
    out = np.dstack([np.clip(ink, 0, 255), alpha * 255]).astype(np.uint8)

    # 余白を落とす
    ys, xs = np.where(alpha > 0.04)
    if len(ys):
        m = 6
        y0, y1 = max(0, ys.min() - m), min(out.shape[0], ys.max() + m + 1)
        x0, x1 = max(0, xs.min() - m), min(out.shape[1], xs.max() + m + 1)
        out = out[y0:y1, x0:x1]
    return Image.fromarray(out, "RGBA")


def main():
    os.makedirs(OUT_PLANES, exist_ok=True)
    os.makedirs(OUT_BG, exist_ok=True)
    os.makedirs(OUT_PROPS, exist_ok=True)

    for out_dir, names in ((OUT_PLANES, PLANES), (OUT_PROPS, PROPS)):
        for name in names:
            src = os.path.join(SRC, f"{name}.png")
            if not os.path.exists(src):
                print(f"skip (原本なし): {name}")
                continue
            img = cut_paper(src)
            dst = os.path.join(out_dir, f"{name}.png")
            img.save(dst)
            print(f"{name}: {img.size} -> {os.path.relpath(dst, ROOT)}")

    bg_src = os.path.join(SRC, "stage-sunset.png")
    if os.path.exists(bg_src):
        bg = Image.open(bg_src).convert("RGB").resize((1280, 720), Image.LANCZOS)
        dst = os.path.join(OUT_BG, "stage-sunset.png")
        bg.save(dst)
        print(f"stage-sunset: {bg.size} -> {os.path.relpath(dst, ROOT)}")


if __name__ == "__main__":
    main()
