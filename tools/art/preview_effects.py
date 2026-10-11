#!/usr/bin/env python3
"""
Animated previews of the effects atlas over the real day and sunset backgrounds.

  python3 tools/art/preview_effects.py [anim ...]

Writes art/previews/fx-anim-<anim>.gif (4x, day | sunset, timed with the fps table in
src/game/systems/AnimationSystem.ts) and art/previews/fx-strips.png (every frame of
every anim, both backgrounds, 3x) + fx-strip-<anim>.png (4x).
"""
import json
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from pxl import ASSETS, PREVIEWS, ROOT, draw_text, Cv  # noqa: E402

SCALE = 4


def fps_table():
    src = open(os.path.join(ROOT, "src/game/systems/AnimationSystem.ts")).read()
    body = src[src.index("const FPS"):src.index("};", src.index("const FPS"))]
    return {m.group(1): int(m.group(2)) for m in re.finditer(r"(\w+): (\d+)", body)}


def backdrop(theme, w, h, y=150, x=200):
    base = Image.new("RGBA", (480, 270), (0, 0, 0, 255))
    for layer in ("sky", "far", "mid"):
        im = Image.open(os.path.join(ASSETS, "backgrounds", f"bg-{theme}-{layer}.png")).convert("RGBA")
        base.alpha_composite(im.crop((0, 0, 480, 270)))
    return base.crop((x - w // 2, y - h // 2, x - w // 2 + w, y - h // 2 + h))


def load_frames():
    sheet = Image.open(os.path.join(ASSETS, "effects.png")).convert("RGBA")
    data = json.load(open(os.path.join(ASSETS, "effects.json")))["frames"]
    groups = {}
    for name, f in data.items():
        m = re.match(r"^(.*)_(\d+)$", name)
        fr = f["frame"]
        im = sheet.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"]))
        if m and m.group(1) not in ("debris",):
            groups.setdefault(m.group(1), []).append((int(m.group(2)), im))
    return {k: [im for _, im in sorted(v, key=lambda t: t[0])] for k, v in groups.items()}


def panel(frame, theme):
    pad = 8
    w, h = frame.width + pad * 2, frame.height + pad * 2
    bg = backdrop(theme, w, h, y=110 if theme == "day" else 150)
    bg.alpha_composite(frame, (pad, pad))
    return bg


def main(only):
    fps = fps_table()
    groups = load_frames()
    strip_rows = []
    for name, frames in groups.items():
        if only and name not in only:
            continue
        rate = fps.get(name, 10)
        out = []
        for im in frames + [Image.new("RGBA", frames[0].size, (0, 0, 0, 0))] * 3:
            a, b = panel(im, "day"), panel(im, "sunset")
            row = Image.new("RGBA", (a.width * 2 + 4, a.height), (30, 30, 40, 255))
            row.paste(a, (0, 0))
            row.paste(b, (a.width + 4, 0))
            out.append(row.resize((row.width * SCALE, row.height * SCALE), Image.NEAREST).convert("RGB"))
        out[0].save(
            os.path.join(PREVIEWS, f"fx-anim-{name}.gif"), save_all=True, append_images=out[1:],
            duration=[int(1000 / rate)] * len(frames) + [int(1000 / rate)] * 2 + [400], loop=0,
        )
        # strip row: frames on day over frames on sunset
        cells = [(panel(im, "day"), panel(im, "sunset")) for im in frames]
        cw = cells[0][0].width
        chh = cells[0][0].height
        row = Image.new("RGBA", (len(cells) * (cw + 2) + 2, chh * 2 + 14), (30, 30, 40, 255))
        for k, (a, b) in enumerate(cells):
            row.paste(a, (2 + k * (cw + 2), 10))
            row.paste(b, (2 + k * (cw + 2), 12 + chh))
        cv = Cv(1, 1)
        cv.im, cv.w, cv.h, cv.px = row, row.width, row.height, row.load()
        draw_text(cv, 2, 2, f"{name.replace('_', '-')} {len(frames)}F {rate}FPS", (255, 255, 255, 255))
        strip_rows.append(row)
        row.resize((row.width * SCALE, row.height * SCALE), Image.NEAREST).save(
            os.path.join(PREVIEWS, f"fx-strip-{name}.png"))
    if not only:
        W = max(r.width for r in strip_rows)
        H = sum(r.height + 4 for r in strip_rows)
        sheet = Image.new("RGBA", (W, H), (30, 30, 40, 255))
        y = 0
        for r in strip_rows:
            sheet.paste(r, (0, y))
            y += r.height + 4
        sheet = sheet.resize((W * 3, H * 3), Image.NEAREST)
        sheet.save(os.path.join(PREVIEWS, "fx-strips.png"))
    print("previews ok")


if __name__ == "__main__":
    main(set(sys.argv[1:]))
