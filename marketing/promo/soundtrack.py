"""Score for the RiadTax promos: a "gnawa-house" palette, synthesised from scratch (no samples, free to use).

Instruments: guembri bass (plucked string with the sersera buzz), qraqeb (gnawa metal castanets, also the UI
"click"), darbuka doum/tek, a deep modern kick and claps, oud phrases in the Hijaz mode, a breathy ney, warm pads.
Harmony: the Andalusian cadence (Am G F E). Tempo 120 BPM on a triplet grid; every cue is locked to the films.
Usage: python3 soundtrack.py [15|60]  ->  out/soundtrack.wav or out/soundtrack-60.wav (48 kHz, 16-bit stereo, -14 LUFS)
"""
import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 48000
LONG = sys.argv[1:2] == ['60']
DUR = 60.0 if LONG else 15.0
N = int(SR * DUR)
BEAT = 0.5
STEP = BEAT / 3          # triplet grid: 12 steps per 2 s bar
rng = np.random.default_rng(11)


# ---------------------------------------------------------------- dsp
def env_exp(n, tau):
    return np.exp(-np.arange(n) / (tau * SR))


def one_pole(x, cutoff):
    """Low-pass; cutoff may be a scalar or a per-sample array (Hz)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for k in range(len(x)):
        acc += a[k] * (x[k] - acc)
        y[k] = acc
    return y


def hp(x, c):
    return x - one_pole(x, c)


def note(name):
    names = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    semis = names[name[0]] + (1 if '#' in name else 0) + (int(name[-1]) - 4) * 12
    return 440.0 * 2 ** (semis / 12)


def shift(f, semis):
    return f * 2 ** (semis / 12)


# Filtered noise is expensive to make sample by sample, so a few banks are made once and sliced.
_white = rng.standard_normal(SR * 8)
NOISE_BUZZ = hp(one_pole(_white, 6000), 2500)
NOISE_HIGH = hp(_white, 4000)
NOISE_MID = hp(one_pole(_white, 5000), 1200)
NOISE_LOW = one_pole(_white, 700)
NOISE_BREATH = hp(one_pole(_white, 3000), 600)


def bank(noise, n):
    if n >= len(noise):
        noise = np.tile(noise, n // len(noise) + 2)
    o = int(rng.integers(0, len(noise) - n))
    return noise[o:o + n]


# ---------------------------------------------------------------- instruments
def ks(freq, dur, tau=0.8, bright=4000, pos=0.18):
    """Karplus-Strong plucked string, vectorised one period at a time; tau is the decay time in seconds."""
    p = max(2, int(round(SR / freq)))
    n = int(dur * SR)
    exc = one_pole(rng.uniform(-1, 1, p), bright)
    exc = exc - np.roll(exc, max(1, int(p * pos))) * 0.9
    y = np.zeros(n + p + 1)
    y[1:p + 1] = exc
    d = np.exp(-p / (SR * tau))
    i = p + 1
    while i < len(y):
        e = min(i + p, len(y))
        y[i:e] = d * 0.5 * (y[i - p:e - p] + y[i - p - 1:e - p - 1])
        i = e
    out = y[1:n + 1] * np.minimum(1, (n - np.arange(n)) / (0.012 * SR))
    return out / (np.max(np.abs(exc)) + 1e-9)


def guembri(freq, dur=0.5, gain=1.0):
    s = ks(freq, dur, tau=0.42, bright=1600, pos=0.12)
    n = len(s)
    tt = np.arange(n) / SR
    body = np.sin(2 * np.pi * freq * tt) * env_exp(n, 0.05) * 0.45
    slap = bank(NOISE_MID, n) * env_exp(n, 0.005) * 0.35
    buzz = bank(NOISE_BUZZ, n) * one_pole(np.abs(s), 40) * 0.9
    return np.tanh((s + body + slap + buzz) * 1.4) * gain


def oud(freq, dur=0.8, gain=1.0):
    s = ks(freq, dur, tau=0.75, bright=5200, pos=0.14)
    return np.tanh(s * 1.2) * gain


def oud_tremolo(freq, dur, rate=0.055, gain=1.0):
    n = int(dur * SR)
    out = np.zeros(n)
    t, k = 0.0, 0
    while t < dur - 0.05:
        g = (0.55 + 0.45 * (k % 2 == 0)) * (1 - 0.6 * t / dur)
        s = oud(freq, min(0.6, dur - t), g)
        i = int(t * SR)
        out[i:i + len(s)] += s[: n - i]
        t, k = t + rate, k + 1
    return out * gain


QR_FREQS = [2350, 3410, 4720, 5930, 7680, 9100]


def qraqeb(gain=1.0, pitch=1.0):
    n = int(0.11 * SR)
    tt = np.arange(n) / SR
    j = pitch * (1 + rng.normal(0, 0.015))
    tone = sum(np.sin(2 * np.pi * f * j * tt + rng.uniform(0, 6.3)) * np.exp(-tt / (0.01 + 0.03 * rng.random())) for f in QR_FREQS) / len(QR_FREQS)
    x = tone * 0.9 + bank(NOISE_HIGH, n) * env_exp(n, 0.007) * 0.7
    flam = int(rng.uniform(0.004, 0.011) * SR)
    y = x.copy()
    y[flam:] += x[:-flam] * 0.55
    return y * gain


def doum(gain=1.0):
    n = int(0.4 * SR)
    tt = np.arange(n) / SR
    f = 72 + 55 * np.exp(-tt / 0.025)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.2)
    skin = bank(NOISE_LOW, n) * env_exp(n, 0.03) * 1.5
    return np.tanh((body + skin) * 1.3) * gain


def tek(gain=1.0, pitch=1.0):
    n = int(0.14 * SR)
    tt = np.arange(n) / SR
    ping = (np.sin(2 * np.pi * 640 * pitch * tt) + 0.4 * np.sin(2 * np.pi * 1290 * pitch * tt)) * env_exp(n, 0.03)
    slap = bank(NOISE_MID, n) * env_exp(n, 0.018) * 1.2
    return (ping * 0.6 + slap) * gain


def kick(gain=1.0):
    n = int(0.5 * SR)
    tt = np.arange(n) / SR
    f = 54 + 95 * np.exp(-tt / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.22)
    click = bank(NOISE_MID, n) * env_exp(n, 0.002) * 0.4
    return np.tanh((body + click) * 1.7) * gain


def clap(gain=1.0):
    n = int(0.3 * SR)
    src = bank(NOISE_MID, n)
    e = np.zeros(n)
    for d in (0.0, 0.009, 0.019):
        i = int(d * SR)
        e[i:] += env_exp(n - i, 0.005)
    e += np.concatenate([np.zeros(int(0.019 * SR)), env_exp(n - int(0.019 * SR), 0.07) * 0.5])
    return src * e * gain


def boom(gain=1.0):
    n = int(1.8 * SR)
    tt = np.arange(n) / SR
    f = 40 + 70 * np.exp(-tt / 0.1)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.4)
    air = bank(NOISE_LOW, n) * env_exp(n, 0.3) * 1.2
    return np.tanh((sub + air) * 1.3) * gain


def glass(freq, dur=1.0, gain=1.0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    x = sum(a * np.sin(2 * np.pi * freq * r * tt) * np.exp(-tt / (dur * d)) for r, a, d in [(1, 1, 0.35), (2.76, 0.4, 0.15), (5.4, 0.18, 0.07)])
    return x * np.minimum(1, tt / 0.002) * gain


def pad(freqs, dur, gain=1.0, attack=0.4, release=0.8, cutoff=1500):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    x = np.zeros(n)
    for f in freqs:
        for det, pan in ((-0.09, 0), (0.0, 0), (0.09, 0)):
            ph = 2 * np.pi * shift(f, det) * tt + rng.uniform(0, 6.3)
            x += sum(np.sin(h * ph) / h for h in range(1, 9))
    lfo = cutoff * (1 + 0.35 * np.sin(2 * np.pi * 0.25 * tt))
    x = one_pole(x, lfo)
    a = np.minimum(1, tt / attack)
    r = np.minimum(1, (dur - tt) / release)
    return x * a * r * gain / (len(freqs) * 3)


def ney(points, dur, gain=1.0):
    """points: [(time, note-frequency)] with glides between them."""
    n = int(dur * SR)
    tt = np.arange(n) / SR
    ts = [p[0] for p in points] + [dur]
    f = np.zeros(n)
    for k, (t0, f0) in enumerate(points):
        i0, i1 = int(t0 * SR), int(ts[k + 1] * SR)
        f[i0:i1] = f0
        if k:
            g = min(int(0.07 * SR), i1 - i0)
            f[i0:i0 + g] = np.linspace(points[k - 1][1], f0, g)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * tt) * np.minimum(1, tt / 0.6)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    tone = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.07 * np.sin(3 * ph)
    breath = bank(NOISE_BREATH, n) * 0.22
    amp = np.minimum(1, tt / 0.18) * np.minimum(1, (dur - tt) / 0.4) * (1 + 0.08 * np.sin(2 * np.pi * 0.7 * tt))
    return (tone + breath) * amp * gain


def whoosh(dur=0.45, f0=300, f1=6000, gain=1.0, rise=0.7):
    n = int(dur * SR)
    x = bank(_white, n)
    sweep = f0 * (f1 / f0) ** np.linspace(0, 1, n)
    y = one_pole(x, sweep) - one_pole(x, sweep * 0.25)
    u = np.linspace(0, 1, n)
    shape = np.minimum(u / rise, 1) ** 2 * np.minimum(1, (1 - u) / (1 - rise + 1e-6))
    return y * shape * gain * 2.0


def riser(dur, gain=1.0):
    n = int(dur * SR)
    x = bank(_white, n)
    return one_pole(x, 200 * (40 ** np.linspace(0, 1, n))) * np.linspace(0, 1, n) ** 2.5 * gain


def swell(sig, gain=1.0):
    """Reverse reverb of a sound, to place so that it ends on a hit."""
    tail = np.convolve(sig[: int(0.15 * SR)], IR_SHORT)[: int(1.0 * SR)]
    return tail[::-1] * gain / (np.max(np.abs(tail)) + 1e-9)


IR_SHORT = bank(NOISE_MID, int(1.0 * SR)) * env_exp(int(1.0 * SR), 0.25)


# ---------------------------------------------------------------- buses
def bus():
    return np.zeros((N, 2))


drums, low, music, sfx, verb = bus(), bus(), bus(), bus(), bus()
side = np.zeros(N)


def place(b, t, sig, gain=1.0, pan=0.0, send=0.0):
    i = int(round(t * SR))
    if i >= N or i < 0:
        return
    j = min(N, i + len(sig))
    s = sig[: j - i] * gain
    lr = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)]) * np.sqrt(2)
    b[i:j] += s[:, None] * lr
    if send:
        verb[i:j] += s[:, None] * lr * send


def duck(t, depth=1.0):
    i = int(t * SR)
    n = min(int(0.4 * SR), N - i)
    if n > 0:
        side[i:i + n] = np.maximum(side[i:i + n], env_exp(n, 0.11) * depth)


# ---------------------------------------------------------------- patterns
RIFF = [(0, 0, 3), (3, 0, 2), (5, 3, 1), (6, 5, 2), (8, 3, 1), (9, 0, 2), (11, -2, 1)]   # (step, semitones, length)
DARBUKA = {0: 'D', 3: 'T', 5: 'K', 6: 'D', 8: 'K', 9: 'T', 11: 'K'}
CADENCE = [('A1', ['A3', 'C4', 'E4']), ('G1', ['G3', 'B3', 'D4']), ('F1', ['F3', 'A3', 'C4']), ('E1', ['E3', 'G#3', 'B3'])]


def groove(start, end, *, kick_on=True, darb=True, qr=True, claps=False, bass_on=True, pads=True, fills=False, chords=CADENCE, energy=1.0):
    t, b = start, 0
    while t < end - 1e-6:
        root, chord = chords[b % len(chords)]
        bar_end = min(t + 4 * BEAT, end)
        if pads:
            place(music, t, pad([note(c) for c in chord], bar_end - t + 0.6, 0.55 * energy, attack=0.15, release=0.5), send=0.25)
        for s in range(12):
            ts = t + s * STEP
            if ts >= bar_end - 1e-6:
                break
            if kick_on and s % 3 == 0:
                place(drums, ts, kick(0.95 * energy))
                duck(ts)
            if darb and s in DARBUKA:
                k = DARBUKA[s]
                if k == 'D':
                    place(drums, ts, doum(0.55 * energy), send=0.08)
                else:
                    place(drums, ts, tek((0.45 if k == 'T' else 0.25) * energy, 1.0 if k == 'T' else 0.85), pan=0.2, send=0.12)
            if qr:
                g = [0.42, 0.0, 0.3][s % 3]
                if fills and s % 3 == 1 and rng.random() < 0.55:
                    g = 0.16
                if g:
                    place(drums, ts + rng.normal(0, 0.003), qraqeb(g * energy), pan=-0.35 if s % 3 == 0 else 0.35, send=0.1)
            if claps and s in (3, 9):
                place(drums, ts, clap(0.5 * energy), send=0.25)
        if bass_on:
            for s, semi, ln in RIFF:
                ts = t + s * STEP
                if ts < bar_end - 1e-6:
                    place(low, ts, guembri(shift(note(root), semi), ln * STEP + 0.08, 0.75 * energy))
        t, b = bar_end, b + 1


def qr_roll(start, dur, gain=0.35, accel=True):
    t = start
    while t < start + dur:
        u = (t - start) / dur
        place(drums, t, qraqeb(gain * (0.4 + 0.6 * u)), pan=rng.uniform(-0.5, 0.5), send=0.1)
        t += STEP * (1 - 0.6 * u) if accel else STEP / 2


def darb_roll(start, dur, gain=0.4):
    t, k = start, 0
    while t < start + dur:
        u = (t - start) / dur
        place(drums, t, tek(gain * (0.3 + 0.7 * u), 1.0 if k % 2 else 0.85), pan=0.2 if k % 2 else -0.2, send=0.1)
        t, k = t + STEP / 2 * (1 - 0.5 * u), k + 1


def hit(t, gain=1.0):
    place(drums, t, boom(0.8 * gain), send=0.3)
    place(drums, t, doum(0.8 * gain), send=0.2)
    place(drums, t, kick(gain))
    place(drums, t, clap(0.45 * gain), send=0.4)
    place(sfx, t - 1.0, swell(qraqeb(1.0), 0.18 * gain), send=0.1)
    duck(t)


def strum(t, notes, gain=0.3, gap=0.025):
    for i, n_ in enumerate(notes):
        place(music, t + i * gap, oud(note(n_), 1.6, gain), pan=-0.3 + 0.2 * i, send=0.35)


def phrase(t, notes, step=STEP, gain=0.28, dur=0.6):
    for i, n_ in enumerate(notes):
        if n_:
            place(music, t + i * step, oud(note(n_), dur, gain), pan=0.15, send=0.3)


def tick(t, gain=0.12, pitch=1.6):
    place(sfx, t, qraqeb(gain, pitch), pan=0.1, send=0.05)


def bell(t, n_, gain=0.12, dur=1.0):
    place(sfx, t, glass(note(n_), dur, gain), pan=0.1, send=0.35)


def press(t):
    place(sfx, t, tek(0.12, 1.4))


def wh(t, *args, **kw):
    place(sfx, t, whoosh(*args, **kw), send=0.2)


def scan(t, dur):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    place(sfx, t, np.sin(2 * np.pi * np.cumsum(700 + 900 * tt / dur) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 24 * tt)) * 0.035, send=0.2)


def scratch(t, dur):
    n = int(dur * SR)
    place(sfx, t, bank(NOISE_MID, n) * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * np.arange(n) / SR)) * np.hanning(n) * 0.18)


def counter(start, dur, count, gain=0.09):
    for i in range(count):
        tick(start + dur * (1 - (1 - i / count) ** (1 / 3)), gain, 1.5 + 0.4 * i / count)


# ---------------------------------------------------------------- arrangements
def arrange_15():
    # Hook: a Hijaz climb on the four words, qraqeb accelerating into the lime "Sorted." hit.
    for i, t in enumerate([0.0, 0.5, 1.0, 1.5]):
        place(drums, t, doum(0.75), send=0.2)
        place(drums, t, kick(0.6))
        place(music, t, oud(note(['A3', 'A#3', 'C#4', 'D4'][i]), 0.6, 0.35), send=0.3)
        place(drums, t, qraqeb(0.35), pan=-0.3)
    place(low, 0.0, guembri(note('A1'), 2.0, 0.5))
    qr_roll(1.5, 0.5, 0.35)
    place(sfx, 0.0, riser(2.0, 0.22))
    hit(2.0)
    strum(2.02, ['A3', 'E4', 'A4', 'C#5'], 0.3)
    # Logo: glass on the pop, a descending Hijaz phrase on the check and bars.
    wh(2.5, 0.25, 800, 7000, 0.3, rise=0.6)
    bell(2.6, 'A5', 0.14, 1.4)
    for t, n_ in zip([3.1, 3.22, 3.32, 3.38, 3.44], ['E5', 'D5', 'C#5', 'A#4', 'A4']):
        place(music, t, oud(note(n_), 0.7, 0.28), pan=0.2, send=0.3)
    for t in [3.0, 3.5, 4.0]:
        place(drums, t, doum(0.5), send=0.15)
        place(drums, t, qraqeb(0.3), pan=-0.3)
        place(drums, t + 2 * STEP, qraqeb(0.2), pan=0.3)
    place(music, 2.5, pad([note(c) for c in ['A3', 'C#4', 'E4']], 2.0, 0.4, attack=0.6), send=0.3)
    wh(3.7, 0.35, 300, 3000, 0.2, rise=0.5)
    wh(4.1, 0.55, 150, 12000, 0.5, rise=0.85)
    # Groove 4.5 - 11.5.
    groove(4.5, 11.5, claps=True, fills=True)
    counter(5.15, 1.25, 29)
    bell(5.9, 'E6', 0.1); bell(5.98, 'A6', 0.1)
    wh(6.72, 0.4, 250, 8000, 0.5, rise=0.75)
    tick(7.25, 0.15, 2.0)
    scan(7.5, 0.65)
    bell(8.15, 'E6', 0.12); bell(8.25, 'B6', 0.1)
    for f in range(3):
        for d in range(8):
            tick(8.2 + f * 0.13 + d * 0.0275, 0.05, 2.2)
    press(8.7)
    wh(8.78, 0.35, 600, 5000, 0.25, rise=0.4)
    wh(9.22, 0.45, 200, 10000, 0.5, rise=0.8)
    phrase(9.6, ['A4', None, None, 'C5', None, None, 'E5'], gain=0.24)
    for i in range(5):
        bell(10.05 + i * 0.13, ['A5', 'C6', 'D6', 'E6', 'G6'][i], 0.08, 0.5)
    for i in range(6):
        tick(10.4 + i * 0.07, 0.07, 1.4 + i * 0.1)
    press(10.95)
    place(low, 11.08, guembri(note('E1'), 0.6, 0.6))
    # Build and end card: the Andalusian cadence resolves F - E - A.
    place(sfx, 10.8, riser(0.9, 0.3))
    darb_roll(11.0, 0.68, 0.4)
    qr_roll(11.2, 0.48, 0.3)
    wh(11.5, 0.3, 300, 9000, 0.4, rise=0.85)
    hit(11.7)
    for t0, t1, chord, root in [(11.7, 12.95, ['F3', 'A3', 'C4', 'E4'], 'F1'), (12.95, 13.7, ['E3', 'G#3', 'B3', 'D4'], 'E1'), (13.7, 15.0, ['A3', 'C#4', 'E4', 'A4'], 'A1')]:
        place(music, t0, pad([note(c) for c in chord], t1 - t0 + 0.5, 0.55, attack=0.05, release=0.5), send=0.3)
        place(low, t0, guembri(note(root), min(1.2, t1 - t0), 0.6))
    place(music, 11.9, ney([(0, note('A4')), (0.5, note('C5')), (1.05, note('B4')), (1.6, note('G#4')), (1.95, note('A4'))], 3.1, 0.12), send=0.4)
    strum(12.95, ['E3', 'B3', 'E4', 'G#4'], 0.22)
    place(music, 13.7, oud_tremolo(note('A4'), 1.2, gain=0.22), send=0.35)
    strum(13.7, ['A3', 'E4', 'A4', 'C#5'], 0.2)
    place(drums, 12.95, kick(0.55)); place(drums, 12.95, qraqeb(0.3))
    wh(13.55, 0.6, 3000, 14000, 0.15, rise=0.5)
    for t in [13.7, 14.2]:
        place(drums, t, doum(0.4), send=0.2)


def arrange_60():
    # Hook 0 - 2.
    for i, t in enumerate([0.0, 0.5, 1.0, 1.5]):
        place(drums, t, doum(0.75), send=0.2)
        place(drums, t, kick(0.6))
        place(music, t, oud(note(['A3', 'A#3', 'C#4', 'D4'][i]), 0.6, 0.35), send=0.3)
        place(drums, t, qraqeb(0.35), pan=-0.3)
    place(low, 0.0, guembri(note('A1'), 2.0, 0.5))
    place(sfx, 0.0, riser(2.0, 0.2))
    place(drums, 2.0, boom(0.5), send=0.3)
    # Chaos 2 - 7: guembri on a dissonant A/Bb drone, uneven qraqeb, a heavy doum per prop, pen, strikes, shake.
    groove(2.0, 6.0, kick_on=False, claps=False, pads=False, fills=True, chords=[('A1', [])], energy=0.8)
    n = int(5.0 * SR)
    tt = np.arange(n) / SR
    drone = np.sin(2 * np.pi * note('A2') * tt) + np.sin(2 * np.pi * note('A#2') * tt) * 0.8
    place(music, 2.0, drone * np.minimum(1, tt / 0.4) * np.minimum(1, (5.0 - tt) / 0.2) * (0.08 + 0.08 * tt / 5.0), send=0.3)
    for t in [2.2, 3.2, 4.2, 5.2]:
        wh(t - 0.15, 0.2, 500, 6000, 0.3, rise=0.85)
        place(drums, t + 0.04, doum(0.9), send=0.3)
        place(drums, t + 0.04, boom(0.3))
    for t in [2.4, 2.55, 2.95]:
        tick(t, 0.12, 1.2)
    for i in range(6):
        scratch(4.35 + i * 0.12, 0.25)
    for i in range(4):
        wh(5.4 + i * 0.1, 0.08, 2000, 8000, 0.15, rise=0.3)
    place(sfx, 6.0, riser(0.85, 0.35))
    qr_roll(6.2, 0.65, 0.4)
    wh(6.8, 0.25, 9000, 300, 0.45, rise=0.95)
    # The turn 7 - 12: bright A major, then the logo.
    hit(7.0)
    strum(7.02, ['A3', 'E4', 'A4', 'C#5', 'E5'], 0.3)
    place(music, 7.0, pad([note(c) for c in ['A3', 'C#4', 'E4']], 5.0, 0.45, attack=0.4, release=0.6), send=0.35)
    place(music, 7.15, ney([(0, note('E5')), (0.45, note('C#5')), (0.8, note('A4'))], 1.5, 0.1), send=0.4)
    wh(7.95, 0.25, 800, 7000, 0.3, rise=0.6)
    bell(8.05, 'A5', 0.14, 1.4)
    for t, n_ in zip([8.55, 8.67, 8.77, 8.83, 8.89], ['E5', 'D5', 'C#5', 'A#4', 'A4']):
        place(music, t, oud(note(n_), 0.7, 0.28), pan=0.2, send=0.3)
    for t in np.arange(8.5, 11.5, 0.5):
        place(drums, t, doum(0.45), send=0.15)
        place(drums, t, qraqeb(0.28), pan=-0.3)
        place(drums, t + 2 * STEP, qraqeb(0.18), pan=0.3)
    place(low, 9.0, guembri(note('A1'), 1.0, 0.5))
    place(low, 10.0, guembri(note('A1'), 1.0, 0.5))
    wh(9.15, 0.35, 300, 3000, 0.2, rise=0.5)
    for i in range(4):
        bell(9.9 + i * 0.12, ['E5', 'A5', 'C#6', 'E6'][i], 0.08, 0.6)
    place(sfx, 11.1, riser(0.9, 0.28))
    qr_roll(11.0, 0.95, 0.3)
    wh(11.45, 0.55, 150, 12000, 0.5, rise=0.85)
    # Features 12 - 48.
    groove(12.0, 26.0)
    groove(26.0, 41.0, claps=True, fills=True)
    groove(41.0, 47.0, claps=True, fills=True, energy=1.05)
    groove(47.0, 48.0, kick_on=False, darb=False, qr=False, energy=0.9)
    for t in [12.0, 20.0, 26.0, 34.0, 42.0]:
        phrase(t + 0.5, ['E5', 'D5', 'C5', None, 'B4', None, 'A4'], gain=0.2)
    #  calendars
    for i in range(3):
        tick(12.5 + i * 0.15, 0.12, 1.2 + i * 0.15)
    wh(13.0, 0.5, 400, 4000, 0.18, rise=0.6)
    for k in range(7):
        tick(13.6 + k * 0.38, 0.06, 2.0)
        bell(14.15 + k * 0.38, ['A5', 'C6', 'E6', 'G6', 'A6', 'E6', 'C6'][k], 0.07, 0.5)
    bell(16.6, 'E6', 0.1); bell(16.68, 'A6', 0.1)
    place(low, 17.05, guembri(note('E2'), 0.3, 0.4)); place(low, 17.17, guembri(note('C2'), 0.4, 0.4))
    wh(18.92, 0.4, 250, 8000, 0.5, rise=0.75)
    #  night counter
    counter(19.6, 1.4, 29)
    counter(21.9, 0.8, 5, 0.12)
    place(music, 22.34, oud(note('A#4'), 0.6, 0.3), send=0.3); place(music, 22.46, oud(note('A4'), 0.8, 0.3), send=0.3)
    wh(22.85, 0.3, 600, 6000, 0.25, rise=0.5)
    bell(23.05, 'B5', 0.12); bell(23.17, 'E6', 0.12)
    #  check-in
    for i in range(10):
        tick(25.95 + i * 0.03, 0.06, 1.0 + i * 0.05)
    wh(25.9, 0.45, 300, 6000, 0.4, rise=0.8)
    tick(26.8, 0.1, 1.3)
    press(27.55)
    wh(27.65, 0.65, 400, 9000, 0.28, rise=0.6)
    bell(28.3, 'E6', 0.12); bell(28.4, 'B6', 0.1)
    tick(28.9, 0.12, 2.0)
    scan(29.1, 0.6)
    bell(29.75, 'E6', 0.12); bell(29.85, 'B6', 0.1)
    for f in range(3):
        for d in range(8):
            tick(29.8 + f * 0.13 + d * 0.0275, 0.05, 2.2)
    tick(30.25, 0.08, 1.6)
    press(30.55)
    press(30.9)
    wh(31.0, 0.4, 600, 5000, 0.3, rise=0.4)
    wh(31.2, 0.3, 1500, 7000, 0.12, rise=0.5)
    bell(31.6, 'A5', 0.11); bell(31.7, 'E6', 0.11)
    #  register and share
    wh(33.75, 0.45, 200, 10000, 0.5, rise=0.8)
    for i in range(6):
        tick(34.6 + i * 0.12, 0.08, 1.3 + i * 0.08)
    place(music, 35.0, oud(note('A#3'), 0.6, 0.3), send=0.3)
    bell(36.0, 'A5', 0.12); bell(36.1, 'E6', 0.1)
    press(36.5)
    bell(36.65, 'C#6', 0.11); bell(36.75, 'A6', 0.1)
    wh(36.95, 0.35, 500, 5000, 0.22, rise=0.5)
    for t in np.arange(37.5, 39.4, 0.5):
        tick(t, 0.05, 2.4)
    for t in [38.0, 38.6]:
        tick(t, 0.1, 1.5)
    press(39.5)
    place(low, 39.6, guembri(note('E1'), 0.6, 0.6))
    #  tax
    wh(40.75, 0.3, 400, 6000, 0.35, rise=0.9)
    place(drums, 41.36, doum(0.6), send=0.2)
    for i in range(7):
        bell(41.8 + i * 0.07, ['A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7'][i], 0.05, 0.4)
    counter(41.9, 1.2, 16, 0.06)
    wh(43.6, 0.3, 500, 4000, 0.18, rise=0.5)
    for t in [44.3, 44.7]:
        press(t)
        wh(t + 0.1, 0.55, 800, 7000, 0.18, rise=0.5)
    bell(45.45, 'E6', 0.12); bell(45.55, 'A6', 0.12)
    place(sfx, 47.0, riser(1.0, 0.3))
    darb_roll(47.0, 0.95, 0.45)
    qr_roll(47.2, 0.75, 0.3)
    wh(47.75, 0.3, 300, 9000, 0.4, rise=0.85)
    # Privacy breakdown 48 - 54: no drums, the ney sings over the cadence, bells on the tiles.
    place(drums, 48.0, boom(0.55), send=0.4)
    for t0, chord, root in [(48.0, ['A3', 'C4', 'E4'], 'A1'), (50.0, ['F3', 'A3', 'C4'], 'F1'), (52.0, ['A3', 'C4', 'E4'], 'A1'), (53.0, ['E3', 'G#3', 'B3'], 'E1')]:
        d = 2.0 if t0 < 53 else 1.0
        place(music, t0, pad([note(c) for c in chord], d + 0.5, 0.55, attack=0.3, release=0.6, cutoff=1100), send=0.4)
        place(low, t0, guembri(note(root), d, 0.45))
    place(music, 48.3, ney([(0, note('E5')), (1.1, note('F5')), (1.6, note('E5')), (2.1, note('D5')), (2.7, note('C5')), (3.3, note('B4')), (3.7, note('C5')), (4.3, note('B4')), (4.7, note('G#4')), (5.2, note('A4'))], 5.9, 0.13), send=0.45)
    for i in range(4):
        bell(49.4 + i * 0.4, ['E5', 'A5', 'C6', 'E6'][i], 0.09, 1.2)
    press(49.8)
    for t in np.arange(50.0, 53.0, 1.0):
        place(drums, t, qraqeb(0.14), pan=-0.4, send=0.3)
        place(drums, t + 2 * STEP, qraqeb(0.1), pan=0.4, send=0.3)
    for t in [52.0, 53.0]:
        wh(t, 0.8, 3000, 12000, 0.08, rise=0.3)
    place(sfx, 53.0, riser(1.0, 0.35))
    darb_roll(53.0, 0.95, 0.45)
    qr_roll(53.3, 0.65, 0.32)
    # Drop 54 - 56: everything, the oud doubles the riff two octaves up.
    hit(54.0)
    groove(54.0, 56.0, claps=True, fills=True, energy=1.1)
    for t0 in (54.0, 56.0 - 4 * BEAT):
        for s, semi, ln in RIFF:
            place(music, t0 + s * STEP, oud(shift(note('A3'), semi), ln * STEP + 0.2, 0.18), pan=0.25, send=0.25)
    wh(55.75, 0.3, 9000, 300, 0.4, rise=0.95)
    # End card 56 - 60: F - E - A, ney and oud tremolo on the final A.
    hit(56.05)
    for t0, t1, chord, root in [(56.05, 57.3, ['F3', 'A3', 'C4', 'E4'], 'F1'), (57.3, 58.3, ['E3', 'G#3', 'B3', 'D4'], 'E1'), (58.3, 60.0, ['A3', 'C#4', 'E4', 'A4'], 'A1')]:
        place(music, t0, pad([note(c) for c in chord], t1 - t0 + 0.6, 0.55, attack=0.05, release=0.6), send=0.35)
        place(low, t0, guembri(note(root), min(1.3, t1 - t0), 0.6))
    place(music, 56.3, ney([(0, note('A4')), (0.5, note('C5')), (1.0, note('B4')), (1.6, note('G#4')), (2.0, note('A4'))], 3.6, 0.12), send=0.45)
    strum(57.3, ['E3', 'B3', 'E4', 'G#4'], 0.22)
    place(drums, 57.3, kick(0.55)); place(drums, 57.3, qraqeb(0.3))
    strum(58.3, ['A3', 'E4', 'A4', 'C#5'], 0.22)
    place(music, 58.3, oud_tremolo(note('A4'), 1.4, gain=0.2), send=0.35)
    for t in [57.9, 59.0]:
        wh(t, 0.6, 3000, 14000, 0.14, rise=0.5)
    for t in [58.3, 58.8]:
        place(drums, t, doum(0.4), send=0.2)


# ---------------------------------------------------------------- mix and master
def reverb_ir(seconds, seed):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    white = r.standard_normal(n)
    bright, dark = white - one_pole(white, 2500), one_pole(white, 2500)
    ir = bright * np.exp(-tt / (seconds / 9)) + dark * np.exp(-tt / (seconds / 4.5))
    pre = int(0.018 * SR)
    ir = np.concatenate([np.zeros(pre), ir])
    for d, a in [(0.011, 0.5), (0.017, 0.4), (0.023, 0.35), (0.031, 0.3), (0.041, 0.25)]:
        ir[int(d * SR)] += a * (1 if r.random() > 0.5 else -1) * 8
    return ir / np.sqrt(np.sum(ir ** 2))


def convolve(x, ir):
    size = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]


(arrange_60 if LONG else arrange_15)()

gate = 1 - 0.55 * one_pole(np.minimum(1, side), 80)
low *= gate[:, None]
music *= (1 - 0.35 * (1 - gate))[:, None]
wet = np.stack([convolve(verb[:, 0], reverb_ir(1.8, 1)), convolve(verb[:, 1], reverb_ir(1.8, 2))], axis=1)
low_mono = low.mean(axis=1, keepdims=True)
mix = drums * 1.0 + low_mono * np.ones((1, 2)) * 0.8 + music * 1.15 + sfx * 0.95 + wet * 0.55

# Master EQ (zero phase): high-pass at 30 Hz, -5 dB shelf under 80 Hz, +2.5 dB presence from 3 kHz, so it
# translates to phone and laptop speakers.
spec_f = np.fft.rfftfreq(N, 1 / SR)
curve = (1 / np.sqrt(1 + (30 / np.maximum(spec_f, 1)) ** 4))
curve *= 10 ** ((-5 / (1 + (spec_f / 80) ** 2)) / 20)
curve *= 10 ** ((2.5 / (1 + (3000 / np.maximum(spec_f, 1)) ** 2)) / 20)
mix = np.stack([np.fft.irfft(np.fft.rfft(mix[:, c]) * curve, N) for c in range(2)], axis=1)

# Glue compression on the sum, then a soft-knee peak limiter.
level = np.sqrt(one_pole(np.mean(mix ** 2, axis=1), 8) + 1e-12)
ref = np.percentile(level, 90)
over = np.maximum(1, level / (ref * 0.7))
mix *= (over ** (1 / 2.5 - 1))[:, None]
peak = np.abs(mix).max(axis=1)
win = int(0.004 * SR)
padded = np.concatenate([peak, np.zeros(win)])
look = np.lib.stride_tricks.sliding_window_view(padded, win + 1).max(axis=1)[: len(peak)]
ceiling = np.percentile(look, 99.5)
gain = np.minimum(1, ceiling / (look + 1e-12))
gain = -one_pole(-gain, 30)
mix = np.tanh(mix * gain[:, None] / ceiling * 0.95)
fade = np.ones(N)
fade[-int(0.6 * SR):] = np.linspace(1, 0, int(0.6 * SR)) ** 2
fade[:240] = np.linspace(0, 1, 240)
mix *= fade[:, None]
mix *= 0.9 / np.max(np.abs(mix))

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, 'soundtrack-60.wav' if LONG else 'soundtrack.wav')
raw = path + '.raw.wav'
with wave.open(raw, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())

# Two-pass loudness normalisation to -14 LUFS, true peak -1 dBTP (the usual target for social video).
probe = subprocess.run(['ffmpeg', '-hide_banner', '-i', raw, '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr
m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
af = f"loudnorm=I=-14:TP=-1:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', af, '-ar', str(SR), '-c:a', 'pcm_s16le', path], check=True)
os.remove(raw)
print('wrote', path)
