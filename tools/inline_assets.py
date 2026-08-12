#!/usr/bin/env python3
"""samples/screen-mock.html の画像参照を data URI に埋め込んで、単体で開ける HTML を作る。

共有用。リポジトリの外に持ち出しても画像が欠けない。

  python3 tools/inline_assets.py

出力: samples/screen-mock.standalone.html
"""
import base64
import io
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "samples/screen-mock.html")
DST = os.path.join(ROOT, "samples/screen-mock.standalone.html")

# 埋め込み時の最大幅。原寸のままだと共有ファイルが重くなりすぎる
MAX_WIDTH = {"bg": 1280, "planes": 640, "smoke": 150}


def encode(rel_path: str) -> str:
    abs_path = os.path.normpath(os.path.join(os.path.dirname(SRC), rel_path))
    kind = os.path.basename(os.path.dirname(abs_path))
    img = Image.open(abs_path)
    limit = MAX_WIDTH.get(kind, 800)
    if img.width > limit:
        img = img.resize((limit, round(img.height * limit / img.width)), Image.LANCZOS)

    buf = io.BytesIO()
    if img.mode == "RGBA":
        img.save(buf, "PNG", optimize=True)
        mime = "image/png"
    else:
        img.convert("RGB").save(buf, "JPEG", quality=84, optimize=True)
        mime = "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    html = open(SRC, encoding="utf-8").read()
    cache = {}

    def sub(m):
        rel = m.group(2)
        if rel not in cache:
            cache[rel] = encode(rel)
            print(f"  埋め込み: {rel}  ({len(cache[rel])//1024} KB)")
        return f"{m.group(1)}{cache[rel]}{m.group(3)}"

    # 先に、テンプレートリテラルで組み立てている煙のパスを実体に展開する
    html = html.replace(
        "const DARK  = [1,2,3,4].map(i=>`../assets/art/smoke/puff-dark-0${i}.png`);",
        "const DARK  = [" + ",".join(f'"{encode(f"../assets/art/smoke/puff-dark-0{i}.png")}"' for i in range(1, 5)) + "];",
    )
    html = html.replace(
        "const LIGHT = [1,2,3,4].map(i=>`../assets/art/smoke/puff-light-0${i}.png`);",
        "const LIGHT = [" + ",".join(f'"{encode(f"../assets/art/smoke/puff-light-0{i}.png")}"' for i in range(1, 5)) + "];",
    )

    # 残りの src="../assets/..." を置換する
    html = re.sub(r'(src=")(\.\./assets/[^"$]+)(")', sub, html)

    if "../assets/" in html:
        raise SystemExit("未解決の画像参照が残っています: " +
                         str(re.findall(r'\.\./assets/[^"\'`]+', html)[:5]))

    open(DST, "w", encoding="utf-8").write(html)
    print(f"-> {os.path.relpath(DST, ROOT)}  ({len(html)//1024} KB)")


if __name__ == "__main__":
    main()
