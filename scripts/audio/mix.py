"""Sound for one episode format, driven ONLY by timeline.json (no second hand-written schedule).

  python scripts/audio/mix.py <timeline.json> <voice.wav | -> <out_dir> [--force]

Writes stems (voice.wav, music.wav, sfx.wav), mix.wav (stereo, 48 kHz, exactly the video length) and mix_report.json.
Targets: about -15 LUFS integrated, true peak <= -1 dBTP, measured on the written file with ffmpeg.
Music is a simple synthesized bed (plucked waltz figure + soft pad); it is NOT period music and is never presented as such.
A music file with clear rights can replace it (timeline music.file). SFX are synthesized and only fire on events
declared in the storyboard. A fingerprint of the inputs is stored so an unchanged run is skipped (use --force).
"""
import hashlib, json, os, subprocess, sys, wave
sys.stdout.reconfigure(encoding="utf-8", errors="replace"); sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # Windows pipes default to cp1252
import numpy as np
from scipy import signal

SR = 48000

def db(x): return 10 ** (x / 20)
def read_wav(path):
    with wave.open(path, "rb") as w:
        assert w.getsampwidth() == 2, "voice must be 16-bit PCM"
        a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
        if w.getnchannels() > 1: a = a.reshape(-1, w.getnchannels()).mean(axis=1)
        if w.getframerate() != SR: a = signal.resample_poly(a, SR, w.getframerate()).astype(np.float32)
        return a
def write_wav(path, x):
    x = np.clip(x, -1, 1)
    if x.ndim == 1: x = np.stack([x, x], axis=1)
    with wave.open(path, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((x * 32767).astype("<i2").tobytes())
def rng(seed): return np.random.default_rng(seed)
def env(n, a=0.005, r=0.2):
    e = np.ones(n, np.float32); na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na); e[-nr:] *= np.linspace(1, 0, nr) ** 2; return e
def bp(x, lo, hi): return signal.sosfilt(signal.butter(2, [lo, hi], "bandpass", fs=SR, output="sos"), x).astype(np.float32)
def lp(x, f): return signal.sosfilt(signal.butter(2, f, "lowpass", fs=SR, output="sos"), x).astype(np.float32)
def hp(x, f): return signal.sosfilt(signal.butter(2, f, "highpass", fs=SR, output="sos"), x).astype(np.float32)

# ---------------------------------------------------------------- sound effects (mono, peak ~1)
def sfx_crunch(r, dur=0.55):          # flaky crust: a burst of tiny bright crackles
    n = int(dur * SR); x = np.zeros(n, np.float32)
    for _ in range(46):
        p = int(r.random() ** 1.6 * (n - 900)); m = int(r.uniform(60, 700)); x[p:p + m] += r.standard_normal(m).astype(np.float32) * np.exp(-np.arange(m) / (m / 4)) * r.uniform(0.3, 1)
    return hp(x, 1800) * env(n, 0.001, 0.15)
def sfx_thump(r, dur=0.3):            # dough folded onto the bench / a dull knock
    t = np.arange(int(dur * SR)) / SR
    return (np.sin(2 * np.pi * (95 * np.exp(-t * 9) + 45) * t) * np.exp(-t * 16) + 0.25 * lp(r.standard_normal(len(t)).astype(np.float32), 500) * np.exp(-t * 40)).astype(np.float32)
def sfx_roll(r, dur=1.1):             # rolling pin: low rumble swelling and fading
    n = int(dur * SR); t = np.arange(n) / SR
    return bp(r.standard_normal(n).astype(np.float32), 90, 420) * (np.sin(np.pi * t / dur) ** 1.5).astype(np.float32) * 2.2
def sfx_knife(r, dur=0.22):
    n = int(dur * SR); t = np.arange(n) / SR
    return (hp(r.standard_normal(n).astype(np.float32), 3500) * np.exp(-t * 28) * 0.8 + np.sin(2 * np.pi * 180 * t) * np.exp(-t * 45) * 0.7).astype(np.float32)
def sfx_bell(r, dur=1.4):             # shop door bell: inharmonic partials
    t = np.arange(int(dur * SR)) / SR; x = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in [(1850, 1, 4), (2760, 0.6, 5), (4130, 0.35, 7), (5540, 0.2, 9)])
    return (x / 2).astype(np.float32)
