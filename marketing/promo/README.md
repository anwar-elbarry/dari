# RiadTax 15 s promo

A 15-second motion piece (1920×1080, 60 fps, FR and EN). It is built in code, so every word, colour and cue can be edited and re-rendered.

| File | Role |
|---|---|
| `promo.html` | The composition. `window.seek(t)` sets every element for time `t`; there is no CSS animation. Open `promo.html?lang=fr` in a browser and call `seek(5)` in the console to inspect a frame. |
| `soundtrack.py` | Synthesises the music and sound design (numpy only, no samples), with cues locked to the timeline. |
| `render.mjs` | Captures each frame with Chromium and encodes `out/riadtax-promo-<lang>.mp4` with the soundtrack. |

## Render

```sh
npm install                                  # repo root, once (Playwright, fonts)
cd marketing/promo
python3 soundtrack.py                        # out/soundtrack.wav
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs en
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium node render.mjs fr
STILLS=2.3,8.4 node render.mjs en            # PNG stills only, for review
```

Requires `ffmpeg` and a Chromium (`PW_CHROMIUM_PATH`, or Playwright's own browser).

## Storyboard (120 BPM, one beat = 0.5 s)

| Time | Scene | Motion |
|---|---|---|
| 0.0–2.0 | Hook: "Passports. Calendars. Police forms. Taxes." | One word per beat, rolling in like a slot machine. A field of zellige stars draws outward from the centre, and a lime ripple goes out on each word. |
| 2.0–2.6 | "Sorted." | A lime circle wipe on the drop. |
| 2.6–4.6 | Logo | The Badge R draws itself (R, then check, then bars), settles into the RiadTax lockup with the tagline, then the camera zooms through the tile. |
| 4.6–7.0 | 01 Night counter | The calendar syncs, booked nights pop in lime, and the counter and gauge run up to 87 / 120. |
| 7.0–9.5 | 02 Guest check-in | Push transition. The passport is scanned, the fields fill (masked), "Send" is pressed and the Fiche de police PDF flies out. |
| 9.5–11.7 | 03 Register · Share · Tax | Zellige-star wipe. Three cards flip in: register rows tick, a share link is revoked, and the tax estimate bars and amount grow. |
| 11.7–15.0 | End card | Circle wipe, a lime pulse through the zellige, logo, "Your rentals, under control.", the pilot CTA with a shine, and the estimate footnote. |

## Wording rules kept

- Nothing claims compliance, certification or a guarantee (CLAUDE.md rule 2). Tax is always called an "estimate", and the end card carries "Tax figures are estimates. Confirm with your accountant."
- All figures are illustrative (87 nights, 12 480 MAD, 14 stays). The passport is a generic specimen (ICAO's fictional "UTO" country) and every field value is masked. There is no real person, document or customer.
- No third-party logos. Calendars are described generically.
- The night cap is shown as the app shows it ("/ 120"). Thresholds stay RuleConfig data in the product.
