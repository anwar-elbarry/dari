import asyncio
import logging
import os
import re
import tempfile
import threading
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import engine
from app.config import Settings
from app.main import create_app
from tests.mrz_fixtures import TD3_LINE1, TD3_LINE2, build_td3
from tests.render import mrz_page, to_bytes

SECRET = "correct-horse-battery-staple-0123456789"
H = {"X-Worker-Secret": SECRET, "Content-Type": "image/png"}
IMAGE = to_bytes(mrz_page([TD3_LINE1, TD3_LINE2]))


def client(**overrides) -> TestClient:
    settings = Settings(shared_secret=SECRET, **overrides)
    return TestClient(create_app(settings))


def test_extracts_with_the_secret():
    r = client().post("/v1/extract", content=IMAGE, headers=H)
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["fields"]["document_number"] == "L898902C3"
    assert r.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("headers", [{}, {"X-Worker-Secret": ""}, {"X-Worker-Secret": "wrong"}, {"X-Worker-Secret": SECRET[:-1]}, {"X-Worker-Secret": SECRET + "x"}, {"Authorization": f"Bearer {SECRET}"}])
def test_refuses_a_missing_or_wrong_secret_before_reading_the_body(headers):
    r = client().post("/v1/extract", content=IMAGE, headers=headers)
    assert r.status_code == 401 and r.json() == {"error": "unauthorized"}


def test_refuses_to_start_without_a_strong_secret():
    with pytest.raises(RuntimeError):
        Settings.from_env({})
    with pytest.raises(RuntimeError):
        Settings.from_env({"OCR_SHARED_SECRET": "short"})
    assert Settings.from_env({"OCR_SHARED_SECRET": "x" * 32}).shared_secret == "x" * 32


def test_no_docs_or_openapi_are_exposed():
    c = client()
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert c.get(path).status_code == 404


def test_oversized_bodies_are_refused_by_header_and_by_stream():
    c = client(max_bytes=10_000)
    assert c.post("/v1/extract", content=IMAGE, headers=H).status_code == 413  # Content-Length says too big

    def chunks():  # chunked upload: no Content-Length to check up front
        for _ in range(20):
            yield b"x" * 1000

    assert c.post("/v1/extract", content=chunks(), headers=H).status_code == 413


def test_empty_body():
    assert client().post("/v1/extract", content=b"", headers=H).status_code == 400


def test_bad_input_is_a_normal_answer_not_a_server_error():
    c = client()
    for body in (b"not an image", b"\x89PNG\r\n\x1a\n" + b"junk" * 50, IMAGE[:500]):
        r = c.post("/v1/extract", content=body, headers=H)
        assert r.status_code == 200 and r.json()["status"] == "unreadable"


def test_engine_missing_is_a_503(monkeypatch):
    def boom(png, timeout):
        raise engine.EngineUnavailable()

    c = TestClient(create_app(Settings(shared_secret=SECRET), ocr=boom))
    r = c.post("/v1/extract", content=IMAGE, headers=H)
    assert r.status_code == 503 and r.json() == {"error": "engine_unavailable"}


def test_concurrency_is_bounded_and_excess_requests_get_503():
    release = threading.Event()
    running = []

    def slow(png, timeout):
        running.append(1)
        release.wait(5)
        return ""

    settings = Settings(shared_secret=SECRET, max_concurrency=1, queue_timeout_s=0.3, max_ocr_calls=1)
    app = create_app(settings, ocr=slow)

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://w") as c:
            first = asyncio.create_task(c.post("/v1/extract", content=IMAGE, headers=H))
            await asyncio.sleep(0.2)
            second = await c.post("/v1/extract", content=IMAGE, headers=H)
            release.set()
            return second, await first

    second, first = asyncio.run(go())
    assert second.status_code == 503 and second.headers["retry-after"] == "5"
    assert first.status_code == 200 and len(running) == 1


def test_the_worker_keeps_nothing_on_disk(tmp_path, monkeypatch):
    """Runs a real extraction with the temp directory and working directory watched, and every Python temp-file
    API made to fail: a multipart parser or library that spooled the image to disk would break here."""
    monkeypatch.setenv("TMPDIR", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    tempfile.tempdir = str(tmp_path)

    def forbidden(*a, **k):
        raise AssertionError("the worker tried to create a temporary file")

    for name in ("NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile", "mkstemp", "mkdtemp"):
        monkeypatch.setattr(tempfile, name, forbidden)

    r = client().post("/v1/extract", content=IMAGE, headers=H)
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert list(Path(tmp_path).iterdir()) == []
    tempfile.tempdir = None


def test_no_content_reaches_the_logs(caplog):
    caplog.set_level(logging.DEBUG)
    r = client().post("/v1/extract", content=to_bytes(mrz_page(build_td3(surname="ZZQUIVER", number="L7A4C9K37"))), headers=H)
    assert r.status_code == 200
    client().post("/v1/extract", content=b"junk", headers={**H, "X-Worker-Secret": "nope"})
    logged = caplog.text + " ".join(str(r.getMessage()) for r in caplog.records)
    for secret in ("ZZQUIVER", "L7A4C9K37", "1990-01-31", "LEA"):
        assert secret not in logged


def test_the_source_has_no_logging_or_print_calls():
    """Belt and braces for the test above: the worker must not log at all."""
    for path in Path(__file__).resolve().parent.parent.joinpath("app").glob("*.py"):
        text = path.read_text()
        assert not re.search(r"\bimport logging\b|\bprint\(|\blogger\.", text), path.name


def test_the_response_never_contains_the_image():
    r = client().post("/v1/extract", content=IMAGE, headers=H)
    assert IMAGE[:64] not in r.content and len(r.content) < 3000


def test_the_process_environment_is_not_passed_to_tesseract():
    """Tesseract runs with a minimal environment: the shared secret must not be visible to the child process."""
    src = Path(engine.__file__).read_text()
    assert "env={" in src and "os.environ" not in src
