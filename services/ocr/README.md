# Document worker (OCR / MRZ)

Reads the machine readable zone (MRZ) of a passport or ID card photo and returns **suggested** fields. Self-hosted: ID images never leave our infrastructure (rule 4 in `CLAUDE.md`).

## Contract

`POST /v1/extract`, raw image bytes as the body (JPEG or PNG, ≤ 10 MB), header `X-Worker-Secret`. Reachable from the API on the private network only. Response (never contains the image):

| `status` | Meaning | What the guest sees |
|---|---|---|
| `ok` | MRZ read and every check digit passes on a clean read | Fields prefilled, still editable |
| `partial` | MRZ read but a check digit fails or a character was repaired; see `flagged` | Fields prefilled, flagged ones highlighted |
| `no_mrz` | Nothing MRZ-shaped found | Manual entry |
| `unreadable` (`reason`: `format`, `decode`, `too_large`, `too_small`) | The image is unusable | Retake the photo |

Also returned: `fields`, `checks` (per check digit), `flagged`, `corrected`, `unverified` (names, sex and country codes have no check digit, so they are never "verified"), `confidence` (share of passing check digits, reduced for repairs; **not** a probability) and `quality` (`blurry`, `low_contrast`).

## What it guarantees

- Formats TD3 (passport), TD2 and TD1 (ID card), with ICAO 9303 check digits.
- OCR confusions are repaired only where it is safe: letters read as digits in dates; **one** misread character in a document number, and only when that is the unique fix. A repaired field is always flagged and never counts as a clean pass (a single check digit cannot vouch for guesses).
- Nothing on disk (no temp files, raw body instead of multipart, Tesseract through stdin/stdout), nothing logged about documents (`test_api.py` checks both), minimal environment for the child process, bounded concurrency (`OCR_MAX_CONCURRENCY`), bounded size, pixels and OCR calls per image, decompression bombs refused from the header.
- Fails closed: no `OCR_SHARED_SECRET` (32+ characters), no start.

## What it does not do yet

- **Moroccan CIN / CNIE.** Whether the card has a readable MRZ is unknown until real cards are tested (hard gate 5 in `docs/phase-3.md`). Until then a card without a readable MRZ returns `no_mrz` and the guest types the fields. Structured OCR of the printed fields is the fallback to build only after that test.
- **Accuracy on real photos.** The tests use fictional data rendered in a monospaced font. Tesseract's stock `eng` model is not trained on the OCR-B typeface; expect more `partial` results on real photos until an OCR-B model is added and the thresholds in `imaging.py` (blur, contrast) are calibrated on real cards. This is safe by design (the check digits catch misreads and the guest reviews everything), but it affects how often guests must correct fields.

## Run

```
cd services/ocr && pip install -r requirements.txt   # Tesseract must be installed (apt install tesseract-ocr)
pytest
OCR_SHARED_SECRET=$(openssl rand -base64 32) uvicorn app.asgi:app --port 8001 --no-access-log
```

Only fictional data (the public ICAO specimen and generated numbers) belongs in this repository.
