"""Render the Living Skies Atlas explainer from the real app, one exact frame at a time.

The scenes, narration and camera moves live in video/storyboard.py. The app runs in a framed window on
video/stage/stage.html, and a virtual clock is stepped one frame at a time, so every run gives the same film
however slow the machine. Numbers said in the narration come from the app's data, so re-run after `npm run data`.

Setup (once):
  uv venv .venv --python 3.12
  uv pip install --python .venv/Scripts/python.exe playwright imageio-ffmpeg kokoro-onnx soundfile numpy
  put kokoro-v1.0.onnx and voices-v1.0.bin (github.com/thewh1teagle/kokoro-onnx releases) in .venv/kokoro
  Microsoft Edge must be installed (it renders the WebGL map on the GPU).

  .venv/Scripts/python.exe video/render.py --storyboard     storyboard.html, script.md, captions, YouTube text. A few minutes.
  .venv/Scripts/python.exe video/render.py --preview        quick 960x540 video with sound, to check timing.
  .venv/Scripts/python.exe video/render.py --preview --only finder   one scene, no sound.
  .venv/Scripts/python.exe video/render.py --stills 5,40,90  test frames as JPEGs.
  .venv/Scripts/python.exe video/render.py                  2560x1440 master + 1080p copy + everything above.

  A supplemental film goes in video/storyboard_<film>.py, listed in FILMS, and renders with --film <film>.

Options: --url puts an address on the end card and in youtube.txt. --no-build skips `npm run build`.
Narration is made once per line with Kokoro and cached in video/out/vo; a line is remade only when its text changes.
To use a real voice, save video/out/vo/recorded/<id>.wav (ids are in script.md); the picture retimes to fit.
"""
import argparse
import base64
import datetime
import hashlib
import html
import importlib
import http.server
import json
import pathlib
import re
import subprocess
import sys
import threading
import time

import imageio_ffmpeg
import numpy
import soundfile
from playwright.sync_api import sync_playwright

VIDEO = pathlib.Path(__file__).resolve().parent
ROOT = VIDEO.parent
sys.path.insert(0, str(VIDEO))
import sfx  # noqa: E402
import storyboard  # noqa: E402

OUT = VIDEO / "out"
STAGE = VIDEO / "stage"
DIST = ROOT / "dist"
NAME = "living-skies-atlas-explainer"
# The storyboard page, script and YouTube text get this prefix; the main film keeps plain names.
PREFIX = ""
# --film picks a storyboard module: video/storyboard.py, or video/storyboard_<film>.py
FILMS = {"main": "storyboard"}
# The live site (GitHub Pages), linked from the YouTube descriptions unless --url gives another address.
SITE = "https://dtomyn.github.io/Saskatchewan-InData/"
LAYOUT = (1920, 1080)
SCALE_MASTER, SCALE_PREVIEW, SCALE_BOARD = 4 / 3, 0.5, 2 / 3  # 2560x1440, 960x540, 1280x720
VOICE_DIR = OUT / "vo"
VOICE_MODEL = ROOT / ".venv" / "kokoro"
VOICE, VOICE_SPEED = "af_heart", 0.98
CAPTION_MAX = 84
TILE_WAIT = 4  # seconds of real time a frame waits for map tiles before drawing without them


# ---------------------------------------------------------------------------------------------------
# serving the built app and the stage from one origin, so the stage can reach into the app's frame

def build():
    print("building the app", flush=True)
    subprocess.run("npm run build", cwd=ROOT, shell=True, check=True, stdout=subprocess.DEVNULL)


class Handler(http.server.SimpleHTTPRequestHandler):
    # MapLibre 6 starts its worker from an .mjs module, which browsers only run when it's served as JavaScript;
    # Python's guess for .mjs on Windows is text/plain.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript", ".js": "text/javascript"}

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/stage/"):
            return str(STAGE / clean[len("/stage/"):])
        return str(DIST / clean.lstrip("/")) if clean != "/" else str(DIST / "index.html")

    def log_message(self, *args):
        pass


def serve():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ---------------------------------------------------------------------------------------------------
# narration

