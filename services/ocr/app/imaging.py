"""Safe image decoding and preparation for MRZ reading. Everything happens in memory: nothing is written to disk.

Untrusted input: only JPEG and PNG (checked by magic bytes, not by the client's Content-Type), a pixel cap that is
checked from the header before the pixels are decoded (decompression bombs), and a minimum size.
"""
from __future__ import annotations

import io
import warnings
from dataclasses import dataclass
from typing import Iterator

import numpy as np
from PIL import Image, ImageFilter, ImageOps

_JPEG = b"\xff\xd8\xff"
_PNG = b"\x89PNG\r\n\x1a\n"


class ImageRejected(Exception):
    """The image cannot be used; `reason` is a fixed code the caller can show ('retake the photo')."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def open_image(data: bytes, max_pixels: int, min_side: int) -> Image.Image:
    if not (data.startswith(_JPEG) or data.startswith(_PNG)):
        raise ImageRejected("format")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error")  # a decompression-bomb warning is a rejection, not a log line
            img = Image.open(io.BytesIO(data))
            w, h = img.size  # from the header: the pixels are not decoded yet
            if w * h > max_pixels:
                raise ImageRejected("too_large")
            if min(w, h) < min_side:
                raise ImageRejected("too_small")
            img.load()
    except ImageRejected:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ImageRejected("too_large") from None
    except Exception:  # noqa: BLE001 - truncated, corrupt or bomb: all the same to the caller
        raise ImageRejected("decode") from None
    img = ImageOps.exif_transpose(img)
    return ImageOps.grayscale(img)


@dataclass(frozen=True)
class Quality:
    width: int
    height: int
    sharpness: float
    contrast: float

    # Calibrated on synthetic MRZ photos (see tests); real-card testing may move these (hard gate 5).
    @property
    def blurry(self) -> bool:
        return self.sharpness < 150.0

    @property
    def low_contrast(self) -> bool:
        return self.contrast < 25.0

    def as_dict(self) -> dict:
        return {"width": self.width, "height": self.height, "blurry": self.blurry, "low_contrast": self.low_contrast}


def assess(gray: Image.Image) -> Quality:
    """Sharpness: variance of the Laplacian on a copy no wider than 1000 px. Contrast: grey-level spread."""
    small = gray if gray.width <= 1000 else gray.resize((1000, max(1, round(gray.height * 1000 / gray.width))))
    a = np.asarray(small, dtype=np.float32)
    lap = -4 * a[1:-1, 1:-1] + a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:]
    return Quality(gray.width, gray.height, float(lap.var()), float(a.std()))


def _prepare(img: Image.Image) -> Image.Image:
    """Scale to a width Tesseract reads well, then boost contrast. Never larger than needed (runtime)."""
    target = 1800
    if img.width < 1400 or img.width > 2400:
        img = img.resize((target, max(1, round(img.height * target / img.width))), Image.LANCZOS)
    return ImageOps.autocontrast(img, cutoff=1).filter(ImageFilter.SHARPEN)


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# (rotation, share of the image height, counted from the bottom, where the MRZ is expected)
_PLAN = ((0, 0.35), (0, 1.0), (180, 0.35), (180, 1.0), (90, 0.35), (270, 0.35))


def candidates(gray: Image.Image, limit: int) -> Iterator[tuple[str, bytes]]:
    """Crops worth sending to OCR, most likely first. `limit` bounds the OCR calls per image (runtime)."""
    for rotation, share in _PLAN[:limit]:
        im = gray.rotate(rotation, expand=True) if rotation else gray
        top = int(im.height * (1 - share))
        yield f"r{rotation}-{int(share * 100)}", _png(_prepare(im.crop((0, top, im.width, im.height))))
