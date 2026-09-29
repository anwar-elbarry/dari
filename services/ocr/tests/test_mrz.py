from datetime import date

import pytest

from app.mrz import check_digit, find_mrz_lines, normalize_line, parse_mrz, parse_text
from tests.mrz_fixtures import TD3_LINE1, TD3_LINE2, build_td1, build_td2, build_td3

TODAY = date(2026, 9, 29)


def test_check_digit_matches_the_icao_specimen():
    assert check_digit("L898902C3") == 6
    assert check_digit("740812") == 2
    assert check_digit("120415") == 9
    assert check_digit("ZE184226B<<<<<") == 1
    assert check_digit("") == 0


def test_specimen_passport_parses_and_every_check_passes():
    r = parse_mrz([TD3_LINE1, TD3_LINE2], TODAY)
    assert r is not None and r.format == "TD3"
    assert r.fields == {
        "document_type": "P",
        "issuing_country": "UTO",
        "surname": "ERIKSSON",
        "given_names": "ANNA MARIA",
        "document_number": "L898902C3",
        "nationality": "UTO",
        "birth_date": "1974-08-12",
        "sex": "F",
        "expiry_date": "2012-04-15",
    }
    assert r.checks == {"document_number": True, "birth_date": True, "expiry_date": True, "optional_data": True, "composite": True}
    assert r.all_checks_pass and r.confidence == 1.0
    assert r.flagged == [] and r.corrected == []


def test_names_sex_and_countries_are_never_reported_as_verified():
    r = parse_mrz([TD3_LINE1, TD3_LINE2], TODAY)
    assert set(r.unverified) == {"document_type", "issuing_country", "surname", "given_names", "nationality", "sex"}


@pytest.mark.parametrize("position,field", [(19, "birth_date"), (27, "expiry_date"), (43, "composite")])
def test_a_wrong_check_digit_is_flagged_not_hidden(position, field):
    line2 = list(TD3_LINE2)
    line2[position] = str((int(line2[position]) + 1) % 10)
    r = parse_mrz([TD3_LINE1, "".join(line2)], TODAY)
    assert r is not None
    assert field in r.flagged
    assert not r.all_checks_pass
    assert r.confidence < 1.0


def test_a_wrong_document_number_check_digit_is_flagged():
    # A number with no confusable characters (no 0/1/2/5/8 or O/I/Z/S/B), so no repair can coincidentally succeed.
    lines = build_td3(number="L7A4C9K37")
    lines[1] = lines[1][:9] + str((int(lines[1][9]) + 1) % 10) + lines[1][10:]
    r = parse_mrz(lines, TODAY)
    assert r.checks["document_number"] is False and "document_number" in r.flagged
    assert not r.all_checks_pass and r.corrected == []


def test_a_wrong_optional_data_check_lowers_confidence():
    line2 = TD3_LINE2[:42] + "7" + TD3_LINE2[43]
    r = parse_mrz([TD3_LINE1, line2], TODAY)
    assert r.checks["optional_data"] is False


def test_a_changed_character_in_the_number_fails_its_check():
    lines = build_td3(number="L7A4C9K37")
    lines[1] = lines[1][:8] + "4" + lines[1][9:]  # 7 -> 4 after the check digit was computed
    r = parse_mrz(lines, TODAY)
    assert r.checks["document_number"] is False and "document_number" in r.flagged


def test_letters_read_as_digits_in_dates_are_repaired():
    line2 = TD3_LINE2[:13] + "74O8I2" + TD3_LINE2[19:]  # 740812 with O for 0 and I for 1
    r = parse_mrz([TD3_LINE1, line2], TODAY)
    assert r.fields["birth_date"] == "1974-08-12" and r.checks["birth_date"] is True


def test_one_misread_character_in_the_number_is_repaired_reported_and_flagged():
    lines = build_td3(number="L78K4C937")  # a single 8 in the number
    lines[1] = lines[1][:2] + "B" + lines[1][3:]  # read as B
    r = parse_mrz(lines, TODAY)
    assert r.fields["document_number"] == "L78K4C937"
    assert r.corrected == ["document_number"]
    assert "document_number" in r.flagged  # the guest must look at a repaired field
    assert not r.all_checks_pass  # and a repaired read is not a clean pass
    assert r.confidence < 1.0


