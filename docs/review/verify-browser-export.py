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


def compare_exports(before, after):
    """Compare logical archive contents; only project timestamps may differ."""
    pngs = []
    identical_files = []
    with zipfile.ZipFile(before) as original, zipfile.ZipFile(after) as migrated:
        assert sorted(original.namelist()) == sorted(migrated.namelist()), "Archive file list changed"
        for name in original.namelist():
            a, b = original.read(name), migrated.read(name)
            if name.endswith(".png"):
                with Image.open(io.BytesIO(a)) as source:
                    old_image = source.convert("RGBA")
                with Image.open(io.BytesIO(b)) as source:
                    new_image = source.convert("RGBA")
                assert old_image.size == new_image.size, f"Image dimensions changed: {name}"
                assert old_image.tobytes() == new_image.tobytes(), f"Image pixels changed: {name}"
                pngs.append(name)
            elif name == "imagegem_project.json":
                old_project, new_project = json.loads(a), json.loads(b)
                old_project.pop("ts", None)
                new_project.pop("ts", None)
                assert old_project == new_project, "Project changed beyond timestamp"
            elif name == "README.txt":
                # Export-time human-readable date is intentionally variable.
                old_lines = [line for line in a.decode().splitlines() if not line.startswith("导出时间:")]
                new_lines = [line for line in b.decode().splitlines() if not line.startswith("导出时间:")]
                assert old_lines == new_lines, "README changed beyond export time"
            else:
                assert a == b, f"Archive entry changed: {name}"
                if not name.endswith("/"):
                    identical_files.append(name)
    return {"result": "archive contents match except timestamps", "identicalPngPixels": pngs, "identicalFiles": identical_files}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip")
    parser.add_argument("--reference", help="Optional original fixture ZIP")
    parser.add_argument("--compare-export", help="Compare all PNGs and logical archive contents with a prior export")
    args = parser.parse_args()
    result = verify(args.zip, args.reference)
    if args.compare_export:
        result["comparison"] = compare_exports(args.compare_export, args.zip)
    print(json.dumps(result, ensure_ascii=False, indent=2))
