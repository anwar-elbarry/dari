"""End-to-end reads of synthetic images with the real Tesseract, plus the failure modes that must never crash."""
import io

import pytest
from PIL import Image

from app import imaging
from app.config import Settings
from app.extract import extract
from tests.mrz_fixtures import TD3_LINE1, TD3_LINE2, build_td1, build_td2, build_td3
from tests.render import blurred, mrz_page, noise, to_bytes

S = Settings(shared_secret="s" * 32)


def read(img, fmt="PNG", **kw):
    return extract(to_bytes(img, fmt), S, **kw)


def test_reads_the_specimen_passport():
    r = read(mrz_page([TD3_LINE1, TD3_LINE2]))
    assert r["status"] == "ok"
    assert r["fields"]["document_number"] == "L898902C3" and r["fields"]["surname"] == "ERIKSSON"
    assert r["fields"]["birth_date"] == "1974-08-12" and r["confidence"] == 1.0 and r["flagged"] == []


def test_reads_jpeg_and_other_sizes():
    lines = build_td3()
    for size in (36, 44, 60):
        assert read(mrz_page(lines, size=size), "JPEG")["status"] == "ok", size


@pytest.mark.parametrize("angle", [90, 180, 270])
def test_reads_a_rotated_photo(angle):
    r = read(mrz_page([TD3_LINE1, TD3_LINE2]).rotate(angle, expand=True))
    assert r["status"] == "ok" and r["fields"]["document_number"] == "L898902C3"


def test_reads_td1_and_td2_documents():
    td1 = read(mrz_page(build_td1(), size=48))
    td2 = read(mrz_page(build_td2(), size=48))
    assert td1["format"] == "TD1" and td1["status"] == "ok"
    assert td2["format"] == "TD2" and td2["status"] == "ok"


def test_a_blurred_photo_is_flagged_and_never_reported_as_a_clean_read():
    r = read(blurred(mrz_page([TD3_LINE1, TD3_LINE2]), 9))
    assert r["quality"]["blurry"] is True
    assert r["status"] in ("no_mrz", "partial")
    if r["status"] == "partial":
        assert r["confidence"] < 1.0 and r["flagged"]


def test_a_sharp_photo_is_not_flagged_blurry():
    assert read(mrz_page(build_td3()))["quality"]["blurry"] is False


def test_noise_and_blank_images_give_no_mrz_without_crashing():
    assert read(noise(900, 700))["status"] == "no_mrz"
    assert read(Image.new("L", (900, 700), 255))["status"] == "no_mrz"


def test_a_misread_check_digit_is_reported_as_partial_and_flagged():
    lines = build_td3(number="L7A4C9K37")
    lines[1] = lines[1][:9] + str((int(lines[1][9]) + 1) % 10) + lines[1][10:]
    r = read(mrz_page(lines))
    assert r["status"] == "partial" and "document_number" in r["flagged"] and r["confidence"] < 1.0


def test_only_the_expected_fields_are_returned():
    r = read(mrz_page([TD3_LINE1, TD3_LINE2]))
    assert set(r) == {"status", "quality", "format", "fields", "checks", "flagged", "corrected", "unverified", "confidence"}
    assert "image" not in str(r).lower()


def test_ocr_is_capped_per_image():
    calls = []
    extract(to_bytes(noise(900, 700)), S, ocr=lambda png, t: calls.append(1) or "")
    assert len(calls) == S.max_ocr_calls


def test_stops_at_the_first_clean_read():
    calls = []

    def ocr(png, timeout):
        calls.append(1)
        return TD3_LINE1 + "\n" + TD3_LINE2

    assert extract(to_bytes(noise(900, 700)), S, ocr=ocr)["status"] == "ok"
    assert len(calls) == 1


class TestRejectedImages:
    def status(self, data):
        return extract(data, S)

    def test_wrong_magic_bytes(self):
        for data in (b"GIF89a" + b"\x00" * 200, b"%PDF-1.7 ...", b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"MZ\x90\x00", b"", b"\xff\xd8"):
            assert self.status(data) == {"status": "unreadable", "reason": "format"}

    def test_a_polyglot_with_an_image_header_and_junk_body_is_a_decode_failure(self):
        data = b"\xff\xd8\xff\xe0" + b"<script>alert(1)</script>" * 40
        assert self.status(data) == {"status": "unreadable", "reason": "decode"}

    def test_truncated_image(self):
        data = to_bytes(mrz_page(build_td3()), "JPEG")
        assert self.status(data[: len(data) // 3])["status"] == "unreadable"

    def test_too_small(self):
        assert self.status(to_bytes(Image.new("L", (200, 100), 255))) == {"status": "unreadable", "reason": "too_small"}

    def test_decompression_bomb_is_refused_before_it_is_decoded(self):
        # 25,000 x 25,000 one-bit PNG: a few KB on the wire, hundreds of MB of pixels.
        buf = io.BytesIO()
        Image.new("1", (25_000, 25_000), 1).save(buf, "PNG", optimize=True)
        assert len(buf.getvalue()) < 1_000_000
        assert self.status(buf.getvalue()) == {"status": "unreadable", "reason": "too_large"}


def test_open_image_orients_by_exif_but_returns_grayscale_only():
    gray = imaging.open_image(to_bytes(mrz_page(build_td3()), "JPEG"), 40_000_000, 400)
    assert gray.mode == "L"
