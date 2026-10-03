"""Verify real exported PNG/mask pixels against the JSON inside a project ZIP.

Requires Pillow. Use the bundled workspace Python; this does not control a browser.
"""

import argparse
import base64
import io
import json
import zipfile

from PIL import Image


def verify(path, reference=None):
    checked = []
    with zipfile.ZipFile(path) as archive:
        project = json.loads(archive.read("imagegem_project.json"))
        if reference:
            with zipfile.ZipFile(reference) as original:
                expected = json.loads(original.read("imagegem_project.json"))
            for key in ("pixels", "mask", "palette", "hairPreset"):
                assert project[key] == expected[key], f"Project changed: {key}"

        pixels = base64.b64decode(project["pixels"])
        mask = base64.b64decode(project["mask"])
        assert len(pixels) == len(mask) == 4096
        palette = [tuple(bytes.fromhex(color[1:])) for color in project["palette"]]

        def check_image(name, scale, expected_at, avatar=False):
            with Image.open(io.BytesIO(archive.read(name))) as source:
                image = source.convert("RGBA")
            assert image.size == (64 * scale, 64 * scale), name
            data = image.load()
            for y in range(image.height):
                for x in range(image.width):
                    actual = data[x, y]
                    expected = expected_at((y // scale) * 64 + x // scale)
                    # RGB channels of fully transparent pixels are immaterial.
                    match = actual[3] == expected[3] and (
                        avatar and expected[3] == 0 or actual[:3] == expected[:3]
                    )
                    assert match, f"{name}: ({x},{y}) {actual} != {expected}"
            checked.append(name)

        def avatar_at(i):
            return (0, 0, 0, 0) if pixels[i] == 255 else (*palette[pixels[i]], 255)

        for name, scale in (
            ("imagegem_project_64x64.png", 1),
            ("renders/avatar_64x64_1x.png", 1),
            ("renders/avatar_256x256_4x.png", 4),
            ("renders/avatar_512x512_8x.png", 8),
        ):
            check_image(name, scale, avatar_at, avatar=True)

        zone_colors = [(0, 0, 0), (0, 229, 255), (34, 197, 94), (168, 85, 247), (255, 214, 0)]
        for name, scale in (
            ("masks/mask_5zone_composite_64x64.png", 1),
            ("masks/mask_5zone_composite_512x512_8x.png", 8),
        ):
            check_image(name, scale, lambda i: (*zone_colors[mask[i]], 255))

        for zone, name in enumerate(("background", "hair", "skin", "eyes", "clothes")):
            check_image(
                f"masks/layers/mask_{name}_64x64.png", 1,
                lambda i: (255, 255, 255, 255) if mask[i] == zone else (0, 0, 0, 255),
            )
    return {"zip": str(path), "result": "all pixels match project JSON", "verifiedImages": checked}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip")
    parser.add_argument("--reference", help="Optional original fixture ZIP")
    args = parser.parse_args()
    print(json.dumps(verify(args.zip, args.reference), ensure_ascii=False, indent=2))
