"""Tesseract, driven through stdin/stdout only: the image goes in as bytes and text comes back, so no temporary
file is ever created (the worker keeps nothing on disk). Output text is never logged."""
from __future__ import annotations

import shutil
import subprocess

_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"


class EngineUnavailable(Exception):
    pass


def available() -> bool:
    return shutil.which("tesseract") is not None


def run_tesseract(png: bytes, timeout_s: float) -> str:
    if not available():
        raise EngineUnavailable()
    cmd = [
        "tesseract", "stdin", "stdout", "-l", "eng", "--psm", "6",
        "-c", f"tessedit_char_whitelist={_WHITELIST}",
        "-c", "load_system_dawg=0", "-c", "load_freq_dawg=0",
    ]
    try:
        done = subprocess.run(cmd, input=png, capture_output=True, timeout=timeout_s, check=False, env={"PATH": "/usr/bin:/usr/local/bin", "OMP_THREAD_LIMIT": "1"})
    except subprocess.TimeoutExpired:
        return ""
    return done.stdout.decode("utf-8", "ignore") if done.returncode == 0 else ""
