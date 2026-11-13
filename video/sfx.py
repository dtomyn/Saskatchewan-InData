"""Sound for the explainer, synthesized with numpy so a render needs no audio files and is the same every time.

Every function returns stereo float32 at RATE: shape (samples, 2).
"""
import numpy

RATE = 48000
rng = numpy.random.default_rng(7)


def _t(seconds):
    return numpy.arange(int(seconds * RATE)) / RATE


def _stereo(mono, pan=0.0):
    left, right = numpy.cos((pan + 1) * numpy.pi / 4), numpy.sin((pan + 1) * numpy.pi / 4)
    return numpy.stack([mono * left * 1.414, mono * right * 1.414], axis=1).astype("float32")


def _onepole(x, cutoff):
    """Low-pass; cutoff may be a scalar or a per-sample array in Hz."""
    cutoff = numpy.broadcast_to(numpy.asarray(cutoff, dtype="float64"), x.shape)
    a = numpy.exp(-2 * numpy.pi * cutoff / RATE)
    y = numpy.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def click():
    """A soft, close-miked mouse click: a bright tick on press, a quieter one on release."""
    out = numpy.zeros(int(0.16 * RATE))
    for at, gain in ((0.0, 1.0), (0.075, 0.45)):
        t = _t(0.04)
        tick = rng.standard_normal(len(t)) * numpy.exp(-t * 900)
        tick -= _onepole(tick, 2500)  # keep only the crisp top
        body = numpy.sin(2 * numpy.pi * (1500 - 600 * t / 0.04) * t) * numpy.exp(-t * 160) * 0.35
        thump = numpy.sin(2 * numpy.pi * 190 * t) * numpy.exp(-t * 90) * 0.3
        s = int(at * RATE)
        out[s:s + len(t)] += (tick * 0.9 + body + thump) * gain
    return _stereo(out / numpy.abs(out).max() * 0.5)


def whoosh(seconds=0.9, pan_from=-0.5, pan_to=0.5, bright=1.0):
    """Air moving past: noise through a filter that sweeps up then down, panning across."""
    t = _t(seconds)
    shape = numpy.sin(numpy.pi * t / seconds) ** 2
    noise = rng.standard_normal(len(t))
    swept = _onepole(noise, 300 + 3200 * bright * shape)
    swept -= _onepole(swept, 120)
    mono = swept * shape
    mono /= numpy.abs(mono).max()
    pan = numpy.linspace(pan_from, pan_to, len(t))
    left, right = numpy.cos((pan + 1) * numpy.pi / 4), numpy.sin((pan + 1) * numpy.pi / 4)
    return (numpy.stack([mono * left, mono * right], axis=1) * 0.55).astype("float32")


def riser(seconds=2.4):
    """Tension into the title reveal: rising filtered noise with a climbing tone."""
    t = _t(seconds)
    env = (t / seconds) ** 2.2
    noise = _onepole(rng.standard_normal(len(t)), 200 + 5000 * (t / seconds) ** 2)
    freq = 110 * 2 ** (2 * t / seconds)
    tone = numpy.sin(2 * numpy.pi * numpy.cumsum(freq) / RATE) * 0.35
    mono = (noise / numpy.abs(noise).max() * 0.6 + tone) * env
    return _stereo(mono * 0.5)


def impact(seconds=3.5):
    """A deep boom with a long dark tail, for the reveal."""
    t = _t(seconds)
    freq = 38 + 50 * numpy.exp(-t * 9)
    boom = numpy.sin(2 * numpy.pi * numpy.cumsum(freq) / RATE) * numpy.exp(-t * 1.6)
    hit = _onepole(rng.standard_normal(len(t)), 1800) * numpy.exp(-t * 14) * 3
    tail = _onepole(rng.standard_normal(len(t)), 500) * numpy.exp(-t * 1.3) * 0.5
    mono = boom + hit + tail
    return _stereo(mono / numpy.abs(mono).max() * 0.85)


def blip(note=0):
    """A small glassy tone for a stat or a chip appearing; `note` steps up a pentatonic scale."""
    steps = [0, 2, 4, 7, 9, 12, 14, 16]
    f = 880 * 2 ** (steps[note % len(steps)] / 12)
    t = _t(0.5)
    mono = (numpy.sin(2 * numpy.pi * f * t) + 0.3 * numpy.sin(2 * numpy.pi * 2 * f * t)) * numpy.exp(-t * 9)
    return _stereo(mono * 0.22, pan=-0.3 + 0.2 * (note % 4))


SOUNDS = {"click": click, "whoosh": whoosh, "riser": riser, "impact": impact}


