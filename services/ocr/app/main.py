"""Document extraction worker (OCR/MRZ). Self-hosted by design: ID images must not leave our infrastructure
without a CNDP cross-border assessment (Tech Spec 1 & 7). Output is assistive: the guest reviews every field."""
import hmac
import os

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app.mrz import MrzError, parse_mrz

app = FastAPI(title="dari-ocr")


@app.get("/health")
def health():
    return {"status": "ok"}


class MrzRequest(BaseModel):
    # Text lines already read from the document's MRZ strip (2 or 3 lines). Never logged.
    lines: list[str] = Field(min_length=2, max_length=3, json_schema_extra={"maxItems": 3})


def require_secret(x_ocr_secret: str | None = Header(default=None)) -> None:
    """The worker is private-network only; a shared secret adds a second barrier. Fails closed."""
    expected = os.environ.get("OCR_SHARED_SECRET", "")
    if not expected or not x_ocr_secret or not hmac.compare_digest(expected, x_ocr_secret):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/mrz/parse", dependencies=[Depends(require_secret)])
def mrz_parse(body: MrzRequest):
    """Parse and validate MRZ text. Assistive: `flags` lists fields whose check digit failed."""
    try:
        r = parse_mrz(body.lines)
    except MrzError:
        raise HTTPException(status_code=422, detail="unrecognised MRZ")
    return {
        "format": r.format,
        "valid": r.valid,
        "flags": r.flags,
        "fields": {
            "document_type": r.document_type,
            "issuing_state": r.issuing_state,
            "surname": r.surname,
            "given_names": r.given_names,
            "document_number": r.document_number,
            "nationality": r.nationality,
            "date_of_birth": r.date_of_birth.isoformat() if r.date_of_birth else None,
            "sex": r.sex,
            "date_of_expiry": r.date_of_expiry.isoformat() if r.date_of_expiry else None,
        },
    }


# Not built yet: image -> MRZ strip detection (OCR engine) and CIN structured OCR. Both wait for the
# real-card test (docs/human-tasks.md); until then the guest enters those fields manually.
