"""Synthesises the 15 s soundtrack for promo.html (120 BPM, cues locked to the visual timeline).

Everything is generated here (no samples, no third-party audio), so the track is free to use.
Usage: python3 soundtrack.py [15|60]  ->  out/soundtrack.wav or out/soundtrack-60.wav (48 kHz, 16-bit stereo)
"""
import os
import sys
import wave

import numpy as np

SR = 48000
LONG = sys.argv[1:2] == ['60']
DUR = 60.0 if LONG else 15.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def track():
    return np.zeros(N)


def place(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= N:
        return
    j = min(N, i + len(sig))
    buf[i:j] += sig[: j - i] * gain


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


def saw(freq, n, harmonics=10):
    ph = 2 * np.pi * freq * np.arange(n) / SR
    return sum(np.sin(h * ph) / h for h in range(1, harmonics + 1)) * 0.6


def note(name):
    names = {'C': -9, 'D': -7, 'E': -5, 'F': -4, 'G': -2, 'A': 0, 'B': 2}
    semis = names[name[0]] + (1 if '#' in name else 0) + (int(name[-1]) - 4) * 12
    return 440.0 * 2 ** (semis / 12)


# ---------------------------------------------------------------- instruments
def kick(gain=1.0):
    n = int(0.45 * SR)
    tt = np.arange(n) / SR
    f = 45 + 110 * np.exp(-tt / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.16)
    click = rng.standard_normal(n) * env_exp(n, 0.003) * 0.3
    return np.tanh((body + click) * 1.6) * gain


def snare(gain=1.0):
    n = int(0.3 * SR)
    noise = one_pole(rng.standard_normal(n), 6000) - one_pole(rng.standard_normal(n), 400) * 0.3
    tone = np.sin(2 * np.pi * 190 * np.arange(n) / SR) * env_exp(n, 0.04)
    return (noise * env_exp(n, 0.07) * 0.9 + tone * 0.5) * gain


def hat(gain=1.0):
    n = int(0.08 * SR)
    x = rng.standard_normal(n)
    x = x - one_pole(x, 7000)
    return x * env_exp(n, 0.018) * gain


def pluck(freq, dur=0.6, gain=1.0, bright=6):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    mod = np.sin(2 * np.pi * freq * 2 * tt) * bright * np.exp(-tt / 0.08)
    return np.sin(2 * np.pi * freq * tt + mod) * env_exp(n, dur / 4) * gain


def blip(freq, dur=0.05, gain=1.0):
    n = int(dur * SR)
    return np.sin(2 * np.pi * freq * np.arange(n) / SR) * env_exp(n, dur / 5) * gain


def whoosh(dur=0.45, f0=300, f1=6000, gain=1.0, rise=0.7):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    sweep = f0 * (f1 / f0) ** np.linspace(0, 1, n)
    y = one_pole(x, sweep) - one_pole(x, sweep * 0.25)
    shape = np.minimum(np.linspace(0, 1, n) / rise, 1) ** 2 * np.minimum(1, (1 - np.linspace(0, 1, n)) / (1 - rise + 1e-6))
    return y * shape * gain * 2.2


def riser(dur, gain=1.0):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    y = one_pole(x, 200 * (40 ** np.linspace(0, 1, n)))
    return y * np.linspace(0, 1, n) ** 2.5 * gain


def boom(gain=1.0):
    n = int(1.6 * SR)
    tt = np.arange(n) / SR
    f = 30 + 60 * np.exp(-tt / 0.12)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_exp(n, 0.55)
    air = one_pole(rng.standard_normal(n), 2500) * env_exp(n, 0.25) * 0.6
    return np.tanh((sub + air) * 1.4) * gain


def pad_chord(freqs, dur, gain=1.0, attack=0.25, release=0.5):
    n = int(dur * SR)
    out = np.zeros(n)
    for f in freqs:
        for det in (-0.12, 0.0, 0.12):
            out += saw(f * 2 ** (det / 12), n, harmonics=6)
    a = np.minimum(1, np.arange(n) / (attack * SR))
    r = np.minimum(1, (n - np.arange(n)) / (release * SR))
    return out * a * r * gain / (len(freqs) * 3)


def bass(freq, dur, gain=1.0):
    n = int(dur * SR)
    x = saw(freq, n, harmonics=14) + np.sin(2 * np.pi * freq / 2 * np.arange(n) / SR) * 0.6
    return one_pole(x, 900) * np.minimum(1, np.arange(n) / 200) * np.minimum(1, (n - np.arange(n)) / 400) * gain


def reverb(x, seconds=1.1, seed=1):
    r = np.random.default_rng(seed)
    n = int(seconds * SR)
    ir = r.standard_normal(n) * np.exp(-np.arange(n) / (seconds / 5 * SR))
    ir = one_pole(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return y


# ---------------------------------------------------------------- arrangement
drums, music, sfx, side = track(), track(), track(), track()
beat = 0.5

if not LONG:

    # Hook (0 - 2.0): one slam per word, a riser into the lime "Sorted." hit.
    for i, t in enumerate([0.0, 0.5, 1.0, 1.5]):
        place(drums, t, kick(0.95))
        place(sfx, t, pluck(note('A5') * (1, 1.122, 1.26, 1.335)[i], 0.35, 0.22))
        place(side, t, env_exp(int(0.3 * SR), 0.12))
    place(sfx, 0.0, riser(2.0, 0.35))
    place(sfx, 1.8, whoosh(0.3, 400, 9000, 0.5, rise=0.8))
    place(drums, 2.0, boom(0.75))
    place(drums, 2.0, kick(1.0))
    place(sfx, 2.02, pluck(note('E5'), 0.9, 0.25))
    place(sfx, 2.02, pluck(note('A5'), 0.9, 0.2))

    # Logo (2.55 - 4.3): soft pop, ascending plucks on the check and the three bars.
    place(sfx, 2.5, whoosh(0.25, 800, 7000, 0.35, rise=0.6))
    place(sfx, 2.6, pluck(note('A4'), 0.8, 0.35, bright=3))
    place(sfx, 2.6, pluck(note('E5'), 0.8, 0.25, bright=3))
    for t, n_ in [(3.1, 'C#6'), (3.22, 'E6'), (3.32, 'A5'), (3.38, 'C#6'), (3.44, 'E6')]:
        place(sfx, t, pluck(note(n_), 0.4, 0.13, bright=2))
    for t in [3.0, 3.5, 4.0]:
        place(drums, t, kick(0.7))
        place(side, t, env_exp(int(0.3 * SR), 0.12))
    place(sfx, 3.7, whoosh(0.35, 300, 3000, 0.25, rise=0.5))
    place(sfx, 4.1, whoosh(0.55, 150, 12000, 0.6, rise=0.85))

    # Groove (4.5 - 11.5).
    t = 4.5
    while t < 11.5 - 1e-6:
        k = round((t - 4.5) / beat)
        place(drums, t, kick(0.9))
        place(side, t, env_exp(int(0.35 * SR), 0.12))
        if k % 2 == 1:
            place(drums, t, snare(0.42))
        place(drums, t + 0.25, hat(0.22))
        if k % 4 == 3:
            place(drums, t + 0.375, hat(0.12))
        t += beat
    progression = [(4.5, 'A', ['A3', 'C4', 'E4']), (6.5, 'F', ['F3', 'A3', 'C4']), (8.5, 'C', ['C4', 'E4', 'G4']), (10.5, 'G', ['G3', 'B3', 'D4'])]
    for start, root, chord in progression:
        end = min(start + 2.0, 11.6)
        place(music, start, pad_chord([note(c) for c in chord], end - start + 0.4, 0.5))
        rootf = note(root + '1') if root != 'C' else note('C2')
        for e in np.arange(start, end - 1e-6, 0.25):
            place(music, e, bass(rootf, 0.22, 0.55))
    place(music, 2.5, pad_chord([note(c) for c in ['A3', 'C#4', 'E4']], 2.1, 0.35, attack=0.6))

    # Scene cues.
    place(sfx, 5.0, riser(0.9, 0.1))
    for i in range(29):
        place(sfx, 5.15 + 1.25 * (1 - (1 - i / 29) ** (1 / 3)), blip(1800 + i * 25, 0.025, 0.08))
    place(sfx, 5.9, pluck(note('E6'), 0.4, 0.12, 2))
    place(sfx, 5.98, pluck(note('A6'), 0.5, 0.12, 2))
    place(sfx, 6.72, whoosh(0.4, 250, 8000, 0.55, rise=0.75))
    place(sfx, 7.25, blip(2400, 0.04, 0.12))
    n_scan = int(0.65 * SR)
    tt = np.arange(n_scan) / SR
    scan = np.sin(2 * np.pi * np.cumsum(700 + 900 * tt / 0.65) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 24 * tt)) * 0.05
    place(sfx, 7.5, scan)
    place(sfx, 8.15, pluck(note('E6'), 0.35, 0.16, 2))
    place(sfx, 8.25, pluck(note('B6'), 0.5, 0.14, 2))
    for f in range(3):
        for d in range(8):
            place(sfx, 8.2 + f * 0.13 + d * 0.0275, hat(0.09))
    place(sfx, 8.7, blip(900, 0.03, 0.2))
    place(sfx, 8.78, whoosh(0.35, 600, 5000, 0.3, rise=0.4))
    place(sfx, 9.22, whoosh(0.45, 200, 10000, 0.55, rise=0.8))
    for i, t in enumerate([9.6, 9.85, 10.1]):
        place(sfx, t, pluck(note(['A3', 'C4', 'E4'][i]), 0.4, 0.25, bright=1))
    for i in range(5):
        place(sfx, 10.05 + i * 0.13, pluck(note(['A5', 'C6', 'D6', 'E6', 'G6'][i]), 0.3, 0.1, 2))
    for i in range(6):
        place(sfx, 10.4 + i * 0.07, blip(note(['G5', 'A5', 'C6', 'D6', 'E6', 'G6'][i]), 0.06, 0.06))
    place(sfx, 10.95, blip(500, 0.04, 0.3))
    place(sfx, 11.08, pluck(note('E3'), 0.35, 0.25, bright=4))

    # Build and end card (11.5 - 15).
    place(sfx, 10.8, riser(0.9, 0.35))
    for i, t in enumerate(np.arange(11.0, 11.65, 0.0625)):
        place(drums, t, snare(0.1 + 0.25 * i / 10))
    place(sfx, 11.5, whoosh(0.3, 300, 9000, 0.45, rise=0.85))
    place(drums, 11.7, boom(0.9))
    place(drums, 11.7, kick(1.0))
    place(music, 11.7, pad_chord([note(c) for c in ['F3', 'A3', 'C4', 'E4']], 2.4, 0.55, attack=0.05, release=0.6))
    place(music, 13.7, pad_chord([note(c) for c in ['C4', 'E4', 'G4', 'D5']], 1.3, 0.55, attack=0.3, release=0.9))
    place(music, 11.7, bass(note('F1'), 2.0, 0.45))
    place(music, 13.7, bass(note('C2'), 1.3, 0.45))
    for i, n_ in enumerate(['C5', 'E5', 'G5', 'C6']):
        place(sfx, 11.9 + i * 0.09, pluck(note(n_), 0.7, 0.12, 2))
    for i, n_ in enumerate(['G5', 'C6', 'E6']):
        place(sfx, 12.95 + i * 0.06, pluck(note(n_), 0.8, 0.13, 2))
    place(drums, 12.95, kick(0.6))
    place(sfx, 13.55, whoosh(0.6, 3000, 14000, 0.18, rise=0.5))
    for t in [13.7, 14.2]:
        place(drums, t, kick(0.45))

else:
    # 60 s film: hook, chaos (tense), lime turn, logo, five feature scenes on the groove, a privacy breakdown, montage drop, end card.
    def groove(start, end, snares=True, hats16=False, gain=0.9):
        t = start
        while t < end - 1e-6:
            k = round((t - start) / beat)
            place(drums, t, kick(gain))
            place(side, t, env_exp(int(0.35 * SR), 0.12))
            if snares and k % 2 == 1:
                place(drums, t, snare(0.42))
            place(drums, t + 0.25, hat(0.22))
            if hats16:
                place(drums, t + 0.125, hat(0.1))
                place(drums, t + 0.375, hat(0.1))
            elif k % 4 == 3:
                place(drums, t + 0.375, hat(0.12))
            t += beat


    def chords(start, end, prog, pad_gain=0.5, bass_gain=0.55, arp=False):
        t, i = start, 0
        while t < end - 1e-6:
            root, chord = prog[i % len(prog)]
            e = min(t + 2.0, end)
            place(music, t, pad_chord([note(c) for c in chord], e - t + 0.4, pad_gain))
            for b in np.arange(t, e - 1e-6, 0.25):
                place(music, b, bass(note(root), 0.22, bass_gain))
            if arp:
                for j, b in enumerate(np.arange(t, e - 1e-6, 0.125)):
                    place(sfx, b, pluck(note(chord[j % len(chord)]) * 2, 0.18, 0.035, 1))
            t, i = e, i + 1


    def ticks(start, dur, count, f0=1800, step=25, gain=0.08):
        for i in range(count):
            place(sfx, start + dur * (1 - (1 - i / count) ** (1 / 3)), blip(f0 + i * step, 0.025, gain))


    def scratch(t, dur):
        n = int(dur * SR)
        x = one_pole(rng.standard_normal(n), 3500) - one_pole(rng.standard_normal(n), 900)
        place(sfx, t, x * (0.5 + 0.5 * np.sin(2 * np.pi * 9 * np.arange(n) / SR)) * np.hanning(n) * 0.25)


    PROG = [('A1', ['A3', 'C4', 'E4']), ('F1', ['F3', 'A3', 'C4']), ('C2', ['C4', 'E4', 'G4']), ('G1', ['G3', 'B3', 'D4'])]

    # Hook 0 - 2.
    for i, t in enumerate([0.0, 0.5, 1.0, 1.5]):
        place(drums, t, kick(0.95))
        place(sfx, t, pluck(note('A5') * (1, 1.122, 1.26, 1.335)[i], 0.35, 0.2))
    place(sfx, 0.0, riser(2.0, 0.25))
    place(drums, 2.0, boom(0.55))

    # Chaos 2 - 7: tense half-step drone, a slam per prop, pen and strikes, shake, suck.
    n = int(5.0 * SR)
    tt = np.arange(n) / SR
    drone = (saw(note('A1'), n, 8) + saw(note('A#1'), n, 8) * 0.7) * np.minimum(1, tt / 0.3) * np.minimum(1, (5.0 - tt) / 0.2)
    place(music, 2.0, one_pole(drone, 500 + 1500 * tt / 5.0) * 0.5)
    groove(2.0, 6.0, snares=False, gain=0.75)
    for t in [2.2, 3.2, 4.2, 5.2]:
        place(sfx, t - 0.15, whoosh(0.2, 500, 6000, 0.35, rise=0.85))
        place(drums, t + 0.05, boom(0.35))
    for t in [2.4, 2.55, 2.95]:
        place(sfx, t, blip(1300, 0.04, 0.12))
    for i in range(6):
        scratch(4.35 + i * 0.12, 0.25)
    for i in range(4):
        place(sfx, 5.4 + i * 0.1, whoosh(0.08, 2000, 8000, 0.2, rise=0.3))
    place(sfx, 6.0, riser(0.85, 0.4))
    n = int(0.65 * SR)
    place(sfx, 6.2, saw(note('A2'), n, 6) * (0.5 + 0.5 * np.sin(2 * np.pi * 16 * np.arange(n) / SR)) * np.linspace(0, 1, n) * 0.18)
    place(sfx, 6.8, whoosh(0.25, 9000, 300, 0.5, rise=0.95))

    # Lime turn and logo 7 - 12.
    place(drums, 7.0, boom(0.8)); place(drums, 7.0, kick(1.0))
    for n_ in ['A4', 'C#5', 'E5', 'A5']:
        place(sfx, 7.02, pluck(note(n_), 1.0, 0.13, 2))
    place(music, 7.0, pad_chord([note(c) for c in ['A3', 'C#4', 'E4']], 5.0, 0.4, attack=0.4, release=0.6))
    place(sfx, 7.95, whoosh(0.25, 800, 7000, 0.35, rise=0.6))
    place(sfx, 8.05, pluck(note('A4'), 0.8, 0.35, bright=3)); place(sfx, 8.05, pluck(note('E5'), 0.8, 0.25, bright=3))
    for t, n_ in [(8.55, 'C#6'), (8.67, 'E6'), (8.77, 'A5'), (8.83, 'C#6'), (8.89, 'E6')]:
        place(sfx, t, pluck(note(n_), 0.4, 0.13, bright=2))
    for t in np.arange(8.5, 11.5, 0.5):
        place(drums, t, kick(0.65)); place(side, t, env_exp(int(0.3 * SR), 0.12))
    place(sfx, 9.15, whoosh(0.35, 300, 3000, 0.25, rise=0.5))
    for i in range(4):
        place(sfx, 9.9 + i * 0.12, pluck(note(['E5', 'A5', 'C#6', 'E6'][i]), 0.4, 0.1, 2))
    place(sfx, 11.1, riser(0.9, 0.3))
    place(sfx, 11.45, whoosh(0.55, 150, 12000, 0.6, rise=0.85))

    # Features 12 - 48 on the groove.
    groove(12.0, 26.0); chords(12.0, 26.0, PROG)
    groove(26.0, 41.0); chords(26.0, 41.0, PROG, arp=True)
    groove(41.0, 47.0, hats16=True); chords(41.0, 48.0, PROG, arp=True)
    #  calendars
    for i in range(3):
        place(sfx, 12.5 + i * 0.15, blip(900 + i * 150, 0.04, 0.1))
    place(sfx, 13.0, whoosh(0.5, 400, 4000, 0.2, rise=0.6))
    for k in range(7):
        place(sfx, 13.6 + k * 0.38, blip(2200, 0.03, 0.06))
        place(sfx, 14.15 + k * 0.38, pluck(note(['A5', 'C6', 'E6', 'G6', 'A6', 'E6', 'C6'][k]), 0.3, 0.1, 2))
    place(sfx, 16.6, pluck(note('E6'), 0.4, 0.12, 2)); place(sfx, 16.68, pluck(note('A6'), 0.5, 0.12, 2))
    place(sfx, 17.05, pluck(note('E5'), 0.3, 0.12, 3)); place(sfx, 17.17, pluck(note('C5'), 0.4, 0.12, 3))
    place(sfx, 18.92, whoosh(0.4, 250, 8000, 0.55, rise=0.75))
    #  night counter
    ticks(19.6, 1.4, 29)
    ticks(21.9, 0.8, 5, 2500, 0, 0.1)
    place(sfx, 22.34, pluck(note('C5'), 0.5, 0.2, 3)); place(sfx, 22.46, pluck(note('D#5'), 0.6, 0.2, 3))
    place(sfx, 22.85, whoosh(0.3, 600, 6000, 0.3, rise=0.5))
    place(sfx, 23.05, pluck(note('B5'), 0.5, 0.14, 2)); place(sfx, 23.17, pluck(note('E6'), 0.6, 0.14, 2))
    #  check-in
    for i in range(10):
        place(sfx, 25.95 + i * 0.03, hat(0.08))
    place(sfx, 25.9, whoosh(0.45, 300, 6000, 0.45, rise=0.8))
    place(sfx, 26.8, blip(1200, 0.04, 0.12))
    place(sfx, 27.55, blip(900, 0.03, 0.22))
    place(sfx, 27.65, whoosh(0.65, 400, 9000, 0.3, rise=0.6))
    place(sfx, 28.3, pluck(note('E6'), 0.4, 0.14, 2)); place(sfx, 28.4, pluck(note('B6'), 0.5, 0.12, 2))
    place(sfx, 28.9, blip(2400, 0.04, 0.12))
    n = int(0.6 * SR); tt = np.arange(n) / SR
    place(sfx, 29.1, np.sin(2 * np.pi * np.cumsum(700 + 900 * tt / 0.6) / SR) * (0.5 + 0.5 * np.sin(2 * np.pi * 24 * tt)) * 0.05)
    place(sfx, 29.75, pluck(note('E6'), 0.35, 0.16, 2)); place(sfx, 29.85, pluck(note('B6'), 0.5, 0.14, 2))
    for f in range(3):
        for d in range(8):
            place(sfx, 29.8 + f * 0.13 + d * 0.0275, hat(0.09))
    place(sfx, 30.25, blip(1600, 0.03, 0.08))
    place(sfx, 30.55, blip(1000, 0.03, 0.18))
    place(sfx, 30.9, blip(900, 0.03, 0.22))
    place(sfx, 31.0, whoosh(0.4, 600, 5000, 0.35, rise=0.4))
    place(sfx, 31.2, whoosh(0.3, 1500, 7000, 0.15, rise=0.5))
    place(sfx, 31.6, pluck(note('A5'), 0.4, 0.13, 2)); place(sfx, 31.7, pluck(note('E6'), 0.5, 0.13, 2))
    #  register and share
    place(sfx, 33.75, whoosh(0.45, 200, 10000, 0.55, rise=0.8))
    for i in range(6):
        place(sfx, 34.6 + i * 0.12, blip(1500 + i * 100, 0.03, 0.07))
    place(sfx, 35.0, pluck(note('D#4'), 0.4, 0.15, 4))
    place(sfx, 36.0, pluck(note('A5'), 0.35, 0.14, 2)); place(sfx, 36.1, pluck(note('E6'), 0.4, 0.12, 2))
    place(sfx, 36.5, blip(900, 0.03, 0.22))
    place(sfx, 36.65, pluck(note('C#6'), 0.4, 0.13, 2)); place(sfx, 36.75, pluck(note('A6'), 0.5, 0.12, 2))
    place(sfx, 36.95, whoosh(0.35, 500, 5000, 0.25, rise=0.5))
    for t in np.arange(37.5, 39.4, 0.5):
        place(sfx, t, blip(3000, 0.015, 0.05))
    for t in [38.0, 38.6]:
        place(sfx, t, blip(1900, 0.04, 0.1))
    place(sfx, 39.5, blip(500, 0.04, 0.3)); place(sfx, 39.6, pluck(note('E3'), 0.35, 0.25, bright=4))
    #  tax
    place(sfx, 40.75, whoosh(0.3, 400, 6000, 0.4, rise=0.9)); place(drums, 41.36, boom(0.35))
    for i in range(7):
        place(sfx, 41.8 + i * 0.07, blip(note(['A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7'][i]), 0.06, 0.06))
    ticks(41.9, 1.2, 16, 1700, 30, 0.06)
    place(sfx, 43.6, whoosh(0.3, 500, 4000, 0.2, rise=0.5))
    for i, t in enumerate([44.3, 44.7]):
        place(sfx, t, blip(900, 0.03, 0.2))
        place(sfx, t + 0.1, whoosh(0.55, 800, 7000, 0.2, rise=0.5))
    place(sfx, 45.45, pluck(note('E6'), 0.4, 0.13, 2)); place(sfx, 45.55, pluck(note('A6'), 0.5, 0.13, 2))
    place(sfx, 47.0, riser(1.0, 0.35))
    for i, t in enumerate(np.arange(47.0, 47.95, 0.0625)):
        place(drums, t, snare(0.08 + 0.22 * i / 15))
    place(sfx, 47.75, whoosh(0.3, 300, 9000, 0.45, rise=0.85))

    # Privacy breakdown 48 - 54: no drums, warm pad, bells on the tiles, build into the drop.
    place(drums, 48.0, boom(0.6))
    for start, chord, root in [(48.0, ['F3', 'A3', 'C4', 'E4'], 'F1'), (50.0, ['A3', 'C4', 'E4', 'G4'], 'A1'), (52.0, ['F3', 'A3', 'C4', 'E4'], 'F1')]:
        place(music, start, pad_chord([note(c) for c in chord], 2.4, 0.5, attack=0.3, release=0.6))
        place(music, start, bass(note(root), 2.0, 0.35))
    place(music, 53.0, pad_chord([note(c) for c in ['G3', 'B3', 'D4']], 1.2, 0.4, attack=0.2))
    for i in range(4):
        place(sfx, 49.4 + i * 0.4, pluck(note(['E5', 'A5', 'C6', 'E6'][i]), 0.9, 0.12, 1))
    place(sfx, 49.8, blip(1100, 0.03, 0.15))
    for t in [52.0, 53.0]:
        place(sfx, t, whoosh(0.8, 3000, 12000, 0.1, rise=0.3))
    for t in [51.0, 52.0, 52.5, 53.0, 53.5]:
        place(drums, t, kick(0.5))
    place(sfx, 53.0, riser(1.0, 0.4))
    for i, t in enumerate(np.arange(53.0, 53.95, 0.0625)):
        place(drums, t, snare(0.08 + 0.25 * i / 15))

    # Drop 54 - 56: montage.
    place(drums, 54.0, boom(0.8))
    groove(54.0, 56.0, hats16=True, gain=1.0); chords(54.0, 56.0, PROG[:1] + PROG[1:2], 0.55, 0.6)
    for t in [54.5, 55.0, 55.5]:
        place(sfx, t, pluck(note('A5'), 0.3, 0.12, 2)); place(sfx, t, pluck(note('E6'), 0.3, 0.1, 2))
    place(sfx, 55.75, whoosh(0.3, 9000, 300, 0.45, rise=0.95))

    # End card 56 - 60.
    place(drums, 56.05, boom(0.9)); place(drums, 56.05, kick(1.0))
    place(music, 56.05, pad_chord([note(c) for c in ['F3', 'A3', 'C4', 'E4']], 2.3, 0.55, attack=0.05, release=0.6))
    place(music, 58.0, pad_chord([note(c) for c in ['C4', 'E4', 'G4', 'D5']], 2.0, 0.55, attack=0.3, release=1.2))
    place(music, 56.05, bass(note('F1'), 1.95, 0.45)); place(music, 58.0, bass(note('C2'), 2.0, 0.45))
    for i, n_ in enumerate(['C5', 'E5', 'G5', 'C6']):
        place(sfx, 56.25 + i * 0.09, pluck(note(n_), 0.7, 0.12, 2))
    for i, n_ in enumerate(['G5', 'C6', 'E6']):
        place(sfx, 57.3 + i * 0.06, pluck(note(n_), 0.8, 0.13, 2))
    place(drums, 57.3, kick(0.6))
    for t in [57.9, 59.0]:
        place(sfx, t, whoosh(0.6, 3000, 14000, 0.16, rise=0.5))
    for t in [58.0, 58.5]:
        place(drums, t, kick(0.45))

# ---------------------------------------------------------------- mix
duck = 1 - 0.6 * np.minimum(1, one_pole(side, 60) * 3)
music *= duck
wet = reverb(music * 0.5 + sfx * 0.7, 1.4, 1), reverb(music * 0.5 + sfx * 0.7, 1.4, 2)
left = drums + music + sfx + wet[0] * 0.35
right = drums + music + sfx + wet[1] * 0.35
stereo = np.stack([left, right], axis=1)
fade = np.ones(N)
fade[-int(0.5 * SR):] = np.linspace(1, 0, int(0.5 * SR)) ** 2
fade[:200] = np.linspace(0, 1, 200)
stereo *= fade[:, None]
stereo = np.tanh(stereo / np.max(np.abs(stereo)) * 1.3)
stereo *= 0.89 / np.max(np.abs(stereo))

os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
path = os.path.join(os.path.dirname(__file__), 'out', 'soundtrack-60.wav' if LONG else 'soundtrack.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((stereo * 32767).astype('<i2').tobytes())
print('wrote', path)
