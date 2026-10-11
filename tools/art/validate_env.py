#!/usr/bin/env python3
"""Validate environment art (tileset, backgrounds, shared atlases) against
src/game/data/assets.ts and tiles.ts. Exit 1 on failure.

Checks: tileset size 256 x (rows for TILE_COUNT); every ATLAS.<key>.frames name exists; every anim has
>= 2 frames `<anim>_0..n` contiguous; frames inside the sheet; hard alpha; sky layers
opaque 270px tall; far/mid/near 270 tall with width a multiple of 480 and opaque
pixels only in the lower part; logo / world-map present.
"""
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
A = os.path.join(ROOT, "public", "assets")
errors = []


def parse_atlas_contract():
    src = open(os.path.join(ROOT, "src/game/data/assets.ts")).read()
    body = src[src.index("export const ATLAS = {"):src.index("} as const;", src.index("export const ATLAS = {"))]
    out = {}
    for m in re.finditer(r"\n  (\w+): \{(.*?)\n  \},", body, re.S):
        key = m.group(1)
        blk = m.group(2)
        def arr(name):
            mm = re.search(name + r":\s*\[(.*?)\]", blk, re.S)
            return re.findall(r"'([^']+)'", mm.group(1)) if mm else []
        out[key] = (arr("frames"), arr("anims"))
    return out


def check_hard_alpha(im, label):
    a = im.getchannel("A")
    bad = [v for v, n in enumerate(a.histogram()) if n and v not in (0, 255)]
    if bad:
        errors.append(f"{label}: soft alpha values {bad[:5]}")


def main():
    t = Image.open(os.path.join(A, "tilesets", "chicago-tiles.png"))
    ts = open(os.path.join(ROOT, "src/game/data/tiles.ts")).read()
    count = int(re.search(r"TILE_COUNT = (\d+)", ts).group(1))
    if t.size != (256, ((count + 15) // 16) * 16):
        errors.append(f"tileset size {t.size} for {count} tiles")
    check_hard_alpha(t.convert("RGBA"), "tileset")
    for key, (frames, anims) in parse_atlas_contract().items():
        jp = os.path.join(A, key + ".json")
        if not os.path.exists(jp):
            errors.append(f"missing atlas {key}")
            continue
        data = json.load(open(jp))["frames"]
        sheet = Image.open(os.path.join(A, key + ".png")).convert("RGBA")
        check_hard_alpha(sheet, key)
        for f in frames:
            if f not in data:
                errors.append(f"{key}: missing frame {f}")
        for an in anims:
            n = 0
            while f"{an}_{n}" in data:
                n += 1
            if n < 2:
                errors.append(f"{key}: anim {an} has {n} frames")
            sizes = {(data[f"{an}_{i}"]["frame"]["w"], data[f"{an}_{i}"]["frame"]["h"]) for i in range(n)}
            if len(sizes) > 1:
                errors.append(f"{key}: anim {an} mixed sizes {sizes}")
        for name, fr in data.items():
            r = fr["frame"]
            if r["x"] + r["w"] > sheet.width or r["y"] + r["h"] > sheet.height:
                errors.append(f"{key}:{name} outside sheet")
            elif sheet.crop((r["x"], r["y"], r["x"] + r["w"], r["y"] + r["h"])).getbbox() is None:
                errors.append(f"{key}:{name} empty")
    # every auto-tiled material has the full 48-slot layout
    mats = re.search(r"export const MATERIALS = \[(.*?)\]", ts).group(1)
    sufs = re.search(r"export const MATERIAL_SUFFIXES = \[(.*?)\]", ts).group(1)
    names = set(re.findall(r"^\s+([A-Z_0-9]+): \d+,", ts, re.M))
    for m in re.findall(r"'(\w+)'", mats):
        for suf in re.findall(r"'(\w+)'", sufs):
            if f"{m}_{suf}" not in names:
                errors.append(f"tiles.ts: material {m} lacks {m}_{suf}")
    # World 2 ambient sprites used by Ambient.ts
    amb = json.load(open(os.path.join(A, "ambient.json")))["frames"]
    for f in ("train_night", "sail_0", "sail_1", "sail_2", "butterfly_0", "butterfly_1", "butterfly_2", "mote",
              "ufo_0", "ufo_1", "beam", "flare"):
        if f not in amb:
            errors.append(f"ambient: missing frame {f}")
    themes = re.search(r"export type LevelTheme = (.*?);", open(os.path.join(ROOT, "src/game/types.ts")).read()).group(1)
    for theme in re.findall(r"'(\w+)'", themes):
        for layer in ("sky", "clouds", "far", "mid", "near"):
            p = os.path.join(A, "backgrounds", f"bg-{theme}-{layer}.png")
            if not os.path.exists(p):
                errors.append(f"missing {p}")
                continue
            im = Image.open(p).convert("RGBA")
            if layer == "clouds":
                check_hard_alpha(im, p)
                continue
            if im.height != 270 or im.width % 480:
                errors.append(f"{p}: size {im.size}")
            check_hard_alpha(im, p)
            if layer == "sky" and im.getchannel("A").getextrema()[0] != 255:
                errors.append(f"{p}: sky not opaque")
            if layer != "sky":
                bb = im.getbbox()
                if bb and bb[1] < 40:
                    errors.append(f"{p}: content reaches y={bb[1]}")
                # columns 0 and w-1 should continue each other (wrap); just ensure both drawn similarly
    for f in ("logo.png", "world-map.png"):
        if not os.path.exists(os.path.join(A, f)):
            errors.append(f"missing {f}")
    if errors:
        print("\n".join(errors))
        sys.exit(1)
    print("environment art OK")


if __name__ == "__main__":
    main()
