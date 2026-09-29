"""Image bytes in, assistive MRZ reading out. Orchestrates decode -> quality -> OCR candidates -> parser."""
from __future__ import annotations

from datetime import date
from typing import Callable

from app import imaging, mrz
from app.config import Settings
from app.engine import run_tesseract

Ocr = Callable[[bytes, float], str]


def extract(data: bytes, settings: Settings, ocr: Ocr = run_tesseract, today: date | None = None) -> dict:
    """Returns a JSON-safe dict with `status`: ok (every check digit passes on a clean read), partial (an MRZ was
    read but some checks fail or a field was repaired), no_mrz (nothing MRZ-shaped found: manual entry) or
    unreadable (the image itself is unusable: retake). Never raises for bad input."""
    try:
        gray = imaging.open_image(data, settings.max_pixels, settings.min_side)
    except imaging.ImageRejected as e:
        return {"status": "unreadable", "reason": e.reason}

    quality = imaging.assess(gray)
    best: mrz.MrzResult | None = None
    for _label, png in imaging.candidates(gray, settings.max_ocr_calls):
        result = mrz.parse_text(ocr(png, settings.tesseract_timeout_s), today)
        if result is None:
            continue
        if best is None or (result.all_checks_pass, result.confidence) > (best.all_checks_pass, best.confidence):
            best = result
        if best.all_checks_pass:
            break

    if best is None:
        return {"status": "no_mrz", "quality": quality.as_dict()}
    return {
        "status": "ok" if best.all_checks_pass else "partial",
        "quality": quality.as_dict(),
        "format": best.format,
        "fields": best.fields,
        "checks": best.checks,
        "flagged": best.flagged,
        "corrected": best.corrected,
        "unverified": best.unverified,
        "confidence": best.confidence,
    }