def sfx_page(r, dur=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    return bp(r.standard_normal(n).astype(np.float32), 1200, 7000) * (np.sin(np.pi * t / dur) ** 3).astype(np.float32) * 1.3
def sfx_whoosh(r, dur=0.4):            # whip transition: a quick filtered-noise sweep
    n = int(dur * SR); t = np.arange(n) / SR; x = r.standard_normal(n).astype(np.float32)
    a, b = bp(x, 300, 1500), bp(x, 1500, 6000); k = t / dur
    return ((a * (1 - k) + b * k) * np.sin(np.pi * k) ** 2).astype(np.float32) * 1.4
def sfx_steam(r, dur=1.6):
    n = int(dur * SR); t = np.arange(n) / SR
    return hp(r.standard_normal(n).astype(np.float32), 4000) * (np.minimum(1, t / 0.15) * np.exp(-t * 2.2)).astype(np.float32) * 0.9
def loop_fire(r, dur):                # oven fire: soft roar + random crackles
    n = int(dur * SR); x = lp(r.standard_normal(n).astype(np.float32), 420) * 1.6
    for _ in range(int(dur * 9)):
        p = int(r.random() * (n - 400)); m = int(r.uniform(40, 300)); x[p:p + m] += hp(r.standard_normal(m).astype(np.float32), 1500) * np.exp(-np.arange(m) / (m / 3)) * r.uniform(0.4, 1.2)
    return x * env(n, 0.4, 0.8) * 0.5
def loop_street(r, dur):              # town street: filtered murmur with slow swells and a few distant steps
    n = int(dur * SR); t = np.arange(n) / SR
    x = bp(r.standard_normal(n).astype(np.float32), 250, 1800) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.23 * t + r.random() * 6)).astype(np.float32)
    for _ in range(int(dur * 2.2)):
        p = int(r.random() * (n - 3000)); m = 2400; tt = np.arange(m) / SR; x[p:p + m] += (np.sin(2 * np.pi * r.uniform(110, 170) * tt) * np.exp(-tt * 60)).astype(np.float32) * 2.0
    return x * env(n, 0.6, 1.0) * 0.5
def loop_night(r, dur):               # night: low wind + sparse crickets
    n = int(dur * SR); t = np.arange(n) / SR
    x = lp(r.standard_normal(n).astype(np.float32), 300) * (1.2 + 0.6 * np.sin(2 * np.pi * 0.11 * t)).astype(np.float32)
    x += (np.sin(2 * np.pi * 4300 * t) * (np.sin(2 * np.pi * 38 * t) > 0.6) * (np.sin(2 * np.pi * 0.7 * t) > 0.2) * 0.12).astype(np.float32)
    return x * env(n, 0.8, 1.2) * 0.5
def loop_conveyor(r, dur):            # factory: mains hum + belt rattle
    n = int(dur * SR); t = np.arange(n) / SR
    x = (0.5 * np.sin(2 * np.pi * 60 * t) + 0.25 * np.sin(2 * np.pi * 120 * t) + 0.12 * np.sin(2 * np.pi * 180 * t)).astype(np.float32)
    x += bp(r.standard_normal(n).astype(np.float32), 700, 2600) * (0.25 + 0.2 * (np.sin(2 * np.pi * 7 * t) > 0)).astype(np.float32)
    return x * env(n, 0.5, 0.8) * 0.5
ONE = {"crunch": sfx_crunch, "thump": sfx_thump, "roll": sfx_roll, "knife": sfx_knife, "bell": sfx_bell, "page": sfx_page, "steam": sfx_steam, "whoosh": sfx_whoosh}
LOOP = {"fire": loop_fire, "street": loop_street, "night": loop_night, "conveyor": loop_conveyor}
GAIN = {"crunch": 0, "thump": -2, "roll": -6, "knife": -4, "bell": -9, "page": -7, "steam": -8, "whoosh": -9, "fire": -9, "street": -11, "night": -10, "conveyor": -12}

# ---------------------------------------------------------------- music bed
def pluck(freq, dur, r):
    n = int(dur * SR); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (3.2 + 1.3 * k)) / k ** 1.4 for k in range(1, 6))
    return (x * np.minimum(1, t / 0.004)).astype(np.float32)
def pad(freqs, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t + i) + 0.4 * np.sin(2 * np.pi * f * 2.003 * t) for i, f in enumerate(freqs))
    return (x / len(freqs) * np.sin(np.pi * np.minimum(1, t / dur)) ** 0.5).astype(np.float32)
NOTE = lambda m: 440 * 2 ** ((m - 69) / 12)
# gentle waltz progressions (MIDI roots + chord tones); the section changes with the chapter so a long film is not one loop
PROGS = [[(48, [60, 64, 67]), (45, [57, 60, 64]), (41, [57, 60, 65]), (43, [59, 62, 67])],
         [(45, [57, 60, 64]), (41, [57, 60, 65]), (48, [60, 64, 67]), (43, [59, 62, 65])],
         [(41, [57, 60, 65]), (43, [59, 62, 67]), (40, [55, 59, 64]), (45, [57, 60, 64])]]
