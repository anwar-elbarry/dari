"""ICAO 9303 machine-readable zone parsing with check-digit validation.

Pure functions, no I/O, nothing logged. The output is assistive: every field is shown to the guest for
review, and a failed check digit is reported as a flag, never silently corrected.

Formats: TD3 (passport, 2x44), TD2 (2x36), TD1 (ID card, 3x30).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

_WEIGHTS = (7, 3, 1)
_ALLOWED = re.compile(r"^[A-Z0-9<]+$")


def check_digit(value: str) -> int:
    """ICAO 9303 check digit: weights 7-3-1, digits as is, A-Z = 10..35, filler '<' = 0."""
    total = 0
    for i, ch in enumerate(value):
        if ch.isdigit():
            v = int(ch)
        elif "A" <= ch <= "Z":
            v = ord(ch) - ord("A") + 10
        elif ch == "<":
            v = 0
        else:
            raise ValueError("invalid MRZ character")
        total += v * _WEIGHTS[i % 3]
    return total % 10


@dataclass
class MrzResult:
    format: str
    document_type: str
    issuing_state: str
    surname: str
    given_names: str
    document_number: str
    nationality: str
    date_of_birth: date | None
    sex: str
    date_of_expiry: date | None
    optional_data: str
    # Names of fields whose check digit failed (or whose value could not be read).
    flags: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.flags


class MrzError(ValueError):
    """The text is not a recognisable MRZ. Messages never contain the input."""


def _clean(lines: list[str]) -> list[str]:
    out = []
    for raw in lines:
        s = re.sub(r"\s+", "", raw.upper())
        if not _ALLOWED.match(s):
            raise MrzError("unexpected characters in MRZ")
        out.append(s)
    return out


def _digits(s: str) -> str:
    # Common OCR confusions in numeric fields only.
    return s.translate(str.maketrans("OQDIZSB", "0001258"))


def _parse_date(yymmdd: str, *, future: bool) -> date | None:
    """YYMMDD. Birth dates are never in the future. Expiry dates take the century closest to today, so an
    already-expired document is read as expired rather than pushed a century ahead."""
    d = _digits(yymmdd)
    if not d.isdigit() or len(d) != 6:
        return None
    yy, mm, dd = int(d[:2]), int(d[2:4]), int(d[4:6])
    today = date.today()
    century = today.year - today.year % 100
    candidates = [century - 100 + yy, century + yy, century + 100 + yy]
    if future:
        year = min(candidates, key=lambda y: abs(y - today.year))
    else:
        year = max(y for y in candidates if y <= today.year)
    try:
        return date(year, mm, dd)
    except ValueError:
        return None


def _names(field_: str) -> tuple[str, str]:
    parts = field_.split("<<", 1)
    surname = parts[0].replace("<", " ").strip()
    given = parts[1].replace("<", " ").strip() if len(parts) > 1 else ""
    return surname, given


def _verify(flags: list[str], name: str, value: str, digit: str) -> None:
    ok = False
    try:
        d = _digits(digit)
        ok = d.isdigit() and check_digit(value) == int(d)
    except ValueError:
        ok = False
    if not ok:
        flags.append(name)


def _build(fmt: str, doc_type: str, state: str, names: str, number: str, nat: str, dob: str, sex: str,
           exp: str, optional: str, flags: list[str]) -> MrzResult:
    surname, given = _names(names)
    birth = _parse_date(dob, future=False)
    expiry = _parse_date(exp, future=True)
    if birth is None and "date_of_birth" not in flags:
        flags.append("date_of_birth")
    if expiry is None and "date_of_expiry" not in flags:
        flags.append("date_of_expiry")
    return MrzResult(
        format=fmt,
        document_type=doc_type.replace("<", ""),
        issuing_state=state.replace("<", ""),
        surname=surname,
        given_names=given,
        document_number=number.replace("<", ""),
        nationality=nat.replace("<", ""),
        date_of_birth=birth,
        sex=sex if sex in ("M", "F") else "",
        date_of_expiry=expiry,
        optional_data=optional.rstrip("<"),
        flags=flags,
    )


def _td3(l1: str, l2: str) -> MrzResult:
    flags: list[str] = []
    _verify(flags, "document_number", l2[0:9], l2[9])
    _verify(flags, "date_of_birth", l2[13:19], l2[19])
    _verify(flags, "date_of_expiry", l2[21:27], l2[27])
    # The optional-data digit may be '<' when the field is empty.
    if not (set(l2[28:42]) == {"<"} and l2[42] in "<0"):
        _verify(flags, "optional_data", l2[28:42], l2[42])
    _verify(flags, "composite", l2[0:10] + l2[13:20] + l2[21:43], l2[43])
    return _build("TD3", l1[0:2], l1[2:5], l1[5:44], l2[0:9], l2[10:13], l2[13:19], l2[20],
                  l2[21:27], l2[28:42], flags)


def _td2(l1: str, l2: str) -> MrzResult:
    flags: list[str] = []
    _verify(flags, "document_number", l2[0:9], l2[9])
    _verify(flags, "date_of_birth", l2[13:19], l2[19])
    _verify(flags, "date_of_expiry", l2[21:27], l2[27])
    _verify(flags, "composite", l2[0:10] + l2[13:20] + l2[21:35], l2[35])
    return _build("TD2", l1[0:2], l1[2:5], l1[5:36], l2[0:9], l2[10:13], l2[13:19], l2[20],
                  l2[21:27], l2[28:35], flags)


def _td1(l1: str, l2: str, l3: str) -> MrzResult:
    flags: list[str] = []
    _verify(flags, "document_number", l1[5:14], l1[14])
    _verify(flags, "date_of_birth", l2[0:6], l2[6])
    _verify(flags, "date_of_expiry", l2[8:14], l2[14])
    _verify(flags, "composite", l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29], l2[29])
    return _build("TD1", l1[0:2], l1[2:5], l3, l1[5:14], l2[15:18], l2[0:6], l2[7],
                  l2[8:14], l1[15:30], flags)


def parse_mrz(lines: list[str]) -> MrzResult:
    """Parse 2 or 3 MRZ lines. Raises MrzError when the shape is not TD1/TD2/TD3."""
    cleaned = _clean([l for l in lines if l.strip()])
    shape = tuple(len(l) for l in cleaned)
    if shape == (44, 44):
        return _td3(*cleaned)
    if shape == (36, 36):
        return _td2(*cleaned)
    if shape == (30, 30, 30):
        return _td1(*cleaned)
    raise MrzError("unrecognised MRZ layout")
