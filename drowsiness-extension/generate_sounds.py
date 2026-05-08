#!/usr/bin/env python3
"""Generate WAV sound files for the drowsiness extension."""

import math
import os
import struct
import wave

SAMPLE_RATE = 44100


def make_samples(fn, duration):
    n = int(SAMPLE_RATE * duration)
    return [max(-1.0, min(1.0, fn(i / SAMPLE_RATE, duration))) for i in range(n)]


def write_wav(path, samples):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(struct.pack('<' + 'h' * len(samples),
                                  *[int(s * 32767) for s in samples]))
    print(f'  ✓  {path}')


def env(t, dur, attack=0.01, release=0.12):
    if t < attack:
        return t / attack
    if t > dur - release:
        return max(0.0, (dur - t) / release)
    return 1.0


# ── beep.wav — soft short beep (880 Hz, 0.35 s) ──────────────────────────────
def beep(t, dur):
    return 0.32 * env(t, dur, attack=0.02, release=0.15) \
           * math.sin(2 * math.pi * 880 * t)


# ── alarm.wav — loud jarring alarm (alternating tones + harmonics, 1.2 s) ────
def alarm(t, dur):
    freq = 960 if int(t * 6) % 2 == 0 else 1280
    a = env(t, dur, attack=0.005, release=0.08)
    return 0.72 * a * (
        0.55 * math.sin(2 * math.pi * freq * t) +
        0.30 * math.sin(2 * math.pi * freq * 2 * t) +
        0.15 * math.sin(2 * math.pi * freq * 3 * t)
    )


# ── chime.wav — gentle bell chime (C6 = 1047 Hz, inharmonic partials, 0.9 s) ─
def chime(t, dur):
    decay = math.exp(-4.0 * t / dur)
    return 0.42 * decay * (
        0.70 * math.sin(2 * math.pi * 1047 * t) +
        0.20 * math.sin(2 * math.pi * 1047 * 2.756 * t) +
        0.10 * math.sin(2 * math.pi * 1047 * 5.404 * t)
    )


BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'sounds')

write_wav(os.path.join(BASE, 'beep.wav'),  make_samples(beep,  0.35))
write_wav(os.path.join(BASE, 'alarm.wav'), make_samples(alarm, 1.20))
write_wav(os.path.join(BASE, 'chime.wav'), make_samples(chime, 0.90))
print('All sounds generated.')
