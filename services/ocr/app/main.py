"""Document extraction worker (OCR/MRZ). Self-hosted by design: ID images must not leave our infrastructure
without a CNDP cross-border assessment (Tech Spec 1 & 7). Output is assistive: the guest reviews every field."""
from fastapi import FastAPI

app = FastAPI(title="dari-ocr")


@app.get("/health")
def health():
    return {"status": "ok"}


# TODO: POST /extract — passport MRZ (ICAO 9303, e.g. fastmrz/PassportEye), CIN structured OCR with confidence scores.
