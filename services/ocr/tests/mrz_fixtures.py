"""Synthetic MRZ fixtures only. The TD3 pair is the specimen printed in ICAO Doc 9303 (fictional state UTO);
the others are built here with the check-digit function. No real person's data belongs in this repository."""
from app.mrz import FILLER, check_digit

TD3_LINE1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<"
TD3_LINE2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10"


def pad(s: str, n: int) -> str:
    return s.ljust(n, FILLER)


def build_td3(surname="MARTIN", given="LEA<CLAIRE", country="FRA", nationality="FRA", number="12AB34567", dob="900131", sex="F", exp="300630", personal=""):
    l1 = pad(f"P<{country}{surname}<<{given}", 44)
    body = pad(number, 9) + str(check_digit(pad(number, 9))) + nationality + dob + str(check_digit(dob)) + sex + exp + str(check_digit(exp))
    p = pad(personal, 14)
    body += p + (str(check_digit(p)) if personal else FILLER)
    l2 = body + str(check_digit(body[0:10] + body[13:20] + body[21:43]))
    return [l1, l2]


def build_td2(surname="MARTIN", given="LEA", country="MAR", nationality="MAR", number="AB1234567", dob="900131", sex="M", exp="300630"):
    l1 = pad(f"I<{country}{surname}<<{given}", 36)
    body = pad(number, 9) + str(check_digit(pad(number, 9))) + nationality + dob + str(check_digit(dob)) + sex + exp + str(check_digit(exp)) + pad("", 7)
    l2 = body + str(check_digit(body[0:10] + body[13:20] + body[21:35]))
    return [l1, l2]


def build_td1(surname="MARTIN", given="LEA", country="MAR", nationality="MAR", number="D23145890", dob="900131", sex="F", exp="300630"):
    l1 = "I<" + country + pad(number, 9) + str(check_digit(pad(number, 9))) + pad("", 15)
    l2 = dob + str(check_digit(dob)) + sex + exp + str(check_digit(exp)) + nationality + pad("", 11)
    l2 += str(check_digit(l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]))
    l3 = pad(f"{surname}<<{given}", 30)
    return [l1, l2, l3]