def _reverb(x, seconds=3.2, wet=0.35):
    """Convolution with a decaying-noise impulse: a big soft room."""
    n = int(seconds * RATE)
    t = numpy.arange(n) / RATE
    out = numpy.empty_like(x)
    for ch in range(x.shape[1]):
        ir = rng.standard_normal(n) * numpy.exp(-t * 6.5 / seconds)
        ir = _fast_lowpass(ir, 0.12)
        ir /= numpy.sqrt((ir ** 2).sum())
        size = 1 << int(numpy.ceil(numpy.log2(len(x) + n)))
        wetsig = numpy.fft.irfft(numpy.fft.rfft(x[:, ch], size) * numpy.fft.rfft(ir, size), size)[:len(x)]
        out[:, ch] = x[:, ch] * (1 - wet) + wetsig * wet * 3
    return out


def _fast_lowpass(x, k):
    """Cheap smoothing for long signals (moving average), k as a fraction of the sample rate scale."""
    width = max(1, int(1 / k))
    kernel = numpy.ones(width) / width
    return numpy.convolve(x, kernel, mode="same")


def _voice(freq, t, detune=0.0):
    """A warm pad voice: a few soft harmonics, slightly detuned pairs."""
    out = numpy.zeros_like(t)
    for h, g in ((1, 1.0), (2, 0.35), (3, 0.16), (4, 0.07)):
        for d in (-detune, detune):
            out += g * numpy.sin(2 * numpy.pi * freq * h * (1 + d) * t + h * 1.7)
    return out


def music(seconds, marks):
    """An ambient bed in D major for the whole film.

    marks: {"pulse": seconds when the arpeggio comes in, "end": seconds when it resolves}.
    """
    n = int(seconds * RATE)
    t = numpy.arange(n) / RATE
    bed = numpy.zeros((n, 2))
    bar = 4.0  # seconds per chord
    # D major: Dmaj9, Bm7, Gmaj7, A(sus4); as MIDI notes
    chords = [[50, 57, 61, 64, 66], [47, 54, 57, 62, 64], [43, 50, 54, 59, 62], [45, 52, 57, 62, 64]]
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    pulse, end = marks.get("pulse", 8.0), marks.get("end", seconds - 6)

    # pad: each chord swells in and crossfades into the next
    count = int(numpy.ceil(seconds / bar)) + 1
    for i in range(count):
        start = i * bar - 1.0
        chord = chords[i % 4] if start < end - 1 else chords[0]
        seg = int((bar + 2.5) * RATE)
        s0 = max(0, int(start * RATE))
        st = numpy.arange(seg) / RATE
        env = numpy.minimum(1, st / 1.6) * numpy.minimum(1, numpy.maximum(0, (bar + 2.5 - st) / 2.0))
        mono = sum(_voice(hz(m), st, 0.0025) for m in chord) * env * 0.05
        mono += numpy.sin(2 * numpy.pi * hz(chord[0] - 12) * st) * env * 0.12  # sub
        e = min(n, s0 + seg)
        if e > s0:
            bed[s0:e, 0] += mono[:e - s0] * 0.95
            bed[s0:e, 1] += mono[:e - s0]

    # arpeggio: soft plucks in eighth notes from `pulse` until `end`
    step = bar / 8
    k = 0
    at = pulse
    pattern = [0, 2, 3, 4, 1, 3, 4, 2]
    while at < end:
        chord = chords[int(at // bar) % 4]
        m = chord[pattern[k % 8]] + 12
        nt = numpy.arange(int(1.2 * RATE)) / RATE
        f = hz(m)
        pl = (numpy.sin(2 * numpy.pi * f * nt) + 0.25 * numpy.sin(2 * numpy.pi * 2 * f * nt) * numpy.exp(-nt * 6)) * numpy.exp(-nt * 4.2)
        ramp = min(1.0, (at - pulse) / 6 + 0.25)
        gain = 0.06 * ramp * (1.0 if k % 2 == 0 else 0.75)
        s0 = int(at * RATE)
        e = min(n, s0 + len(pl))
        pan = 0.35 * numpy.sin(k * 0.9)
        bed[s0:e, 0] += pl[:e - s0] * gain * numpy.cos((pan + 1) * numpy.pi / 4) * 1.414
        bed[s0:e, 1] += pl[:e - s0] * gain * numpy.sin((pan + 1) * numpy.pi / 4) * 1.414
        at += step
        k += 1

    # fade in from silence, fade out after the end
    env = numpy.minimum(1, t / 3.0) * numpy.clip((seconds - t) / 4.0, 0, 1)
    bed *= env[:, None]
    bed = _reverb(bed, 3.6, 0.4)
    return (bed / max(1e-6, numpy.abs(bed).max()) * 0.5).astype("float32")
