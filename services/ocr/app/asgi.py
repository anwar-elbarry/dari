"""Production entry point: `uvicorn app.asgi:app --no-access-log`. Fails at start-up without OCR_SHARED_SECRET."""
from app.config import Settings
from app.main import create_app

app = create_app(Settings.from_env())
