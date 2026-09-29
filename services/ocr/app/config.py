"""Worker settings, read once at start-up. The worker refuses to start without a shared secret: it must never
answer unauthenticated extraction requests (it is reachable on the private network only, as defence in depth)."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    shared_secret: str
    max_bytes: int = 10 * 1024 * 1024
    max_pixels: int = 40_000_000
    min_side: int = 400
    max_concurrency: int = 2
    queue_timeout_s: float = 10.0
    tesseract_timeout_s: float = 20.0
    max_ocr_calls: int = 6

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        secret = env.get("OCR_SHARED_SECRET", "")
        if len(secret) < 32:
            raise RuntimeError("OCR_SHARED_SECRET must be set to at least 32 characters (openssl rand -base64 32)")
        return Settings(
            shared_secret=secret,
            max_bytes=int(env.get("OCR_MAX_BYTES", 10 * 1024 * 1024)),
            max_pixels=int(env.get("OCR_MAX_PIXELS", 40_000_000)),
            max_concurrency=max(1, int(env.get("OCR_MAX_CONCURRENCY", 2))),
            tesseract_timeout_s=float(env.get("OCR_TESSERACT_TIMEOUT_S", 20)),
        )