def music(total, chapters, seed=11, bpm=92):
    n = int(total * SR); L = np.zeros(n + SR * 4, np.float32); R = np.zeros_like(L); r = rng(seed); beat = 60 / bpm; bar = 3 * beat
    starts = [c["startSec"] for c in chapters] or [0]
    t, k = 0.0, 0
    while t < total:
        sec = max(0, sum(1 for s in starts if s <= t) - 1); root, chord = PROGS[sec % len(PROGS)][k % 4]
        i = int(t * SR)
        def put(x, pan, g):
            m = min(len(x), len(L) - i); L[i:i + m] += x[:m] * g * (1 - pan); R[i:i + m] += x[:m] * g * pan
        put(pluck(NOTE(root), bar * 1.2, r), 0.45, 0.5)
        for b in (1, 2):
            j = int((t + b * beat) * SR); x = sum(pluck(NOTE(c), beat * 1.6, r) for c in chord) * 0.22
            m = min(len(x), len(L) - j); L[j:j + m] += x[:m] * 0.6; R[j:j + m] += x[:m] * 0.4
        if k % 2 == 0:  # a sparse melody note on some bars
            mel = pluck(NOTE(chord[int(r.integers(0, 3))] + 12), beat * 2.5, r) * 0.3; j = int((t + r.choice([0, 1, 1.5]) * beat) * SR); m = min(len(mel), len(L) - j); L[j:j + m] += mel[:m] * 0.35; R[j:j + m] += mel[:m] * 0.65
        p = pad([NOTE(c - 12) for c in chord], bar) * 0.1; m = min(len(p), len(L) - i); L[i:i + m] += p[:m]; R[i:i + m] += p[:m]
        t += bar; k += 1
    out = np.stack([L[:n], R[:n]], axis=1)
    fade = int(2.5 * SR); out[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 1.5; out[:int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))[:, None]
    return out / (np.abs(out).max() + 1e-9)