def make_voice(lines):
    """Makes each new or changed line with Kokoro; returns {id: length ms} and sets line['path']."""
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    (VOICE_DIR / "recorded").mkdir(exist_ok=True)
    book = VOICE_DIR / "made.json"
    made = json.loads(book.read_text(encoding="utf-8")) if book.exists() else {}
    engine = None
    lengths = {}
    for line in lines:
        path = VOICE_DIR / "recorded" / f"{line['id']}.wav"
        if not path.exists():
            path = VOICE_DIR / f"{line['id']}.wav"
            key = hashlib.sha1(f"{VOICE}|{VOICE_SPEED}|{storyboard.SOUNDS}|{line['said']}".encode()).hexdigest()
            if made.get(line["id"]) != key or not path.exists():
                if engine is None:
                    from kokoro_onnx import Kokoro
                    engine = Kokoro(str(VOICE_MODEL / "kokoro-v1.0.onnx"), str(VOICE_MODEL / "voices-v1.0.bin"))
                sounds = engine.tokenizer.phonemize(line["said"], lang="en-us")
                for wrong, right in storyboard.SOUNDS.items():
                    sounds = sounds.replace(wrong, right)
                audio, rate = engine.create(sounds, voice=VOICE, speed=VOICE_SPEED, is_phonemes=True)
                soundfile.write(str(path), audio, rate)
                made[line["id"]] = key
                book.write_text(json.dumps(made, indent=1), encoding="utf-8")
                print("voice", line["id"], flush=True)
        line["path"] = str(path)
        lengths[line["id"]] = round(soundfile.info(str(path)).duration * 1000)
    return lengths


# ---------------------------------------------------------------------------------------------------
# the film: a virtual clock, the stage, and what was said and heard when

