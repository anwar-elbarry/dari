"""Synthetic specimen data only (ICAO 9303 specimen 'ERIKSSON / UTO'); no real person's data."""
from datetime import date

import pytest

from app.mrz import MrzError, check_digit, parse_mrz

TD3 = [
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
]
TD1 = [
    "I<UTOD231458907<<<<<<<<<<<<<<<",
    "7408122F1204159UTO<<<<<<<<<<<6",
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
]
TD2 = [
    "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<",
    "D231458907UTO7408122F1204159<<<<<<<6",
]


def test_check_digit_specimen():
    assert check_digit("L898902C3") == 6
    assert check_digit("740812") == 2
    assert check_digit("120415") == 9
    assert check_digit("<<<<<<") == 0


def test_td3_valid():
    r = parse_mrz(TD3)
    assert r.format == "TD3"
    assert r.valid, r.flags
    assert (r.surname, r.given_names) == ("ERIKSSON", "ANNA MARIA")
    assert r.document_number == "L898902C3"
    assert r.nationality == "UTO"
    assert r.date_of_birth == date(1974, 8, 12)
    assert r.sex == "F"
    assert r.optional_data == "ZE184226B"


def test_td3_each_check_digit_failure_is_flagged():
    cases = {
        "document_number": (1, 9, "7"),
        "date_of_birth": (1, 19, "3"),
        "date_of_expiry": (1, 27, "0"),
        "optional_data": (1, 42, "9"),
        "composite": (1, 43, "5"),
    }
    for flag, (line, pos, ch) in cases.items():
        lines = list(TD3)
        lines[line] = lines[line][:pos] + ch + lines[line][pos + 1 :]
        r = parse_mrz(lines)
        assert flag in r.flags, flag
        assert not r.valid


def test_td3_tampered_value_is_not_corrected():
    lines = list(TD3)
    lines[1] = "L898902C4" + lines[1][9:]  # document number altered, check digit kept
    r = parse_mrz(lines)
    assert "document_number" in r.flags
    assert r.document_number == "L898902C4"  # reported as read, never "fixed"


def test_td3_empty_optional_data_with_filler_digit():
    l2 = "L898902C36UTO7408122F1204159" + "<" * 14 + "<"
    l2 += str(check_digit(l2[0:10] + l2[13:20] + l2[21:43]))
    r = parse_mrz([TD3[0], l2])
    assert r.valid, r.flags
    assert r.optional_data == ""


def test_td1_and_td2():
    # Build valid lines from the pieces so the test documents the layout.
    def td1():
        l1 = "I<UTO" + "D23145890" + str(check_digit("D23145890")) + "<" * 15
        dob = "740812" + str(check_digit("740812"))
        exp = "120415" + str(check_digit("120415"))
        l2 = dob + "F" + exp + "UTO" + "<" * 11
        comp = str(check_digit(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]))
        return [l1, l2 + comp, "ERIKSSON<<ANNA<MARIA<<<<<<<<<<"]

    r = parse_mrz(td1())
    assert r.format == "TD1" and r.valid, r.flags
    assert r.document_number == "D23145890"
    assert r.date_of_expiry == date(2012, 4, 15)

    l2 = "D23145890" + str(check_digit("D23145890")) + "UTO" + "740812" + str(check_digit("740812")) + "F" \
        + "120415" + str(check_digit("120415")) + "<" * 7
    l2 += str(check_digit(l2[0:10] + l2[13:20] + l2[21:35]))
    r2 = parse_mrz(["I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<", l2])
    assert r2.format == "TD2" and r2.valid, r2.flags


def test_ocr_digit_confusion_is_tolerated_in_numeric_fields_only():
    lines = list(TD3)
    lines[1] = lines[1][:13] + "74O812" + lines[1][19:]  # letter O instead of zero in the birth date
    r = parse_mrz(lines)
    assert r.date_of_birth == date(1974, 8, 12)


def test_dates_resolve_sensibly():
    r = parse_mrz(TD3)
    assert r.date_of_birth < date.today()


@pytest.mark.parametrize(
    "lines",
    [
        [],
        ["short"],
        ["P<UTO" + "!" * 39, "L" * 44],
        ["A" * 44, "B" * 43],
        ["é" * 44, "é" * 44],
    ],
)
def test_garbage_is_rejected_without_echoing_input(lines):
    with pytest.raises(MrzError) as e:
        parse_mrz(lines)
    assert "UTO" not in str(e.value)
