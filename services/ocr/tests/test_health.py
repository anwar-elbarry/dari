from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health():
    r = TestClient(create_app(Settings(shared_secret="s" * 32))).get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
