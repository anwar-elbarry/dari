"""Renders synthetic MRZ 'photos' for tests: fictional data in a monospaced font on a white page. No real documents."""
from __future__ import annotations

import io
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"


def mrz_page(lines: list[str], size: int = 44, width: int | None = None, header: bool = True) -> Image.Image:
    font = ImageFont.truetype(FONT, size)
    char_w = font.getlength("<")
    text_w = int(char_w * max(len(line) for line in lines))
    w = width or text_w + 120
    h = int(size * 1.6 * (len(lines) + (5 if header else 1)))
    img = Image.new("L", (w, h), 245)
    d = ImageDraw.Draw(img)
    y = 30
    if header:  # non-MRZ text above the zone, as on a real data page
        for text in ("PASSPORT / PASSEPORT", "SURNAME / NOM   SPECIMEN", "GIVEN NAMES / PRENOMS   TEST", "DATE OF BIRTH   12 AUG 74"):
            d.text((60, y), text, font=ImageFont.truetype(FONT, int(size * 0.6)), fill=40)
            y += int(size * 1.0)
    y = h - int(size * 1.6 * len(lines)) - 20
    for line in lines:
        d.text((60, y), line, font=font, fill=15)
        y += int(size * 1.6)
    return img


def to_bytes(img: Image.Image, fmt: str = "PNG", quality: int = 88) -> bytes:
    buf = io.BytesIO()
    img.convert("L" if fmt == "JPEG" else img.mode).save(buf, fmt, **({"quality": quality} if fmt == "JPEG" else {}))
    return buf.getvalue()


def blurred(img: Image.Image, radius: float = 7) -> Image.Image:
    return img.filter(ImageFilter.GaussianBlur(radius))


def noise(width: int, height: int, seed: int = 1) -> Image.Image:
    rnd = random.Random(seed)
    img = Image.new("L", (width, height))
    img.putdata([rnd.randrange(256) for _ in range(width * height)])
    return img
