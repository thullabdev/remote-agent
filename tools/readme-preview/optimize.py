"""Trims the empty margins around an image, scales it to a width, and shrinks it to a palette PNG.

Usage: python3 optimize.py <raw.png> <output.png> [width]   (width defaults to 1600)
Needs Pillow. With libimagequant support the soft shadows stay smooth; without it the image is saved as a plain
RGBA PNG, which is larger.
"""
import sys

from PIL import Image

MARGIN = 80  # pixels at 2x scale, so 40 CSS pixels


def main(source: str, target: str, width: int) -> None:
    image = Image.open(source).convert("RGBA")
    visible = image.getchannel("A").point(lambda value: 255 if value > 6 else 0)
    box = visible.getbbox()
    if box is None:
        raise SystemExit("optimize: the image is empty")
    left, top, right, bottom = box
    image = image.crop(
        (
            max(left - MARGIN, 0),
            max(top - MARGIN, 0),
            min(right + MARGIN, image.width),
            min(bottom + MARGIN, image.height),
        )
    )
    height = round(image.height * width / image.width)
    image = image.resize((width, height), Image.LANCZOS)
    try:
        image = image.quantize(colors=256, method=Image.Quantize.LIBIMAGEQUANT)
    except (ValueError, OSError):
        print("optimize: libimagequant is not available; saving an unquantized PNG", file=sys.stderr)
    image.save(target, optimize=True)
    print(f"optimize: wrote {target} ({width}x{height})")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) == 4 else 1600)