class Film:
    """What storyboard.py scenes call. Times are milliseconds of film."""

    def __init__(self, page, fps, lines, lengths, mode, only=None, stills=None, writer=None):
        self.page, self.fps, self.mode, self.only, self.writer = page, fps, mode, only, writer
        self.lines = {line["id"]: line for line in lines}
        self.lengths = lengths
        self.stills = sorted(stills or [])
        self.stage = page.main_frame
        self.app = next(f for f in page.frames if f.parent_frame)
        self.frame = 0
        self.clock = 0
        self.voiced, self.sounds, self.boards, self.chapters = [], [], [], []
        self.voice_end = 0
        self.scene = None
        self.marks = {}
        self.mouse = (None, None)
        self.written = 0
        self.slow = 0
        self.errors = []
        self.started = time.time()

    @property
    def now(self):
        return self.frame * 1000 / self.fps

    # ---- frames -----------------------------------------------------------------------------------
    def capturing(self):
        return self.mode == "video" and (not self.only or self.scene["id"] in self.only)

    def step(self):
        # Tiles asked for last frame must arrive before this frame draws; real time passes, film time doesn't.
        # run_for(0) lets timers that are already due run (map workers hand tiles back through them).
        waited = time.time()
        while not self.stage.evaluate("Stage.tilesLoaded()") and time.time() - waited < TILE_WAIT:
            self.page.clock.run_for(0)
            time.sleep(0.02)
        waited = time.time() - waited
        if waited >= TILE_WAIT:
            self.slow += 1
        self.frame += 1
        target = round(self.now)
        try:
            self.page.clock.run_for(target - self.clock)
        except Exception as error:  # an app error inside a timer; note it and keep filming
            self.errors.append(f"{self.scene['id']} at {self.now / 1000:.1f}s: {str(error).splitlines()[0]}")
            print("page error", self.errors[-1], flush=True)
        self.clock = target
        x, y = self.stage.evaluate("(() => { window.__filmSync(); document.getElementById('app').contentWindow.__filmSync?.(); const m = Stage.mouse(); return [m.x, m.y]; })()")
        if (round(x, 1), round(y, 1)) != self.mouse:
            self.mouse = (round(x, 1), round(y, 1))
            self.page.mouse.move(x, y)
        if self.capturing():
            self.writer.stdin.write(self.page.screenshot(type="jpeg", quality=93))
            self.written += 1
            if self.written % 300 == 0:
                print(f"  frame {self.written} ({self.written / self.fps:.0f}s), {time.time() - self.started:.0f}s elapsed, scene {self.scene['id']}", flush=True)
        while self.stills and self.now / 1000 >= self.stills[0]:
            path = OUT / f"still-{self.stills[0]:06.1f}.jpg"
            path.write_bytes(self.page.screenshot(type="jpeg", quality=90))
            print("still", path.name, self.scene["id"], flush=True)
            self.stills.pop(0)

    def wait(self, ms):
        end = self.now + ms
        while self.now < end - 1e-6:
            self.step()

    def wait_until(self, js, most=30000):
        """Steps frames until a JS expression in the app is true (or `most` ms pass)."""
        end = self.now + most
        while not self.app.evaluate(js) and self.now < end:
            self.step()

    # ---- narration and sound ----------------------------------------------------------------------
    def say(self, line_id, wait=False):
        line = self.lines[line_id]
        ms = self.lengths[line_id]
        self.voiced.append({"id": line_id, "at": self.now, "end": self.now + ms, "text": line["text"], "path": line["path"], "scene": self.scene["id"]})
        self.voice_end = max(self.voice_end, self.now + ms)
        if wait:
            self.wait(ms)
        return ms

    def voice_done(self, pad=350):
        """Waits until the narration so far has finished, plus a breath."""
        self.wait(max(0, self.voice_end + pad - self.now))

    def sfx(self, name, gain=1.0, **opts):
        self.sounds.append({"name": name, "at": self.now, "gain": gain, "opts": opts})

    def mark(self, name):
        self.marks[name] = self.now / 1000

    # ---- stage and app ----------------------------------------------------------------------------
    def js(self, expr, arg=None):
        return self.stage.evaluate(expr, arg)

    def run(self, expr, arg=None):
        """Evaluates in the app's frame, where window.atlas is."""
        return self.app.evaluate(expr, arg)

    def camera(self, target, ms=1200, wait=False, whoosh=False, **opts):
        if whoosh:
            self.sfx("whoosh", 0.5 if whoosh is True else whoosh)
        self.js("([t, ms, o]) => Stage.camera(t, ms, o)", [target, ms, opts])
        if wait:
            self.wait(ms)

    def cursor(self, on=True):
        self.js("on => Stage.cursorShow(on)", on)

    def move(self, target, ms=None, wait=True):
        p = self.js("t => Stage.point(t)", target)
        used = self.js("([x, y, ms]) => Stage.cursorTo(x, y, ms)", [p["x"], p["y"], ms])
        if wait:
            self.wait(used)
        return used

    def click(self, target=None, real=True, after=250):
        """Moves to target (if given), then a click you can see and hear. real=False only shows it."""
        if target:
            self.move(target)
            self.wait(120)
        self.sfx("click", 0.9)
        self.js("Stage.press()")
        if real:
            self.page.mouse.down()
        self.wait(70)
        if real:
            self.page.mouse.up()
        self.wait(after)

    def drag(self, start, end, ms=900, button="left"):
        self.move(start)
        self.wait(100)
        self.sfx("click", 0.6)
        self.js("Stage.press()")
        self.page.mouse.down(button=button)
        self.wait(60)
        self.move(end, ms)
        self.wait(80)
        self.page.mouse.up(button=button)
        self.wait(200)

    def key(self, name, after=300):
        """A key press in the app, heard as a click."""
        self.sfx("click", 0.7)
        self.app.locator("body").press(name)
        self.wait(after)

    def scroll(self, dy, ms=1200):
        frames = max(1, round(ms * self.fps / 1000))
        for i in range(frames):
            # ease in and out so the panel glides
            a, b = i / frames, (i + 1) / frames
            ease = lambda t: t * t * (3 - 2 * t)
            self.page.mouse.wheel(0, dy * (ease(b) - ease(a)))
            self.step()

    def board(self, title, why):
        """A storyboard frame: a real screenshot of this moment."""
        if self.mode != "board":
            return
        shot = self.page.screenshot(type="jpeg", quality=80)
        self.boards.append({"scene": self.scene["id"], "at": self.now, "title": title, "why": why, "image": base64.b64encode(shot).decode()})

    # ---- scenes -----------------------------------------------------------------------------------
    def play(self, scenes, start=None):
        if start:  # for checking later scenes quickly; earlier scenes are skipped, so the film is not the real one
            scenes = scenes[[s["id"] for s in scenes].index(start):]
            self.js("() => { Stage.fade(0, 1); Stage.camera('fill', 1); }")
        for scene in scenes:
            self.scene = scene
            self.chapters.append({**{k: scene[k] for k in ("id", "title", "shows", "camera", "motion", "sound")}, "at": self.now})
            print(f"scene {scene['id']} at {self.now / 1000:.1f}s, {time.time() - self.started:.0f}s elapsed, {self.slow} frames gave up waiting for map tiles", flush=True)
            scene["run"](self)
        self.mark("total")


