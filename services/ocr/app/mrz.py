"""ICAO Doc 9303 machine readable zone (MRZ) parsing with check-digit validation.

Pure functions, no I/O. The output is *assistive*: a field is only ever "verified" when a check digit covers
it and passes; names, sex and country codes have no check digit and are always reported as unverified.
The API never treats any of this as proof of identity (rule 5 in CLAUDE.md): the guest reviews every field.

Formats: TD3 (passport, 2 x 44), TD2 (2 x 36), TD1 (ID card, 3 x 30).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

FILLER = "<"
_WEIGHTS = (7, 3, 1)

# Characters OCR confuses. Digit context: letters that look like digits; letter context: the reverse.
_TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}
_TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B"}
_ALNUM_SWAPS = {"O": "0", "0": "O", "I": "1", "1": "I", "B": "8", "8": "B", "S": "5", "5": "S", "Z": "2", "2": "Z"}
_MRZ_CHARS = re.compile(r"^[A-Z0-9<]+$")


def char_value(c: str) -> int:
    if c.isdigit():
        return int(c)
    if "A" <= c <= "Z":
        return ord(c) - ord("A") + 10
    return 0  # the filler character counts as zero


def check_digit(data: str) -> int:
    """ICAO 9303 check digit: weights 7-3-1, letters A=10..Z=35, filler 0, sum modulo 10."""
    return sum(char_value(c) * _WEIGHTS[i % 3] for i, c in enumerate(data)) % 10


@dataclass
class MrzResult:
    format: str  # TD1 | TD2 | TD3
    fields: dict[str, str | None]
    # Check digits: True (passes), False (fails) or None (not present / not verifiable).
    checks: dict[str, bool | None]
    corrected: list[str] = field(default_factory=list)  # fields repaired from OCR confusions
    flagged: list[str] = field(default_factory=list)  # fields the guest must look at first
    unverified: list[str] = field(default_factory=list)  # fields no check digit covers

    @property
    def all_checks_pass(self) -> bool:
        """Every present check digit passes on the raw read, with no OCR repair involved."""
        present = [v for v in self.checks.values() if v is not None]
        return bool(present) and all(present) and not self.corrected

    @property
    def confidence(self) -> float:
        """0..1: share of check digits that pass, reduced for repaired fields. Not a probability."""
        present = [v for v in self.checks.values() if v is not None]
        if not present:
            return 0.0
        score = sum(1 for v in present if v) / len(present)
        return round(max(0.0, score - 0.05 * len(self.corrected)), 2)


# --------------------------------------------------------------------------- normalisation


def normalize_line(raw: str) -> str:
    """Uppercase, remove spaces and map look-alike filler glyphs to `<`."""
    s = raw.upper().replace(" ", "").replace("\t", "")
    s = s.translate(str.maketrans({"«": "<", "‹": "<", "〈": "<", "(": "<", "[": "<", "{": "<"}))
    # OCR often reads the trailing run of `<` as K, C, L, S or E. Names never end in a run of four of those.
    return re.sub(r"[<KCLSE]{4,}$", lambda m: FILLER * len(m.group()), s)


def _fit(line: str, length: int) -> str | None:
    """A line one to three characters off is padded or trimmed at the filler end; further off is unusable."""
    if not _MRZ_CHARS.match(line):
        return None
    if len(line) == length:
        return line
    if length - 3 <= len(line) < length:
        return line.ljust(length, FILLER)
    if length < len(line) <= length + 3 and line.endswith(FILLER):
        return line[:length]
    if length < len(line) <= length + 3:
        # An ID card's line 2 ends in a check digit, not in fillers. Tesseract sometimes adds a K, C, L, S or E in
        # front of its long run of `<`; names never sit right before six fillers on such a line. Check digits then
        # confirm or flag the result like any other read.
        extra = len(line) - length
        fixed = re.sub(r"[KCLSE](?=<{6,})", "", line, count=extra)
        return fixed if len(fixed) == length else None
    return None


def find_mrz_lines(text: str) -> list[str] | None:
    """Picks the MRZ lines out of raw OCR text: the last 3 lines of ~30, or the last 2 of ~44 or ~36."""
    lines = [normalize_line(line) for line in text.splitlines()]
    lines = [line for line in lines if len(line) >= 25 and FILLER in line and re.fullmatch(r"[A-Z0-9<]+", line)]
    for count, length in ((3, 30), (2, 44), (2, 36)):
        if len(lines) < count:
            continue
        tail = [_fit(line, length) for line in lines[-count:]]
        if all(tail):
            return tail  # type: ignore[return-value]
    return None


# --------------------------------------------------------------------------- field helpers


def _digits(value: str) -> str:
    return "".join(_TO_DIGIT.get(c, c) for c in value)


def _letters(value: str) -> str:
    return "".join(_TO_LETTER.get(c, c) for c in value)


def _to_date(yymmdd: str, kind: str, today: date) -> str | None:
    if not re.fullmatch(r"\d{6}", yymmdd):
        return None
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:])
    year = 2000 + yy
    if kind == "birth" and year > today.year:
        year -= 100  # a birth date cannot be in the future
    try:
        return date(year, mm, dd).isoformat()
    except ValueError:
        return None


def _name(value: str) -> tuple[str | None, str | None]:
    surname, _, given = value.partition("<<")
    clean = lambda s: " ".join(_letters(s).replace(FILLER, " ").split()) or None  # noqa: E731
    return clean(surname), clean(given.split("<<")[0])


def _check_char(c: str) -> int | None:
    c = _TO_DIGIT.get(c, c)
    return int(c) if c.isdigit() else None


def _verify_alnum(value: str, check: str) -> tuple[str, bool | None, bool]:
    """Checks a document number against its check digit.

    A single check digit cannot vouch for several guessed substitutions (each wrong guess passes about one time
    in ten), so a repair is only attempted for ONE misread character (O/0, I/1, B/8, S/5, Z/2) and only when it
    is the unique single substitution that makes the check pass. Otherwise the check simply fails.
    Returns (value, passes, repaired); a repaired value is always flagged for the guest by the caller.
    """
    expected = _check_char(check)
    if expected is None:
        return value, None, False
    if check_digit(value) == expected:
        return value, True, False
    fixes = []
    for i, c in enumerate(value):
        if c in _ALNUM_SWAPS:
            candidate = value[:i] + _ALNUM_SWAPS[c] + value[i + 1 :]
            if check_digit(candidate) == expected:
                fixes.append(candidate)
    if len(fixes) == 1:
        return fixes[0], True, True
    return value, False, False


def _verify_digits(value: str, check: str) -> tuple[str, bool | None]:
    """Numeric fields (dates): letters read as digits are converted first, then the check digit is compared."""
    expected = _check_char(check)
    fixed = _digits(value)
    if expected is None:
        return fixed, None
    return fixed, check_digit(fixed) == expected


# --------------------------------------------------------------------------- parsers


def _finish(result: MrzResult, verified: set[str]) -> MrzResult:
    # A verifiable field is flagged unless its check digit passes on a clean read and it parsed to a value.
    for name in ("document_number", "birth_date", "expiry_date"):
        if result.checks.get(name) is not True or not result.fields.get(name) or name in result.corrected:
            result.flagged.append(name)
    if result.checks.get("composite") is False:
        result.flagged.append("composite")
    result.unverified = [k for k, v in result.fields.items() if v is not None and k not in verified]
    return result


def _dates_and_number(number: str, ncheck: str, dob: str, dcheck: str, exp: str, echeck: str, today: date):
    doc, doc_ok, repaired = _verify_alnum(number, ncheck)
    dob_fixed, dob_ok = _verify_digits(dob, dcheck)
    exp_fixed, exp_ok = _verify_digits(exp, echeck)
    return doc.replace(FILLER, ""), doc_ok, repaired, dob_fixed, dob_ok, exp_fixed, exp_ok


def parse_td3(lines: list[str], today: date | None = None) -> MrzResult:
    today = today or date.today()
    l1, l2 = lines
    doc, doc_ok, repaired, dob, dob_ok, exp, exp_ok = _dates_and_number(l2[0:9], l2[9], l2[13:19], l2[19], l2[21:27], l2[27], today)
    optional = l2[28:42]
    opt_check = _check_char(l2[42])
    opt_ok = None if set(optional) == {FILLER} and l2[42] in (FILLER, "0") else (check_digit(optional) == opt_check if opt_check is not None else False)
    composite = l2[0:10] + l2[13:20] + l2[21:43]
    comp_expected = _check_char(l2[43])
    surname, given = _name(l1[5:44])
    result = MrzResult(
        format="TD3",
        fields={
            "document_type": _letters(l1[0]),
            "issuing_country": _letters(l1[2:5]).replace(FILLER, ""),
            "surname": surname,
            "given_names": given,
            "document_number": doc,
            "nationality": _letters(l2[10:13]).replace(FILLER, ""),
            "birth_date": _to_date(dob, "birth", today),
            "sex": l2[20] if l2[20] in "MF" else None,
            "expiry_date": _to_date(exp, "expiry", today),
        },
        checks={
            "document_number": doc_ok,
            "birth_date": dob_ok,
            "expiry_date": exp_ok,
            "optional_data": opt_ok,
            "composite": None if comp_expected is None else check_digit(composite) == comp_expected,
        },
        corrected=["document_number"] if repaired else [],
    )
    return _finish(result, {"document_number", "birth_date", "expiry_date"})


def parse_td2(lines: list[str], today: date | None = None) -> MrzResult:
    today = today or date.today()
    l1, l2 = lines
    doc, doc_ok, repaired, dob, dob_ok, exp, exp_ok = _dates_and_number(l2[0:9], l2[9], l2[13:19], l2[19], l2[21:27], l2[27], today)
    composite = l2[0:10] + l2[13:20] + l2[21:35]
    comp_expected = _check_char(l2[35])
    surname, given = _name(l1[5:36])
    result = MrzResult(
        format="TD2",
        fields={
            "document_type": _letters(l1[0]),
            "issuing_country": _letters(l1[2:5]).replace(FILLER, ""),
            "surname": surname,
            "given_names": given,
            "document_number": doc,
            "nationality": _letters(l2[10:13]).replace(FILLER, ""),
            "birth_date": _to_date(dob, "birth", today),
            "sex": l2[20] if l2[20] in "MF" else None,
            "expiry_date": _to_date(exp, "expiry", today),
        },
        checks={
            "document_number": doc_ok,
            "birth_date": dob_ok,
            "expiry_date": exp_ok,
            "composite": None if comp_expected is None else check_digit(composite) == comp_expected,
        },
        corrected=["document_number"] if repaired else [],
    )
    return _finish(result, {"document_number", "birth_date", "expiry_date"})


def parse_td1(lines: list[str], today: date | None = None) -> MrzResult:
    today = today or date.today()
    l1, l2, l3 = lines
    long_number = l1[14] == FILLER  # document numbers over nine characters overflow into the optional field: not verified here
    doc, doc_ok, repaired = (l1[5:14].replace(FILLER, ""), None, False) if long_number else _verify_alnum(l1[5:14], l1[14])
    dob, dob_ok = _verify_digits(l2[0:6], l2[6])
    exp, exp_ok = _verify_digits(l2[8:14], l2[14])
    composite = l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]
    comp_expected = _check_char(l2[29])
    surname, given = _name(l3)
    result = MrzResult(
        format="TD1",
        fields={
            "document_type": _letters(l1[0]),
            "issuing_country": _letters(l1[2:5]).replace(FILLER, ""),
            "surname": surname,
            "given_names": given,
            "document_number": doc.replace(FILLER, ""),
            "nationality": _letters(l2[15:18]).replace(FILLER, ""),
            "birth_date": _to_date(dob, "birth", today),
            "sex": l2[7] if l2[7] in "MF" else None,
            "expiry_date": _to_date(exp, "expiry", today),
        },
        checks={
            "document_number": doc_ok,
            "birth_date": dob_ok,
            "expiry_date": exp_ok,
            "composite": None if comp_expected is None else check_digit(composite) == comp_expected,
        },
        corrected=["document_number"] if repaired else [],
    )
    return _finish(result, {"birth_date", "expiry_date"} | (set() if long_number else {"document_number"}))


def parse_mrz(lines: list[str], today: date | None = None) -> MrzResult | None:
    """Parses already-normalised, correctly sized lines. None when the shape is not an MRZ."""
    shapes = {(3, 30): parse_td1, (2, 36): parse_td2, (2, 44): parse_td3}
    parser = shapes.get((len(lines), len(lines[0]) if lines else 0))
    if not parser or any(len(line) != len(lines[0]) for line in lines):
        return None
    return parser(lines, today)


def parse_text(text: str, today: date | None = None) -> MrzResult | None:
    """OCR text in, best MRZ reading out (or None when no MRZ-shaped lines exist)."""
    lines = find_mrz_lines(text)
    return parse_mrz(lines, today) if lines else None