# ---------------------------------------------------------------- loudness
def measure(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    txt = r.stderr; I = float(txt.rsplit("I:", 1)[1].split("LUFS")[0]); tp = float(txt.rsplit("Peak:", 1)[1].split("dBFS")[0])
    return I, tp

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; force = "--force" in sys.argv
    if len(args) != 3: sys.exit(__doc__)
    tl_path, voice_path, out = args; tl = json.load(open(tl_path, encoding="utf8")); os.makedirs(out, exist_ok=True)
    total = tl["totalFrames"] / tl["fps"]; n = int(round(total * SR)); has_voice = voice_path != "-"
    fp = hashlib.sha256(json.dumps([tl["fingerprint"], tl["events"], tl["music"], tl["sfxGainDb"], tl["totalFrames"], os.path.getsize(voice_path) if has_voice else 0, 3], sort_keys=True).encode()).hexdigest()[:16]
    rep_path = os.path.join(out, "mix_report.json")
    if not force and os.path.exists(rep_path) and json.load(open(rep_path)).get("fingerprint") == fp and os.path.exists(os.path.join(out, "mix.wav")):
        print(f"mix: đầu vào không đổi (fingerprint {fp}), dùng lại {out}/mix.wav"); return
    voice = np.zeros(n, np.float32)
    if has_voice:
        v = read_wav(voice_path); m = min(n, len(v)); voice[:m] = v[:m]
        if len(v) > n + SR // 10: sys.exit(f"LỖI: giọng đọc ({len(v) / SR:.2f}s) dài hơn video ({total:.2f}s). Dựng lại timeline.")
        voice = hp(voice, 70); voice /= (np.abs(voice).max() + 1e-9); voice *= db(-3)
    # sfx
    sfx = np.zeros((n, 2), np.float32); used = []
    for i, e in enumerate(tl["events"]):
        if e["type"] != "sfx": continue
        name = e["name"]; r = rng(1000 + i)
        if name in ONE: x = ONE[name](r)
        elif name in LOOP: x = LOOP[name](r, e["durSec"] or 4.0)
        else: sys.exit(f"LỖI: SFX \"{name}\" chưa được định nghĩa (có: {', '.join(list(ONE) + list(LOOP))}). Sửa storyboard hoặc thêm vào mix.py.")
        x = x / (np.abs(x).max() + 1e-9) * db(GAIN[name] + e.get("gainDb", 0) + tl["sfxGainDb"] + 5)
        a = int(e["sec"] * SR); m = min(len(x), n - a)
        if m <= 0: continue
        pan = 0.5 + 0.18 * np.sin(i * 2.4)
        sfx[a:a + m, 0] += x[:m] * (1 - pan) * 2; sfx[a:a + m, 1] += x[:m] * pan * 2; used.append({"name": name, "sec": e["sec"], "frame": e["frame"]})
    # music (file or synth), ducked under the voice
    mcfg = tl["music"]
    if mcfg.get("file"):
        tmp = os.path.join(out, "_music_src.wav"); subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "-1", "-i", mcfg["file"], "-t", f"{total:.3f}", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_s16le", tmp], check=True)
        with wave.open(tmp, "rb") as w: mus = (np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768).reshape(-1, 2)[:n]
        mus = np.pad(mus, ((0, n - len(mus)), (0, 0))); mus /= (np.abs(mus).max() + 1e-9); music_src = f"file: {mcfg['file']}"
    else: mus = music(total, tl["chapters"]); music_src = "synthesized bed (not period music)"
    mus = np.pad(mus, ((0, max(0, n - len(mus))), (0, 0)))[:n]     # exactly the video length, whatever the rounding
    e = np.abs(voice); win = int(0.05 * SR); e = np.convolve(e, np.ones(win) / win, mode="same")
    att, rel = np.exp(-1 / (0.06 * SR)), np.exp(-1 / (0.45 * SR)); g = np.empty(n, np.float32); s = 0.0
    th = db(-38)
    dec = 240; ed = e[::dec]; gd = np.empty(len(ed), np.float32)        # envelope follower at 200 Hz, then interpolated
    a2, r2 = att ** dec, rel ** dec
    for i, x in enumerate(ed):
        tgt = 1.0 if x > th else 0.0; s = a2 * s + (1 - a2) * tgt if tgt > s else r2 * s + (1 - r2) * tgt; gd[i] = s
    g = np.interp(np.arange(n), np.arange(len(ed)) * dec, gd).astype(np.float32)
    duck = db(mcfg["duckDb"]) ** g
    mus = mus * (db(mcfg["gainDb"] + 12) * duck)[:, None]
    mix = np.stack([voice, voice], axis=1) + mus + sfx
    write_wav(os.path.join(out, "voice.wav"), voice); write_wav(os.path.join(out, "music.wav"), mus); write_wav(os.path.join(out, "sfx.wav"), sfx)
    raw = os.path.join(out, "_mix_raw.wav"); mix /= max(1.0, np.abs(mix).max() / 0.98); write_wav(raw, mix)
    # normalise to -15 LUFS with a true-peak ceiling: static gain first, limiter only if the peak would exceed -1 dBTP
    # A soft limiter first tames isolated SFX peaks, then a static gain lands on -15 LUFS; the gain is lowered if the
    # measured true peak would pass -1 dBTP (keeps the voice natural: no dynamic loudness riding).
    final = os.path.join(out, "mix.wav"); lim = os.path.join(out, "_mix_lim.wav")
    for limit in (0.7, 0.5, 0.36, 0.26, 0.18):   # the gentlest limiter that still lets the static gain reach -15 LUFS under the ceiling
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", f"alimiter=limit={limit}:attack=2:release=80:level=disabled", "-ar", str(SR), "-c:a", "pcm_s16le", lim], check=True)
        I, tp = measure(lim)
        if -15.0 - I <= -1.3 - tp: break
    gain = min(-15.0 - I, -1.3 - tp)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", lim, "-af", f"volume={gain:.2f}dB", "-ar", str(SR), "-ac", "2", "-c:a", "pcm_s16le", final], check=True)
    I2, tp2 = measure(final); os.remove(raw); os.remove(lim)
    with wave.open(final, "rb") as w: dur = w.getnframes() / SR
    rep = {"fingerprint": fp, "durationSec": round(dur, 3), "videoSec": round(total, 3), "sampleRate": SR, "channels": 2, "integratedLUFS": I2, "truePeakDb": tp2, "targetLUFS": -15, "ceilingDbTP": -1,
           "hasVoice": has_voice, "music": music_src, "musicGainDb": mcfg["gainDb"], "duckDb": mcfg["duckDb"], "sfxCount": len(used), "sfx": used, "stems": ["voice.wav", "music.wav", "sfx.wav"]}
    json.dump(rep, open(rep_path, "w"), indent=1)
    ok = abs(I2 + 15) <= 1.0 and tp2 <= -1.0 and abs(dur - total) < 0.05
    print(f"mix.wav: {dur:.2f}s (video {total:.2f}s), {I2:.1f} LUFS, true peak {tp2:.1f} dBTP, {len(used)} SFX, nhạc: {music_src}" + ("" if has_voice else "  [KHÔNG CÓ GIỌNG ĐỌC: bản nháp]"))
    if not ok: print("CẢNH BÁO: chưa đạt mục tiêu -15 LUFS (+-1), true peak <= -1 dBTP, hoặc độ dài lệch video."); sys.exit(2)

main()
