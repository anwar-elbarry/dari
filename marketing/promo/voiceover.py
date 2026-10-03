"""Female voiceover for the promos, mixed over the score with ducking.

Voice: Kokoro TTS (open weights, Apache-2.0), run locally: "af_heart" in English, "ff_siwis" in French. Each line has a
time slot tied to the picture; a line that runs long is sped up (at most 1.22x), and one that still does not fit
stops the script rather than overlap the next scene.

Setup (once, any virtualenv):  pip install kokoro-onnx soundfile
  model files in $KOKORO_DIR (default ./kokoro): kokoro-v1.0.onnx and voices-v1.0.bin from
  https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
Usage:  python voiceover.py <en|fr> [15|60]  ->  out/mix[-60]-<lang>.wav (needs out/soundtrack[-60].wav first)
        add --check to transcribe every line back with Whisper (pip install sherpa-onnx, model in $WHISPER_DIR).
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
SR = 48000

# (start, latest end, text shown in the script, optional text sent to the TTS for pronunciation)
LINES = {
    ('en', '60'): [
        (0.15, 2.2, 'Running short-term rentals in Marrakech?', 'Running short-term rentals in Marra-kesh?'),
        (2.3, 6.3, 'Passports in chats, nights in spreadsheets, forms by hand, tax guesswork.'),
        (6.4, 8.35, 'Sound familiar? There’s a better way.'),
        (8.45, 11.8, 'Meet RiadTax: compliance and tax for your rentals.', 'Meet Ree-ad Tax: compliance and tax, for your rentals.'),
        (12.3, 18.9, 'Connect your iCal calendars or import a CSV. Bookings and cancellations sync into one place.', 'Connect your eye-cal calendars, or import a CSV. Bookings and cancellations sync into one place.'),
        (19.4, 25.9, 'RiadTax counts every night for each property, and emails you before you reach your threshold.', 'Ree-ad Tax counts every night, for each property, and emails you before you reach your threshold.'),
        (26.4, 33.9, 'Send your guests a check-in link. They scan their passport on their phone, and the police form is ready as a PDF.'),
        (34.4, 40.9, 'Your monthly police register builds itself. Share it with an expiring link, and revoke it anytime.'),
        (41.4, 47.9, 'Monthly tax estimates per property, exported to PDF and Excel, to review with your accountant.'),
        (48.35, 54.3, 'Guest data, handled with care: encrypted ID scans, automatic deletion, and every access logged.'),
        (54.6, 56.0, 'All in one place.'),
        (56.2, 59.92, 'Your rentals, under control. Join the Marrakech pilot.', 'Your rentals, under control. Join the Marra-kesh pilot.'),
    ],
    ('fr', '60'): [
        (0.15, 2.2, 'Vous gérez des locations à Marrakech ?', 'Vous gérez des locations à Marrakèche ?'),
        (2.3, 6.3, 'Passeports sur WhatsApp, nuits sur tableur, fiches à la main, impôts à l’aveugle.', 'Passeports sur Ouatsape, nuits sur tableur, fiches à la main, impôts à l’aveugle.'),
        (6.4, 8.35, 'Ça vous parle ? Il y a plus simple.'),
        (8.45, 11.8, 'Découvrez RiadTax, conformité et fiscalité de vos locations.', 'Découvrez Riade Taxe, conformité et fiscalité de vos locations.'),
        (12.3, 18.9, 'Connectez vos calendriers de réservation ou importez un CSV. Toutes vos réservations au même endroit, annulations comprises.'),
        (19.4, 25.9, 'RiadTax compte chaque nuit, pour chaque bien, et vous alerte par e-mail avant le seuil.', 'Riade Taxe compte chaque nuit, pour chaque bien, et vous alerte par imèle avant le seuil.'),
        (26.4, 33.9, 'Envoyez un lien de check-in : le voyageur scanne son passeport, et la fiche de police est prête en PDF.', 'Envoyez un lien de tchèque-ine : le voyageur scanne son passeport, et la fiche de police est prête en PDF.'),
        (34.4, 40.9, 'Le registre de police mensuel se remplit tout seul. Partagez-le par un lien qui expire, révocable à tout moment.'),
        (41.4, 47.9, 'Des estimations fiscales mensuelles par bien, en PDF et Excel, à valider avec votre comptable.'),
        (48.35, 54.3, 'Données voyageurs traitées avec soin : pièces chiffrées, supprimées après le séjour, chaque accès journalisé.'),
        (54.6, 56.0, 'Tout au même endroit.'),
        (56.2, 59.92, 'Vos locations, sous contrôle. Rejoignez le pilote à Marrakech.', 'Vos locations, sous contrôle. Rejoignez le pilote à Marrakèche.'),
    ],
    ('en', '15'): [
        (0.1, 2.05, 'Passports, calendars, forms, taxes.'),
        (2.08, 2.72, 'Sorted.'),
        (2.8, 4.45, 'Meet RiadTax.', 'Meet Ree-ad Tax.'),
        (4.7, 6.95, 'Every night counted, on every calendar.'),
        (7.1, 9.55, 'A passport scan, and the police form is ready.'),
        (9.6, 11.95, 'Registers, secure links, tax estimates.'),
        (12.0, 14.9, 'Your rentals, under control. Join the pilot.'),
    ],
    ('fr', '15'): [
        (0.1, 2.05, 'Passeports, calendriers, fiches, impôts.'),
        (2.08, 2.85, 'Simplifié.'),
        (2.9, 4.45, 'Découvrez RiadTax.', 'Découvrez Riade Taxe.'),
        (4.7, 6.95, 'Chaque nuit comptée, tous calendriers confondus.'),
        (7.1, 9.55, 'Le passeport est scanné, la fiche est prête.'),
        (9.6, 11.95, 'Registre, partage, estimations fiscales.'),
        (12.0, 14.9, 'Vos locations, sous contrôle. Rejoignez le pilote.'),
    ],
}
VOICE = {'en': ('af_heart', 'en-us'), 'fr': ('ff_siwis', 'fr-fr')}
MAX_SPEED = 1.22


def read_wav(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 2
        return np.frombuffer(w.readframes(w.getnframes()), '<i2').reshape(-1, 2).astype(float) / 32768


def write_wav(path, x):
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def resample(x, sr_in):
    """Band-limited resampling by zero-padding the spectrum (exact for 24 kHz -> 48 kHz)."""
    n_out = int(round(len(x) * SR / sr_in))
    return np.fft.irfft(np.fft.rfft(x), n_out) * (n_out / len(x))


def trim(x, thresh=0.01, pad=0.03):
    idx = np.where(np.abs(x) > thresh * np.max(np.abs(x)))[0]
    a, b = max(0, idx[0] - int(pad * SR)), min(len(x), idx[-1] + int(pad * SR))
    return x[a:b]


def eq(x, f, gains):
    X = np.fft.rfft(x)
    fr = np.fft.rfftfreq(len(x), 1 / SR)
    curve = np.ones_like(fr)
    for kind, fc, g in gains:
        if kind == 'hp':
            curve *= 1 / np.sqrt(1 + (fc / np.maximum(fr, 1)) ** 4)
        elif kind == 'high':
            curve *= 10 ** ((g / (1 + (fc / np.maximum(fr, 1)) ** 2)) / 20)
    return np.fft.irfft(X * curve, len(x))


def envelope(x, frame=48, attack=0.01, release=0.15):
    """Peak envelope at 1 kHz frame rate, smoothed, then back to sample rate."""
    n = len(x) // frame + 1
    pk = np.pad(np.abs(x), (0, n * frame - len(x))).reshape(n, frame).max(axis=1)
    out = np.empty(n)
    acc = 0.0
    fr = SR / frame
    a_up, a_dn = 1 - np.exp(-1 / (attack * fr)), 1 - np.exp(-1 / (release * fr))
    for i, v in enumerate(pk):
        acc += (a_up if v > acc else a_dn) * (v - acc)
        out[i] = acc
    return np.repeat(out, frame)[: len(x)]


def voice_chain(x):
    x = eq(x, None, [('hp', 90, 0), ('high', 3500, 2.5)])
    env = envelope(x, attack=0.005, release=0.08)
    ref = np.percentile(env[env > 0.05 * env.max()], 70)
    over = np.maximum(1, env / ref)
    x = x * over ** (1 / 3 - 1)                       # 3:1 above the speech level
    rms = np.sqrt(np.mean(x[np.abs(x) > 0.02 * np.max(np.abs(x))] ** 2))
    return x * (0.12 / rms)


def tts(kokoro, text, voice, lang, speed):
    samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    return trim(resample(np.asarray(samples, dtype=float), sr))


def main():
    lang = 'fr' if 'fr' in sys.argv[1:] else 'en'
    cut = '60' if '60' in sys.argv[1:] else '15'
    check = '--check' in sys.argv
    from kokoro_onnx import Kokoro
    kdir = os.environ.get('KOKORO_DIR', os.path.join(HERE, 'kokoro'))
    kokoro = Kokoro(os.path.join(kdir, 'kokoro-v1.0.onnx'), os.path.join(kdir, 'voices-v1.0.bin'))
    voice, code = VOICE[lang]
    lines = LINES[(lang, cut)]
    music = read_wav(os.path.join(OUT, 'soundtrack-60.wav' if cut == '60' else 'soundtrack.wav'))
    n = len(music)
    vo = np.zeros(n)
    takes = []
    for k, line in enumerate(lines):
        start, end, shown = line[:3]
        say = line[3] if len(line) > 3 else shown
        slot = end - start
        speed = 1.0
        x = tts(kokoro, say, voice, code, speed)
        while len(x) / SR > slot and speed < MAX_SPEED:
            speed = min(MAX_SPEED, speed * len(x) / SR / slot * 1.03)
            x = tts(kokoro, say, voice, code, speed)
        dur = len(x) / SR
        nxt = lines[k + 1][0] if k + 1 < len(lines) else n / SR
        status = 'ok' if start + dur <= min(end, nxt - 0.05) + 0.12 else 'TOO LONG'
        print(f'{start:6.2f}s  {dur:4.2f}/{slot:4.2f}s  x{speed:.2f}  {status:8}  {shown}')
        if status != 'ok':
            sys.exit(f'line at {start}s does not fit its slot: shorten it')
        x = voice_chain(x)
        i = int(start * SR)
        vo[i:i + len(x)] += x[: n - i]
        takes.append((shown, x))
    if check:
        transcribe(takes, lang)

    # Duck the score under the voice (about -9 dB), opening 120 ms before each line.
    env = envelope(vo, attack=0.02, release=0.35)
    look = int(0.12 * SR)
    env = np.concatenate([env[look:], np.zeros(look)])
    duck = 1 - 0.65 * np.minimum(1, env / (0.25 * np.max(env)))
    mix = music * duck[:, None] * 0.8 + vo[:, None] * np.array([1.0, 1.0])
    raw = os.path.join(OUT, f'mix{"-60" if cut == "60" else ""}-{lang}.raw.wav')
    path = raw.replace('.raw.wav', '.wav')
    write_wav(raw, mix / max(1.0, np.max(np.abs(mix)) / 0.95))
    probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
    m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
    af = f"loudnorm=I=-14:TP=-1:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', af, '-ar', str(SR), '-c:a', 'pcm_s16le', path], check=True)
    os.remove(raw)
    print('wrote', path)


def transcribe(takes, lang):
    import sherpa_onnx
    wdir = os.environ.get('WHISPER_DIR', os.path.join(HERE, 'whisper'))
    rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=os.path.join(wdir, 'small-encoder.int8.onnx'), decoder=os.path.join(wdir, 'small-decoder.int8.onnx'), tokens=os.path.join(wdir, 'small-tokens.txt'), language=lang, task='transcribe', num_threads=4)
    print('\nWhisper check (what a listener should hear):')
    for shown, x in takes:
        s = rec.create_stream()
        x16 = np.interp(np.arange(0, len(x), 3), np.arange(len(x)), x)
        x16 = np.concatenate([np.zeros(4000), x16 / (np.max(np.abs(x16)) + 1e-9) * 0.8, np.zeros(8000)])   # Whisper needs silence around
        s.accept_waveform(16000, x16.astype(np.float32))
        rec.decode_stream(s)
        print(f'  script : {shown}\n  heard  : {s.result.text.strip()}\n')


if __name__ == '__main__':
    main()