def test_a_repair_is_refused_when_it_is_not_unique():
    # Two misread characters, or several equally plausible single fixes, are never guessed.
    lines = build_td3(number="L78K4C937")
    lines[1] = lines[1][:2] + "B" + lines[1][3:5] + "Z" + lines[1][6:]  # two changes
    r = parse_mrz(lines, TODAY)
    assert r.corrected == [] and r.checks["document_number"] is False


def test_digits_read_inside_names_become_letters():
    l1 = "P<UTOERIKSS0N<<ANNA<MAR1A<<<<<<<<<<<<<<<<<<<"
    r = parse_mrz([l1, TD3_LINE2], TODAY)
    assert r.fields["surname"] == "ERIKSSON" and r.fields["given_names"] == "ANNA MARIA"


def test_birth_dates_are_never_in_the_future():
    assert parse_mrz(build_td3(dob="990101"), TODAY).fields["birth_date"] == "1999-01-01"
    assert parse_mrz(build_td3(dob="300101"), TODAY).fields["birth_date"] == "1930-01-01"
    assert parse_mrz(build_td3(dob="250101"), TODAY).fields["birth_date"] == "2025-01-01"


def test_an_impossible_date_is_flagged_even_with_a_valid_check_digit():
    r = parse_mrz(build_td3(dob="901331"), TODAY)  # month 13, but the check digit was computed for it
    assert r.fields["birth_date"] is None and "birth_date" in r.flagged


def test_td3_with_a_personal_number():
    r = parse_mrz(build_td3(personal="AB123456"), TODAY)
    assert r.checks["optional_data"] is True and r.all_checks_pass


def test_td2_parses():
    r = parse_mrz(build_td2(), TODAY)
    assert r.format == "TD2" and r.all_checks_pass
    assert r.fields["document_number"] == "AB1234567" and r.fields["issuing_country"] == "MAR"
    assert r.fields["birth_date"] == "1990-01-31" and r.fields["expiry_date"] == "2030-06-30"


def test_td1_parses_and_flags_a_broken_composite():
    lines = build_td1()
    r = parse_mrz(lines, TODAY)
    assert r.format == "TD1" and r.all_checks_pass
    assert r.fields["surname"] == "MARTIN" and r.fields["given_names"] == "LEA" and r.fields["sex"] == "F"

    broken = lines[:]
    broken[1] = broken[1][:29] + str((int(broken[1][29]) + 1) % 10)
    assert "composite" in parse_mrz(broken, TODAY).flagged


def test_td1_long_document_numbers_are_not_claimed_as_verified():
    lines = build_td1()
    lines[0] = lines[0][:14] + "<" + lines[0][15:]
    r = parse_mrz(lines, TODAY)
    assert "document_number" in r.flagged and "document_number" in r.unverified or r.checks["document_number"] is None


def test_normalisation_maps_lookalike_fillers_and_trailing_misreads():
    assert normalize_line("p<uto eriksson«« anna") == "P<UTOERIKSSON<<ANNA"
    assert normalize_line("ANNA<MARIAKKKKKKCCC").endswith("<" * 9)
    assert normalize_line("ANNA<MARIA<<<<<<<<") == "ANNA<MARIA<<<<<<<<"


def test_find_mrz_lines_skips_the_rest_of_the_page_and_repairs_length():
    page = "PASSPORT / PASSEPORT\nSURNAME ERIKSSON\n" + TD3_LINE1 + "\n" + TD3_LINE2[:-2] + "\n"  # last two chars lost
    lines = find_mrz_lines(page)
    assert lines and all(len(line) == 44 for line in lines)
    r = parse_text(page, TODAY)
    assert r is not None and r.fields["document_number"] == "L898902C3"


@pytest.mark.parametrize("text", ["", "hello world", "1234567890\nabcdef", "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<"])
def test_text_without_an_mrz_gives_none(text):
    assert parse_text(text, TODAY) is None


def test_wrong_shapes_are_refused():
    assert parse_mrz([TD3_LINE1], TODAY) is None
    assert parse_mrz([TD3_LINE1, TD3_LINE2[:-1]], TODAY) is None
    assert parse_mrz([], TODAY) is None
