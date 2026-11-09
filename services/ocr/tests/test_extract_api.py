from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
LINES = ["P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<", "L898902C36UTO7408122F1204159ZE184226B<<<<<10"]


def test_refused_without_secret(monkeypatch):
    monkeypatch.setenv("OCR_SHARED_SECRET", "s3cret-for-tests")
    assert client.post("/mrz/parse", json={"lines": LINES}).status_code == 401
    assert client.post("/mrz/parse", json={"lines": LINES}, headers={"x-ocr-secret": "nope"}).status_code == 401


def test_refused_when_no_secret_configured(monkeypatch):
    monkeypatch.delenv("OCR_SHARED_SECRET", raising=False)
    assert client.post("/mrz/parse", json={"lines": LINES}, headers={"x-ocr-secret": ""}).status_code == 401


def test_parse_ok(monkeypatch):
    monkeypatch.setenv("OCR_SHARED_SECRET", "s3cret-for-tests")
    r = client.post("/mrz/parse", json={"lines": LINES}, headers={"x-ocr-secret": "s3cret-for-tests"})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is True and body["fields"]["surname"] == "ERIKSSON"


def test_bad_mrz_422_without_echo(monkeypatch):
    monkeypatch.setenv("OCR_SHARED_SECRET", "s3cret-for-tests")
    r = client.post("/mrz/parse", json={"lines": ["ABC", "DEF"]}, headers={"x-ocr-secret": "s3cret-for-tests"})
    assert r.status_code == 422 and "ABC" not in r.text
