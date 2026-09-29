"""Document extraction worker (OCR/MRZ). Self-hosted by design: ID images must not leave our infrastructure
without a CNDP cross-border assessment (Tech Spec 1 & 7). Output is assistive: the guest reviews every field.

Contract with the API (apps/api): POST /v1/extract with the raw image bytes as the body (no multipart: multipart
parsers spool large uploads to disk, and this worker keeps nothing on disk) and the shared secret in
`X-Worker-Secret`. The response never echoes the image. Request bodies and OCR text are never logged.
"""
from __future__ import annotations

import asyncio
import hmac
from typing import Callable

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from app import engine
from app.config import Settings
from app.extract import Ocr, extract


def _error(status: int, code: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": code}, status_code=status, headers={"Cache-Control": "no-store", **(headers or {})})


def create_app(settings: Settings, ocr: Ocr = engine.run_tesseract) -> FastAPI:
    app = FastAPI(title="dari-ocr", docs_url=None, redoc_url=None, openapi_url=None)
    slots = asyncio.Semaphore(settings.max_concurrency)
    secret = settings.shared_secret.encode()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.post("/v1/extract")
    async def extract_endpoint(request: Request, x_worker_secret: str | None = Header(default=None)):
        # Authenticate before reading a single byte of the body. Constant-time compare; missing and wrong look the same.
        if x_worker_secret is None or not hmac.compare_digest(x_worker_secret.encode(), secret):
            return _error(401, "unauthorized")

        declared = request.headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > settings.max_bytes):
            return _error(413, "too_large")
        chunks: list[bytes] = []
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > settings.max_bytes:  # chunked uploads carry no Content-Length: count as we go
                return _error(413, "too_large")
            chunks.append(chunk)
        if total == 0:
            return _error(400, "empty")
        data = b"".join(chunks)

        try:
            await asyncio.wait_for(slots.acquire(), timeout=settings.queue_timeout_s)
        except asyncio.TimeoutError:
            return _error(503, "busy", {"Retry-After": "5"})
        try:
            result = await run_in_threadpool(extract, data, settings, ocr)
        except engine.EngineUnavailable:
            return _error(503, "engine_unavailable")
        finally:
            slots.release()
        return JSONResponse(result, headers={"Cache-Control": "no-store"})

    return app