# ---------------------------------------------------------------------------------------------------
# opening the stage

def open_stage(playwright, port, scale):
    # A kept profile so map tiles come from disk on later runs instead of the network.
    context = playwright.chromium.launch_persistent_context(
        str(OUT / "browser-profile"), channel="msedge", headless=True,
        args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
        viewport={"width": LAYOUT[0], "height": LAYOUT[1]}, device_scale_factor=scale)
    try:
        return load_stage(context, port)
    except BaseException:
        # a stage that fails to open must still let go of the browser profile, or every later film can't launch
        context.close()
        raise


def load_stage(context, port):
    errors = []
    context.add_init_script(path=str(STAGE / "vt.js"))
    # Town Finder weights and the workplace are saved in the browser; every film starts from the defaults.
    context.add_init_script("try { ['weights', 'work'].forEach((k) => localStorage.removeItem('living-skies-atlas:' + k)); } catch {}")
    page = context.pages[0] if context.pages else context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    # Noon today: the app shows the current year, and a re-run on the same day is identical.
    start = datetime.datetime.combine(datetime.date.today(), datetime.time(12))
    # The installed clock starts running, so it begins a few seconds before noon: pausing at noon must never be in its past.
    page.clock.install(time=start - datetime.timedelta(seconds=5))
    page.clock.pause_at(start)
    page.goto(f"http://127.0.0.1:{port}/stage/stage.html?app=%2F%3Ffilm")
    page.evaluate("document.fonts.ready")
    # Let the app load: real time for the downloads, a little film time for its frame loop.
    deadline = time.time() + 90
    while not page.evaluate("Stage.ready()"):
        if time.time() > deadline:
            raise SystemExit(f"the app did not load: {errors}")
        page.clock.run_for(16)
        time.sleep(0.05)
    return context, page, errors


def facts(page):
    app = next(f for f in page.frames if f.parent_frame)
    found = app.evaluate("""() => {
      const a = window.atlas, d = a.data;
      return {
        layers: a.layers.filter((l) => l.available && l.id !== 'province').length,
        towns: d.munis.length,
        extract: Object.values(d.manifest).map((m) => m.updated || '').sort().at(-1).slice(0, 10),
      };
    }""")
    # a storyboard can read more numbers from the app for its narration
    if getattr(storyboard, "FACTS", None):
        found.update(app.evaluate(storyboard.FACTS))
    return found


def script_lines(found):
    lines = []
    for scene in storyboard.SCENES:
        for line_id, text in scene["lines"].items():
            text = text.format(**found)
            lines.append({"id": line_id, "scene": scene["id"], "text": text, "said": storyboard.spoken(text)})
    return lines


# ---------------------------------------------------------------------------------------------------
# sound

