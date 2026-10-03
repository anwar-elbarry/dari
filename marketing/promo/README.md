# RiadTax promo films

Two motion pieces, 1920×1080 at 60 fps, each in French and English: a 15-second promo and a 60-second film. Both are built in code, so every word, colour and cue can be edited and re-rendered.

| File | Role |
|---|---|
| `promo.html` / `promo-60.html` | The compositions (15 s / 60 s). `window.seek(t)` sets every element for time `t`; there is no CSS animation. Open `promo-60.html?lang=fr` in a browser and call `seek(5)` in the console to inspect a frame. |
| `shared.js` / `shared.css` | Helpers both compositions use: easing, headline masks and markers, the zellige field, the animated logo, tokens and fonts. |
| `soundtrack.py` | Synthesises the music and sound design (numpy only, no samples), with cues locked to the timeline. `python3 soundtrack.py 60` writes the 60 s track. |
| `render.mjs` | Captures each frame with Chromium and encodes `out/riadtax-promo[-60]-<lang>.mp4` with the soundtrack. |

## Render

```sh
npm install                                  # repo root, once (Playwright, fonts)
cd marketing/promo
python3 soundtrack.py                        # out/soundtrack.wav
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs en
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs fr
python3 soundtrack.py 60 && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs en 60   # 60 s film, about 20 min
STILLS=2.3,8.4 node render.mjs en 60         # PNG stills only, for review
```

Requires `ffmpeg` and a Chromium (`PW_CHROMIUM_PATH`, or Playwright's own browser).

## Storyboard, 15 s (120 BPM, one beat = 0.5 s)

| Time | Scene | Motion |
|---|---|---|
| 0.0–2.0 | Hook: "Passports. Calendars. Police forms. Taxes." | One word per beat, rolling in like a slot machine. A field of zellige stars draws outward from the centre, and a lime ripple goes out on each word. |
| 2.0–2.6 | "Sorted." | A lime circle wipe on the drop. |
| 2.6–4.6 | Logo | The Badge R draws itself (R, then check, then bars), settles into the RiadTax lockup with the tagline, then the camera zooms through the tile. |
| 4.6–7.0 | 01 Night counter | The calendar syncs, booked nights pop in lime, and the counter and gauge run up to 87 / 120. |
| 7.0–9.5 | 02 Guest check-in | Push transition. The passport is scanned, the fields fill (masked), "Send" is pressed and the Fiche de police PDF flies out. |
| 9.5–11.7 | 03 Register · Share · Tax | Zellige-star wipe. Three cards flip in: register rows tick, a share link is revoked, and the tax estimate bars and amount grow. |
| 11.7–15.0 | End card | Circle wipe, a lime pulse through the zellige, logo, "Your rentals, under control.", the pilot CTA with a shine, and the estimate footnote. |

## Storyboard, 60 s (120 BPM, every scene on a bar line)

| Time | Scene | Motion |
|---|---|---|
| 0–2 | "Running rentals in Marrakech?" | The headline lands line by line on the beat as the zellige field draws in. |
| 2–7 | The chaos | A group chat with passport photos, a night-count spreadsheet with a "?", a police form being handwritten and a tax receipt being crossed out pile up, one per bar, under rolling captions. On "Sound familiar?" the pile shakes, drains of colour and is sucked to the centre. |
| 7–8 | "There's a better way." | A lime circle wipe, and the music turns from tense to bright. |
| 8–12 | Logo | The R mark draws itself into the lockup, with the tagline and the four modules as chips. The camera zooms through the tile. |
| 12–19 | 01 Calendars | Three iCal/CSV sources send bookings along flowing lines into the calendar. A cancellation syncs and its nights go dark. |
| 19–26 | 02 Night counter | The counter runs to 87, then crosses the early-warning threshold at 92: the colour and status change and an e-mail alert slides in. |
| 26–34 | 03 Guest check-in | Blinds transition. The manager sends the link, it flies to the guest's phone, the passport is scanned, the fields fill (masked), consent is ticked, it is sent, and the Fiche de police lands between the phones while the manager sees "Submitted". |
| 34–41 | 04 Police register and secure share | Star wipe. The register builds row by row, a missing field gets fixed, the PDF is generated, then a share link is opened twice and revoked. |
| 41–48 | 05 Tax estimates | Doors close in white. Monthly bars and the year-to-date amount build up, the PDF and Excel exports fly to the Accountant's card ("Reports only"), with the estimate notice always on screen. |
| 48–54 | Privacy (breakdown) | Diagonal lime wipe; the drums drop out. Four tiles: encrypted ID scans, automatic deletion, every access logged, team roles. |
| 54–56 | Montage (drop) | The six modules fly into a tilted 3D grid that lights up on the beat, then collapses. |
| 56–60 | End card | Logo, "Your rentals, under control.", the pilot CTA with a shine, and the estimate footnote. |

## Wording rules kept

- Nothing claims compliance, certification or a guarantee (CLAUDE.md rule 2). Tax is always called an "estimate", and the end card carries "Tax figures are estimates. Confirm with your accountant."
- All figures and names are illustrative (87 or 92 nights, 12 480 and 38 640 MAD, 14 stays, Riad Yasmine, Dar Lila, Villa Atlas). The passport is a generic specimen (ICAO's fictional "UTO" country) and every field value is masked. There is no real person, document or customer.
- No third-party logos. Calendars are described generically. WhatsApp is named only as the problem to replace ("passports in WhatsApp").
- The consent step shows placeholder lines, not wording: consent text is counsel-approved data in the product.
- The night cap is shown as the app shows it ("/ 120"). Thresholds stay RuleConfig data in the product.