def read_mono(path, rate):
    audio, r = soundfile.read(path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if r != rate:
        audio = numpy.interp(numpy.arange(int(len(audio) * rate / r)) * r / rate, numpy.arange(len(audio)), audio).astype("float32")
    return audio


def place(track, clip, at_s, gain=1.0):
    s = int(at_s * sfx.RATE)
    if s >= len(track):
        return
    e = min(len(track), s + len(clip))
    track[s:e] += clip[:e - s] * gain


def write_audio(film, path):
    """Narration, sound effects and the music bed; the music ducks under the voice."""
    rate = sfx.RATE
    total = film.marks["total"] + 0.5
    n = int(total * rate)
    voice = numpy.zeros(n, dtype="float32")
    for said in film.voiced:
        clip = read_mono(said["path"], rate)
        clip /= max(1e-6, numpy.abs(clip).max())
        place(voice, clip * 0.9, said["at"] / 1000)

    effects = numpy.zeros((n, 2), dtype="float32")
    cache = {}
    for i, s in enumerate(film.sounds):
        key = (s["name"], json.dumps(s["opts"], sort_keys=True))
        if s["name"] == "blip":
            clip = sfx.blip(s["opts"].get("note", i))
        else:
            if key not in cache:
                cache[key] = sfx.SOUNDS[s["name"]](**s["opts"])
            clip = cache[key]
        place(effects, clip, s["at"] / 1000, s["gain"])

    print("composing music", flush=True)
    bed = sfx.music(total, film.marks)[:n]
    # duck: follow the voice's loudness in 10 ms blocks, with a fast attack and a slow release
    block = rate // 100
    env = numpy.abs(voice[: len(voice) // block * block]).reshape(-1, block).max(axis=1)
    duck = numpy.zeros_like(env)
    level = 0.0
    for i, v in enumerate(env):
        target = 1.0 if v > 0.04 else 0.0
        level += (target - level) * (0.35 if target > level else 0.025)
        duck[i] = level
    gain = 1 - 0.62 * numpy.repeat(duck, block)
    gain = numpy.concatenate([gain, numpy.full(n - len(gain), gain[-1] if len(gain) else 1)])
    mix = bed * (0.55 * gain)[:, None] + effects * 0.8 + voice[:, None]
    mix /= max(1.0, numpy.abs(mix).max() / 0.95)
    soundfile.write(str(path), mix, rate)


def mux(ffmpeg, video, wav, final):
    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(video), "-i", str(wav),
                    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000", "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", str(final)], check=True)


# ---------------------------------------------------------------------------------------------------
# text outputs: captions, script, YouTube description, storyboard page

def stamp(ms, sep="."):
    total = int(ms)
    return f"{total // 3600000:02}:{total // 60000 % 60:02}:{total // 1000 % 60:02}{sep}{total % 1000:03}"


def clock_label(ms):
    seconds = int(ms // 1000)
    return f"{seconds // 60}:{seconds % 60:02}"


def caption_parts(text):
    parts = []
    for sentence in re.split(r"(?<=[.?!:])\s+", text):
        current = ""
        for piece in re.split(r"(?<=,)\s+", sentence):
            if current and len(current) + len(piece) + 1 > CAPTION_MAX:
                parts.append(current)
                current = piece
            else:
                current = f"{current} {piece}".strip()
        parts.append(current)
    return parts


def write_captions(film):
    lines, count = [], 0
    for said in film.voiced:
        parts = caption_parts(said["text"])
        total = sum(map(len, parts))
        at = said["at"]
        for part in parts:
            end = at + (said["end"] - said["at"]) * len(part) / total
            count += 1
            lines += [str(count), f"{stamp(at, ',')} --> {stamp(end, ',')}", part, ""]
            at = end
    path = OUT / f"{NAME}.srt"
    path.write_text("\n".join(lines), encoding="utf-8")
    print("wrote", path, flush=True)


def write_script(film, found):
    total = film.marks["total"] * 1000
    parts = [f"# {getattr(storyboard, 'SCRIPT_TITLE', 'Living Skies Atlas explainer: narration script')}\n\n{clock_label(total)} in all. Written by `video/render.py` from `video/storyboard.py`, "
             f"with numbers from the data extract of {found['extract']}. To replace a line with a real recording, save it as `video/out/vo/recorded/<id>.wav`.\n"]
    for c in film.chapters:
        parts.append(f"\n## {clock_label(c['at'])} {c['title']}\n\n**Shows:** {c['shows']}\n\n**Camera:** {c['camera']}\n\n**Motion:** {c['motion']}\n\n**Sound:** {c['sound']}\n")
        parts.extend(f"\n`{clock_label(s['at'])}` `{s['id']}` {s['text']}\n" for s in film.voiced if s["scene"] == c["id"])
    path = OUT / f"{PREFIX}script.md"
    path.write_text("".join(parts), encoding="utf-8")
    print("wrote", path, flush=True)


def youtube_chapters(film, shortest=10000):
    """Chapters as YouTube takes them: every one at least 10 s, or it drops them all.
    A short chapter joins the next one, keeping its start time and adding its name, except the title card
    (scene "intro"), which just hands 0:00 to the first step."""
    total = film.marks["total"] * 1000
    out, start, names = [], None, []
    for i, c in enumerate(film.chapters):
        end = film.chapters[i + 1]["at"] if i + 1 < len(film.chapters) else total
        at = c["at"] if start is None else start
        if c["id"] != "intro":
            names.append(c["title"])
        if end - at < shortest and i + 1 < len(film.chapters):
            start = at
            continue
        out.append((at, " · ".join(names)))
        start, names = None, []
    if out and end - out[-1][0] < shortest and len(out) > 1:  # a short last chapter joins the one before
        out.pop()
    return out


def write_youtube(film, found, url):
    url = url or SITE
    chapters = "\n".join(f"{clock_label(at)} {title}" for at, title in youtube_chapters(film))
    text = storyboard.youtube(found, url, chapters) if getattr(storyboard, "youtube", None) else ""
    path = OUT / f"{PREFIX}youtube.txt"
    path.write_text(text, encoding="utf-8")
    print("wrote", path, flush=True)


STORYBOARD_CSS = """
:root { --bg: #f4f5f8; --panel: #fff; --ink: #141a26; --muted: #5a6577; --line: #dde1e8; --accent: #c2560f; --chip: #eef0f5; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #070b14; --panel: #101726; --ink: #e8ecf4; --muted: #94a1b8; --line: #232c3e; --accent: #ff9a52; --chip: #182134; } }
:root[data-theme="dark"] { --bg: #070b14; --panel: #101726; --ink: #e8ecf4; --muted: #94a1b8; --line: #232c3e; --accent: #ff9a52; --chip: #182134; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 15px/1.55 "Segoe UI", system-ui, sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 40px 16px 80px; }
h1 { font-size: 34px; line-height: 1.15; margin: 0 0 8px; letter-spacing: -.3px; }
.lede { color: var(--muted); margin: 0 0 18px; max-width: 75ch; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 8px; }
.meta span { background: var(--chip); border-radius: 999px; padding: 4px 12px; font-size: 13px; }
.strip { display: flex; height: 10px; border-radius: 5px; overflow: hidden; margin: 22px 0 6px; }
.strip i { display: block; height: 100%; }
.strip-k { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12.5px; color: var(--muted); }
.strip-k b { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }
section { margin-top: 44px; border-top: 1px solid var(--line); padding-top: 20px; }
h2 { font-size: 22px; margin: 0 0 4px; }
h2 time { color: var(--accent); font-variant-numeric: tabular-nums; margin-right: 12px; }
dl { display: grid; grid-template-columns: 80px 1fr; gap: 4px 14px; margin: 12px 0 16px; }
dt { color: var(--muted); font-size: 13px; padding-top: 1px; }
dd { margin: 0; }
.said { margin: 0 0 18px; padding: 10px 0 10px 16px; border-left: 3px solid var(--accent); }
.said p { margin: 0 0 8px; }
.said time { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; margin-right: 8px; }
.boards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
figure { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
figure img { display: block; width: 100%; height: auto; }
figcaption { padding: 10px 12px 12px; font-size: 14px; }
figcaption b { display: block; font-weight: 600; }
figcaption time { color: var(--accent); font-variant-numeric: tabular-nums; }
code { font-size: 13px; }
@media (max-width: 600px) { dl { grid-template-columns: 1fr; } h1 { font-size: 27px; } .boards { grid-template-columns: 1fr; } }
"""
STRIP_COLOURS = ["#ff8a3d", "#ffd166", "#f9d65c", "#e86cff", "#6c8cff", "#3ecf8e", "#a99bff", "#c08552", "#4cc9f0", "#ff4d6d"]


def write_storyboard(film, found):
    total = film.marks["total"] * 1000
    strip, keys, parts = [], [], []
    for i, c in enumerate(film.chapters):
        end = film.chapters[i + 1]["at"] if i + 1 < len(film.chapters) else total
        colour = STRIP_COLOURS[i % len(STRIP_COLOURS)]
        strip.append(f'<i style="width:{(end - c["at"]) / total * 100:.2f}%;background:{colour}" title="{html.escape(c["title"])}"></i>')
        keys.append(f'<span><b style="background:{colour}"></b>{clock_label(c["at"])} {html.escape(c["title"])}</span>')
        figures = "".join(
            f"<figure><img loading=\"lazy\" alt=\"{html.escape(b['title'])}\" src=\"data:image/jpeg;base64,{b['image']}\"><figcaption>"
            f"<time>{clock_label(b['at'])}</time> <b>{html.escape(b['title'])}</b>{html.escape(b['why'])}</figcaption></figure>"
            for b in film.boards if b["scene"] == c["id"])
        said = "".join(f"<p><time>{clock_label(s['at'])}</time>{html.escape(s['text'])}</p>" for s in film.voiced if s["scene"] == c["id"])
        parts.append(
            f"<section><h2><time>{clock_label(c['at'])}</time>{html.escape(c['title'])}</h2><dl>"
            f"<dt>Shows</dt><dd>{html.escape(c['shows'])}</dd><dt>Camera</dt><dd>{html.escape(c['camera'])}</dd>"
            f"<dt>Motion</dt><dd>{html.escape(c['motion'])}</dd><dt>Sound</dt><dd>{html.escape(c['sound'])}</dd></dl>"
            f"<div class=\"said\">{said}</div><div class=\"boards\">{figures}</div></section>")
    page = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>Living Skies Storyboard</title><style>{STORYBOARD_CSS}</style></head><body><main>"
        f"<h1>{html.escape(getattr(storyboard, 'BOARD_TITLE', 'Living Skies Atlas: explainer storyboard'))}</h1>"
        f"<p class=\"lede\">A {clock_label(total)} narrated explainer for YouTube. Every frame below is a real frame of the render, captured by "
        "<code>video/render.py --storyboard</code>. Scenes, narration, camera and sound come from <code>video/storyboard.py</code>, and the numbers from the app's data "
        f"(extract of {html.escape(found['extract'])}), so this page and the film are rebuilt together.</p>"
        f"<div class=\"meta\"><span>{len(film.chapters)} scenes</span><span>{len(film.voiced)} narration lines · Kokoro {VOICE}</span>"
        f"<span>{sum(1 for s in film.sounds if s['name'] == 'click')} clicks</span><span>2560×1440 master · 1080p copy · 30 fps</span></div>"
        f"<div class=\"strip\">{''.join(strip)}</div><div class=\"strip-k\">{''.join(keys)}</div>"
        + "".join(parts) + "</main></body></html>")
    path = OUT / f"{PREFIX}storyboard.html"
    path.write_text(page, encoding="utf-8")
    print("wrote", path, round(path.stat().st_size / 1e6, 1), "MB", flush=True)


# ---------------------------------------------------------------------------------------------------

def run(playwright, port, args, mode, scale, fps):
    browser, page, errors = open_stage(playwright, port, scale)
    try:
        film_pass(browser, page, errors, args, mode, fps)
    finally:
        # always let go of the browser profile, so a film that fails doesn't stop the next one launching
        try:
            browser.close()
        except Exception:
            pass


def film_pass(browser, page, errors, args, mode, fps):
    found = facts(page)
    # a film built from the app's own layer list (the overview, the per-layer films) makes its scenes now
    if getattr(storyboard, "prepare", None):
        storyboard.prepare(found)
    lines = script_lines(found)
    lengths = make_voice(lines)
    page.evaluate("u => Stage.url(u)", (args.url or "living-skies-atlas").replace("https://", ""))
    writer = None
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    silent = OUT / f"{NAME}{'-preview' if args.preview else ''}{'-' + args.only if args.only else ''}-silent.mp4"
    if mode == "video":
        writer = subprocess.Popen(
            [ffmpeg, "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-r", str(fps), "-i", "-",
             # Screenshot JPEGs are full-range BT.601; convert to standard video range so every player shows the same colours.
             "-vf", "scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv,format=yuv420p",
             "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
             "-c:v", "libx264", "-preset", "veryfast" if args.preview else "slow", "-crf", "24" if args.preview else "17",
             "-movflags", "+faststart", str(silent)], stdin=subprocess.PIPE)
    film = Film(page, fps, lines, lengths, mode, only=set(args.only.split(",")) if args.only else None,
                stills=[float(s) for s in args.stills.split(",")] if args.stills else None, writer=writer)
    film.url = args.url
    film.facts = found
    film.play(storyboard.SCENES, args.start)
    errors += film.errors
    browser.close()
    print(f"film {clock_label(film.marks['total'] * 1000)}, page errors: {errors or 'none'}", flush=True)
    if mode == "board":
        write_storyboard(film, found)
    # Narration times are the same in both passes (the clock is virtual), so a master rendered with --video-only
    # still gets its captions, script and YouTube text; only the storyboard page needs the board pass.
    if mode == "board" or (mode == "video" and not args.preview and not args.only):
        write_captions(film)
        write_script(film, found)
        write_youtube(film, found, args.url)
    if writer:
        writer.stdin.close()
        writer.wait()
        if args.only:
            print("wrote", silent, "(no sound)", flush=True)
            return
        wav = OUT / f"{NAME}.wav"
        write_audio(film, wav)
        final = OUT / f"{NAME}{'-preview' if args.preview else ''}.mp4"
        mux(ffmpeg, silent, wav, final)
        silent.unlink()
        print("wrote", final, round(final.stat().st_size / 1e6, 1), "MB", flush=True)
        if not args.preview:
            share = OUT / f"{NAME}-1080p.mp4"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(final), "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264",
                            "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(share)], check=True)
            print("wrote", share, round(share.stat().st_size / 1e6, 1), "MB", flush=True)
    if errors:
        raise SystemExit("the page reported errors")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--url", help="address for the end card and the YouTube description")
    parser.add_argument("--storyboard", action="store_true", help="only the storyboard page, script, captions and YouTube text")
    parser.add_argument("--preview", action="store_true", help="quick 960x540 render")
    parser.add_argument("--only", help="render only these scene ids (comma-separated), no sound")
    parser.add_argument("--start", help="skip the scenes before this one (quick checks only; times and state differ from the real film)")
    parser.add_argument("--stills", help="comma-separated seconds to save as JPEGs")
    parser.add_argument("--no-build", action="store_true", help="use the existing dist/")
    parser.add_argument("--video-only", action="store_true", help="skip the storyboard pass (when storyboard.html is already up to date)")
    parser.add_argument("--check", action="store_true", help="fill in every narration line and label from the app's data, without filming (quick)")
    parser.add_argument("--film", default="main",
                        help=f"which film: {', '.join(sorted(FILMS))} (main is the how-to); several comma-separated")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not args.no_build:
        build()
    server = serve()
    port = server.server_address[1]
    with sync_playwright() as playwright:
        # several films can be given comma-separated
        films = []
        for name in args.film.split(","):
            films.append(name)
        if len(films) > 1:
            print("films:", ", ".join(films), flush=True)
        failed = []
        for name in films:
            try:
                film_one(playwright, port, args, name)
            except (Exception, SystemExit) as error:
                if len(films) == 1:
                    raise
                # with several films, one that breaks doesn't stop the rest
                failed.append(name)
                print(f"FILM {name} FAILED: {error}", flush=True)
        if failed:
            raise SystemExit(f"these films failed: {', '.join(failed)}")


def film_one(playwright, port, args, name):
    pick_film(name)
    print(f"=== film {name} ({NAME})", flush=True)
    if args.check:
        browser, page, _ = open_stage(playwright, port, SCALE_PREVIEW)
        try:
            found = facts(page)
            if getattr(storyboard, "prepare", None):
                storyboard.prepare(found)
            lines = script_lines(found)
            print(f"  ok: {len(storyboard.SCENES)} scenes, {len(lines)} lines", flush=True)
        finally:
            browser.close()
        return
    if args.stills:
        run(playwright, port, args, "stills", 1.0, args.fps)
        return
    if args.storyboard or not (args.preview or args.only or args.video_only):
        run(playwright, port, args, "board", SCALE_BOARD, args.fps)
    if args.storyboard:
        return
    run(playwright, port, args, "video", SCALE_PREVIEW if args.preview else SCALE_MASTER, 24 if args.preview else args.fps)


def pick_film(name):
    """Points the module-level storyboard, NAME and PREFIX at a film."""
    global storyboard, NAME, PREFIX
    if name == "main":
        storyboard, NAME, PREFIX = importlib.import_module("storyboard"), "living-skies-atlas-explainer", ""
        return
    if name in FILMS:
        storyboard = importlib.import_module(FILMS[name])
    else:
        raise SystemExit(f"unknown film '{name}': use {', '.join(sorted(FILMS))}")
    NAME = storyboard.NAME
    PREFIX = f"{NAME}-"



if __name__ == "__main__":
    main()
