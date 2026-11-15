"""The Living Skies Atlas how-to video: a step-by-step walkthrough of where to click, in order.

The story: first the controls (the map, layers, the timeline), then the atlas in every tense — the record on the
timeline, what is happening right now, what the models project, and what would happen if a hospital closed — then the
land itself, every corner of the province down to a city's neighbourhoods, and finally choosing a place to live.
The narration says what to do and where, and what each layer is for; it doesn't comment on the data the app shows.

video/render.py plays these scenes against the real app. Each scene has:
  title, shows, camera, motion, sound   what the storyboard page and script.md say about it
  lines                                 narration, by id; {name} is filled from the app's data (see facts() in render.py and FACTS here)
  run(f)                                the scene itself, using the Film calls in render.py

Targets for f.move / f.click / f.camera: {"sel": css, "text": substring, "nth": i, "at": [fx, fy], "grow": px}
for an element in the app, {"lnglat": [lon, lat]} for a place on the map, or {"cx", "cy", "z"} for a camera view.
The camera also takes "fill" (the app fills the frame) and "rest" (the window floats on the background).

The layers are named here as the Layer menu names them; if a layer is renamed, change it here too
(`--check` only fills in the narration; a missing name shows up as "no element" when filming).

This film loads the live readings (LIVE), so run `npm run data now` before filming: the film's clock (CLOCK) stands
a quarter of an hour after the newest of them was fetched, so every age it shows reads the same on every run of the
same files. With no live files it stops, rather than filming empty Right now boxes.
"""
import datetime
import json
import pathlib
import re

# Words the voice reads wrongly from their spelling, as replacements in its phonemes (none needed yet).
SOUNDS = {}

LIVE = True
NOW_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "data" / "now"


def CLOCK():
    """The film's moment: 15 minutes after the newest live reading was fetched."""
    times = []
    for path in NOW_DIR.glob("*.json"):
        if path.name == "manifest.json":
            continue
        fetched = json.loads(path.read_text(encoding="utf-8")).get("fetched")
        if fetched:
            times.append(datetime.datetime.fromisoformat(fetched.replace("Z", "+00:00")))
    if not times:
        raise SystemExit("no live readings in public/data/now: run `npm run data now` before filming")
    return max(times).replace(microsecond=0) + datetime.timedelta(minutes=15)


# More numbers for the narration, read from the app (render.py adds them to its own facts).
FACTS = """() => {
  const d = atlas.data;
  const h = d.hospitals.facilities.findIndex((f) => f.name === 'Meadow Lake Hospital');
  const hit = d.munis.filter((m) => d.hospitals.towns[m.key]?.[0]?.f === h);
  const ml = d.hospitals.towns['meadow lake'];
  return { small: d.small.length, csds: d.subdivisions.csds.length, mlIndex: h, mlHit: hit.length,
           mlAdd: Math.round(ml[1].min - ml[0].min), all: d.munis.length + d.small.length };
}"""

def spoken(text):
    """What the voice reads: the caption text with symbols written out."""
    text = text.replace("3D", "three-D").replace("→", "to").replace("+1", "plus one").replace("&", "and")
    text = text.replace("1:500", "one-in-five-hundred")
    return re.sub(r"\s+", " ", text)


TOUR = "#4cc9f0"
MAP = "#8fdcff"
JUSTICE = "#ff4d8d"
SPARK = "#ff8a3d"
STORM = "#f9d65c"
NOW = "#5ad1ff"
AHEAD = "#e86cff"
WHATIF = "#ff5a6e"
LAND = "#c6e05a"
CORNERS = "#6c8cff"
SETTLE = "#3ecf8e"
TOWN = "#7ee0a1"
FINDER = "#a99bff"
SOURCES = "#d8a06a"
KEYS = "#ffb35c"

SASKATOON = [-106.6700, 52.1300]
MEADOW_LAKE = [-108.4300, 54.1300]
MOOSE_JAW = [-105.5520, 50.3934]
CRAIK_RM = [-105.834, 50.819]      # the rural municipality of Craik No. 222: no town near its middle
CRAIK = [-105.8182, 51.0492]       # the town of Craik, one of the small communities
STEPS = 13


def step(f, n, title, colour):
    f.js("([n, t, s, c]) => Stage.chapter(n, t, s, c)", [n, title, f"Step {n} of {STEPS}", colour])
    f.sfx("whoosh", 0.35, seconds=0.6, pan_from=-0.8, pan_to=-0.2)


def hint(f, icon, head, body="", colour=KEYS, side="left"):
    """An on-screen instruction: what to click or press."""
    f.js("([i, h, b, c, s]) => Stage.chip(i, h, b, c, s)", [icon, head, body, colour, side])
    f.sfx("blip", 0.6, note=3)


def spot(f, target):
    f.js("t => Stage.spot(t)", target)


def unspot(f):
    f.js("Stage.spot(null)")


def range_at(f, sel, frac, nth=0):
    """The point at a fraction along a range input, in app pixels."""
    return f.run("""([sel, frac, nth]) => {
      const i = document.querySelectorAll(sel)[nth];
      const r = i.getBoundingClientRect(), thumb = 16;
      return { x: r.left + thumb / 2 + (r.width - thumb) * frac, y: r.top + r.height / 2 };
    }""", [sel, frac, nth])


def scrub_frac(f, t=None):
    """Where a time (or the current time) sits along the timeline slider, 0-1."""
    return f.run("""t => { const s = document.getElementById('scrub'); return ((t ?? +s.value) - +s.min) / (+s.max - +s.min); }""", t)


def weight_at(f, criterion, value):
    """The point on a Town Finder slider for a weight (0-5), in app pixels."""
    return f.run("""([id, v]) => {
      const i = document.querySelector(`.weight input[data-id="${id}"]`);
      const r = i.getBoundingClientRect(), thumb = 16;
      return { x: r.left + thumb / 2 + (r.width - thumb) * (v - +i.min) / (+i.max - +i.min), y: r.top + r.height / 2 };
    }""", [criterion, value])


def show_row(f, name):
    """Scrolls the open Layer menu so a layer's row is in view (the menu is taller than the window)."""
    f.run("""name => {
      const row = [...document.querySelectorAll('#layer-menu .layer-row')].find((r) => r.querySelector('.nm')?.textContent === name);
      row.scrollIntoView({ block: 'center' });
    }""", name)
    f.wait(250)


def pick_layer(f, name, zoom=True):
    """Opens the Layer menu and clicks a layer's name, so it shows its story."""
    f.click({"sel": "#layers-btn"})
    f.wait(250)
    show_row(f, name)
    f.click({"sel": ".layer-row", "text": name, "at": [0.4, 0.5]})


def panel_to(f, sel, above=160, ms=1400):
    """Glides the side panel until an element in it sits `above` px below the panel's top."""
    f.move({"sel": "#panel", "at": [0.5, 0.5]}, 500)
    dy = f.run("""([sel, above]) => {
      const p = document.getElementById('panel'), e = document.querySelector(sel);
      return e ? e.getBoundingClientRect().top - p.getBoundingClientRect().top - above : 0;
    }""", [sel, above])
    f.scroll(dy, ms)


def pick_option(f, sel, value):
    """Shows a click on a <select> and chooses an option (a native list can't be filmed)."""
    f.click({"sel": sel}, real=False)
    f.run("""([sel, v]) => { const s = document.querySelector(sel); s.value = String(v); s.dispatchEvent(new Event('change', { bubbles: true })); }""", [sel, value])


def fly(f, center, zoom, pitch=40, bearing=-10, ms=1800):
    f.run("([c, z, p, b, ms]) => atlas.map.flyTo({ center: c, zoom: z, pitch: p, bearing: b, duration: ms })", [center, zoom, pitch, bearing, ms])


def home(f, ms=1800):
    f.run("ms => atlas.map.flyTo({ ...atlas.HOME, duration: ms })", ms)


# ---------------------------------------------------------------------------------------------------

def intro(f):
    f.wait(400)
    f.run("() => { atlas.map.stop(); atlas.map.jumpTo(atlas.HOME); }")
    f.js("Stage.title('How to use Living Skies Atlas', 'Saskatchewan past, present and what if', ['Living', 'Skies'])")
    f.sfx("blip", 0.6, note=0)
    f.say("intro-1")
    f.board("Title", "Black frame; the title rises word by word.")
    f.wait(2200)
    f.js("Stage.fade(0, 1600)")
    f.js("Stage.hideTitle(900)")
    f.voice_done(300)


def tour(f):
    step(f, 1, "Find your way around", TOUR)
    f.cursor(True)
    f.say("tour-1")
    for lnglat in ([-104.61, 50.45], [-106.67, 52.13], [-105.75, 53.2]):  # Regina, Saskatoon, Prince Albert
        f.move({"lnglat": lnglat}, 900)
        f.wait(500)
    f.board("Just the province", "The app opens on the plain province; the cursor touches a few town dots.")
    f.voice_done(200)
    f.say("tour-2")
    spot(f, {"sel": "#layers-btn", "pad": 8})
    f.move({"sel": "#layers-btn"}, 900)
    f.board("Layer button", "A spotlight on the Layer button, top left.")
    f.voice_done(200)
    f.say("tour-3")
    spot(f, {"sel": ".top-actions", "pad": 8})
    for sel in ("#finder-btn", "#about-btn", "#panel-btn"):
        f.move({"sel": sel}, 700)
        f.wait(500)
    f.board("Top-right buttons", "The spotlight moves to the three buttons at the top right; the cursor touches each.")
    f.voice_done(200)
    f.say("tour-4")
    spot(f, {"sel": "#panel", "pad": 4})
    f.move({"sel": "#panel", "at": [0.5, 0.4]}, 900)
    f.board("Side panel", "The spotlight on the side panel.")
    f.voice_done(200)
    f.say("tour-5")
    spot(f, {"sel": "#timeline", "pad": 6})
    f.move({"sel": "#timeline", "at": [0.5, 0.5]}, 900)
    f.board("Timeline", "The spotlight on the timeline along the bottom.")
    f.voice_done(300)
    unspot(f)


def move_map(f):
    step(f, 2, "Move the map", MAP)
    f.say("map-1")
    hint(f, "✥", "Drag", "to move the map", MAP)
    f.drag({"x": 760, "y": 520}, {"x": 980, "y": 440}, 1300)
    f.wait(300)
    f.drag({"x": 980, "y": 440}, {"x": 800, "y": 500}, 1100)
    f.board("Drag", "The cursor drags the map one way and back.")
    f.voice_done(200)
    f.say("map-2")
    hint(f, "⇕", "Scroll", "to zoom in and out", MAP)
    f.move({"lnglat": [-106.67, 52.13]}, 700)
    f.scroll(-900, 1600)
    f.wait(500)
    f.scroll(900, 1400)
    f.board("Scroll", "A scroll wheel zooms in on Saskatoon, then out again.")
    f.voice_done(200)
    f.say("map-3")
    hint(f, "⟲", "Right-drag", "to tilt and turn the view", MAP)
    f.drag({"x": 800, "y": 520}, {"x": 1000, "y": 420}, 1500, button="right")
    f.wait(500)
    f.camera({"sel": ".maplibregl-ctrl-top-right", "grow": 40}, 1200, whoosh=0.3, max=2.2)
    spot(f, {"sel": ".maplibregl-ctrl-top-right", "pad": 6})
    f.voice_done(100)
    f.say("map-4")
    f.move({"sel": ".maplibregl-ctrl-zoom-in"}, 700)
    f.wait(400)
    f.move({"sel": ".maplibregl-ctrl-zoom-out"}, 500)
    f.wait(400)
    f.click({"sel": ".maplibregl-ctrl-compass"})
    f.board("Map buttons", "Zoomed on the map buttons: zoom in, zoom out, and the compass, which is clicked.")
    f.voice_done(200)
    unspot(f)
    f.js("Stage.hideChip()")
    f.camera("fill", 1200, whoosh=0.3)
    home(f)
    f.wait(1900)


def layers(f):
    step(f, 3, "Show a data layer", JUSTICE)
    f.say("layer-1")
    hint(f, "☰", "Click Layer", "top left, or press L", JUSTICE)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1200, whoosh=0.3, max=1.6)
    f.board("Layer menu", "The menu opens and the camera zooms in on it.")
    f.voice_done(200)
    f.say("layer-2")
    groups = f.run("() => document.querySelectorAll('#layer-menu .menu-gh').length")
    for nth in range(1, groups):
        f.run("n => document.querySelectorAll('#layer-menu .menu-gh')[n].scrollIntoView({ block: 'nearest' })", nth)
        f.move({"sel": ".menu-gh", "nth": nth, "at": [0.3, 0.5]}, 500)
        f.wait(450)
    f.board("The groups", "The cursor runs down the group headings: justice and safety, history, places and living, health, settling in, around the property.")
    f.voice_done(200)
    f.say("layer-3")
    show_row(f, "Crime severity")
    f.click({"sel": ".layer-row", "text": "Crime severity", "at": [0.4, 0.5]})
    f.camera("fill", 1300, whoosh=0.3)
    f.js("Stage.hideChip()")
    f.wait(800)
    spot(f, {"sel": "#panel", "pad": 4})
    f.board("Crime severity on", "Crime severity picked; the menu closes, columns rise over the towns and the side panel describes the layer.")
    f.voice_done(300)
    unspot(f)


def timeline(f):
    step(f, 4, "Play the timeline", SPARK)
    pick_layer(f, "Wildfires")
    f.wait(400)
    # Wildfires opens at its Now stop (step 6); the how-to starts from the first year
    f.run("() => atlas.setTime(atlas.layers.find((l) => l.id === 'fires').range[0])")
    f.wait(300)
    f.camera({"sel": "#timeline", "grow": 30}, 1300, whoosh=0.3, max=1.9)
    f.say("time-1")
    hint(f, "▶", "Click play", "or press the space bar", SPARK)
    f.click({"sel": "#play"})
    f.board("Play", "Wildfires is picked; zoomed on the timeline, play is clicked and the years start to run.")
    f.voice_done(200)
    f.say("time-2")
    hint(f, "»", "Speed", "how many years pass each second", SPARK)
    f.click({"sel": "#speed-sel"}, real=False)
    f.run("() => { const s = document.getElementById('speed-sel'); s.value = '8'; s.dispatchEvent(new Event('change')); }")
    f.wait(1500)
    f.voice_done(200)
    f.say("time-3")
    hint(f, "⏸", "Pause, then drag the slider", "to jump to any year", SPARK)
    f.click({"sel": "#play"})
    f.wait(300)
    f.drag(range_at(f, "#scrub", scrub_frac(f)), range_at(f, "#scrub", 0.55), 1500)
    f.board("Scrub", "Paused; the slider is dragged forward through the decades.")
    f.voice_done(200)
    f.say("time-4")
    hint(f, "◆", "Click a marker", "to jump to that event", SPARK)
    f.click({"sel": '.ev[title*="north burns"]'})
    f.camera("fill", 1500, whoosh=0.3)
    f.wait(1600)
    f.board("Event", "The 2015 marker is clicked; the map flies north to the burn outlines and the story of the 2015 fires opens in the side panel.")
    f.voice_done(200)
    f.say("time-5")
    f.camera({"sel": "#panel", "grow": 10}, 1200, max=1.5)
    f.voice_done(400)
    f.js("Stage.hideChip()")
    f.camera("fill", 1200)
    f.wait(1200)


def switching(f):
    step(f, 5, "Switch, combine and clear layers", STORM)
    home(f)
    f.say("sw-1")
    hint(f, "◐", "Flip a layer's switch", "to put it on the map or take it off", STORM)
    f.click({"sel": "#layers-btn"})
    f.camera({"sel": "#layer-menu", "grow": 16}, 1100, whoosh=0.3, max=1.6)
    show_row(f, "Tornadoes")
    f.click({"sel": ".layer-row", "text": "Tornadoes", "at": [0.93, 0.5]})
    f.wait(700)
    f.board("Switch on", "Zoomed on the menu: the Tornadoes switch is flipped on; the wildfires stay on the map too.")
    f.voice_done(200)
    f.say("sw-2")
    f.click({"sel": ".layer-row", "text": "Tornadoes", "at": [0.4, 0.5]})
    f.camera("fill", 1100, whoosh=0.3)
    f.wait(600)
    f.board("Pick", "Tornadoes' name is clicked: the panel and the timeline switch to tornadoes, the wildfires stay on.")
    f.voice_done(200)
    f.say("sw-3")
    f.camera({"sel": "#layers-btn", "grow": 60}, 1100, max=2.2)
    spot(f, {"sel": "#picker-extra", "pad": 6})
    f.move({"sel": "#picker-extra"}, 700)
    f.board("+1", "Zoomed on the Layer button: the badge counts the extra layers.")
    f.voice_done(200)
    unspot(f)
    f.say("sw-4")
    hint(f, "◌", "Clear the map", "at the top of the Layer menu", TOUR)
    f.click({"sel": "#layers-btn"})
    f.run("() => document.getElementById('layer-menu').scrollTop = 0")
    f.camera({"sel": "#layer-menu", "grow": 16}, 1100, max=1.6)
    f.wait(400)
    f.click({"sel": ".layer-row", "text": "Clear the map", "at": [0.4, 0.5]})
    f.camera("fill", 1200, whoosh=0.3)
    f.board("Clear", "Clear the map is clicked; everything comes off the map.")
    f.voice_done(400)
    f.js("Stage.hideChip()")


def right_now(f):
    """The present tense: the Now stop, the age on every reading, the smoke forecast, and the daily record."""
    step(f, 6, "See what's happening right now", NOW)
    f.say("now-1")
    hint(f, "●", "River floods · Wildfires · Smoke & air", "run right up to Now", NOW)
    pick_layer(f, "River floods")
    f.wait(800)
    f.camera({"sel": "#timeline", "grow": 30}, 1200, whoosh=0.3, max=1.9)
    spot(f, {"sel": "#year", "pad": 8})
    f.board("The Now stop", "River floods is picked and opens at the right-hand end of its timeline: Now.")
    f.voice_done(200)
    unspot(f)
    f.camera("fill", 1200, whoosh=0.3)
    f.say("now-2")
    f.move({"sel": "#panel", "at": [0.5, 0.75]}, 900, wait=False)
    fly(f, [-105.6, 51.6], 5.6, 45, -12, 2200)
    f.wait(2300)
    f.board("Live gauges", "Each column is a gauge's latest flow against its river's normal annual peak.")
    f.voice_done(200)
    f.say("now-3")
    f.camera({"sel": "#panel .now-block", "grow": 16}, 1300, whoosh=0.3, max=1.9)
    spot(f, {"sel": "#panel .now-block", "pad": 6})
    f.wait(1300)
    f.board("Right now", "Zoomed on the Right now box: when the feed was read, and each gauge's own age.")
    f.voice_done(300)
    unspot(f)
    f.camera("fill", 1100)
    f.say("now-4")
    pick_layer(f, "Smoke & air")
    f.wait(900)
    f.camera({"sel": "#panel .now-block", "grow": 16}, 1300, whoosh=0.3, max=1.8)
    f.wait(1300)
    f.board("Air and smoke now", "Smoke & air at Now: the air quality health index by community, and the smoke forecast with its issue and valid times.")
    f.voice_done(300)
    f.camera("fill", 1100)
    f.say("now-5")
    pick_layer(f, "Wildfires")
    f.wait(600)
    f.camera({"sel": "#timeline", "grow": 30}, 1200, whoosh=0.3, max=1.9)
    # the daily record is a sliver at the slider's right end: a shown click there, then the time is set exactly
    f.click(range_at(f, "#scrub", scrub_frac(f, 2026.55)), real=False)
    f.run("() => atlas.setTime(2026.55)")
    f.wait(500)
    spot(f, {"sel": "#month", "pad": 8})
    f.board("The daily record", "Wildfires stepped back into this year: the day, marked provisional, from the atlas's own daily record.")
    f.voice_done(300)
    unspot(f)
    f.camera("fill", 1200)
    f.js("Stage.hideChip()")


def ahead(f):
    """The future tense: climate projections past the record, always a range."""
    step(f, 7, "Look ahead with the climate models", AHEAD)
    f.run("() => atlas.clearMap()")
    home(f)
    f.say("ah-1")
    pick_layer(f, "Climate")
    f.wait(500)
    f.run("() => atlas.setTime(2005)")
    f.camera({"sel": "#timeline", "grow": 30}, 1200, whoosh=0.3, max=1.9)
    hint(f, "⇢", "Drag past 2020", "into the projections", AHEAD)
    f.wait(400)
    f.drag(range_at(f, "#scrub", scrub_frac(f)), range_at(f, "#scrub", scrub_frac(f, 2086)), 2200)
    spot(f, {"sel": "#month", "pad": 8})
    f.board("Past the record", "The slider is dragged past 2020 into the hatched part of the timeline: projection, not a record.")
    f.voice_done(200)
    unspot(f)
    f.camera("fill", 1200, whoosh=0.3)
    f.say("ah-2")
    f.wait(800)
    f.board("A range on the map", "Each station's column: a solid core for low emissions, a wire frame for high.")
    f.voice_done(200)
    f.say("ah-3")
    panel_to(f, "#panel .proj-table", 120)
    f.camera({"sel": "#panel .proj-table", "grow": 20}, 1200, max=1.9)
    f.wait(1200)
    f.board("What the models project", "Zoomed on the panel's table: low to high emissions, three 30-year periods.")
    f.voice_done(300)
    f.camera("fill", 1100)
    f.js("Stage.hideChip()")


def what_if(f):
    """The hypothetical: close a hospital and see who drives farther."""
    step(f, 8, "Ask what if a hospital closed", WHATIF)
    f.run("() => atlas.clearMap()")
    f.say("wi-1")
    pick_layer(f, "Hospital access")
    f.wait(1200)
    f.board("Hospital access", "Columns show each town's drive to its nearest hospital.")
    f.voice_done(200)
    f.say("wi-2")
    hint(f, "✕", "Close a hospital…", "here, or click one on the map", WHATIF)
    panel_to(f, "#panel .sc-pick", 220, 1000)
    f.camera({"sel": "#panel .sc-pick", "grow": 60}, 1200, whoosh=0.3, max=1.9)
    f.wait(300)
    pick_option(f, "#panel .sc-pick", f.facts["mlIndex"])
    f.wait(500)
    f.camera("fill", 1300, whoosh=0.3)
    fly(f, MEADOW_LAKE, 6.4, 45, -8, 2200)
    f.wait(2300)
    f.board("Closed", "Meadow Lake Hospital is closed: the map flies there and the routes to the next hospitals turn red.")
    f.voice_done(200)
    f.say("wi-3")
    f.run("() => document.getElementById('panel').scrollTop = 0")
    f.camera({"sel": "#panel .sc-box", "grow": 14}, 1300, max=1.7)
    f.wait(1300)
    f.board("Who drives farther", "Zoomed on the scenario box: each place that drives farther, with its old and new drive.")
    f.voice_done(200)
    f.camera("fill", 1100)
    f.say("wi-4")
    spot(f, {"sel": "#scenario-banner", "pad": 6})
    f.wait(2600)
    f.board("The banner", "The red banner names the scenario while it lasts.")
    f.voice_done(100)
    hint(f, "↺", "Clear", "to end the scenario", WHATIF)
    f.click({"sel": "#scenario-banner .sb-clear"})
    unspot(f)
    f.voice_done(400)
    f.js("Stage.hideChip()")


def land(f):
    """The land itself: crops by year, the power grid, flood-prone land."""
    step(f, 9, "Read the land", LAND)
    f.run("() => atlas.clearMap()")
    home(f)
    f.say("la-1")
    pick_layer(f, "What grows here")
    f.wait(400)
    f.run("() => { atlas.setTime(2009); const s = document.getElementById('speed-sel'); s.value = '2'; s.dispatchEvent(new Event('change')); }")
    f.wait(600)
    f.click({"sel": "#play"})
    f.board("What grows here", "The crop map plays from 2009: canola yellow, cereals tan, pasture green.")
    f.wait(5200)
    f.voice_done(200)
    f.say("la-2")
    f.wait(2000)
    f.click({"sel": "#play"})
    f.voice_done(300)
    f.say("la-3")
    f.run("() => atlas.clearMap()")
    pick_layer(f, "Hidden neighbours")
    f.wait(900)
    hint(f, "⚡", "Power grid", "a switch in Hidden neighbours", LAND)
    f.camera({"sel": "#panel .chips", "grow": 40}, 1200, whoosh=0.3, max=2.0)
    f.click({"sel": '#panel [data-show="oil"]'})
    f.wait(500)
    f.camera("fill", 1200, whoosh=0.3)
    fly(f, [-104.9, 50.9], 6.3, 40, -10, 2200)
    f.wait(2300)
    f.board("The power grid", "Oil and gas switched off: the high-voltage lines, substations and power plants alone.")
    f.voice_done(300)
    f.js("Stage.hideChip()")
    f.say("la-4")
    f.run("() => atlas.clearMap()")
    pick_layer(f, "River floods")
    f.wait(500)
    fly(f, MOOSE_JAW, 11.6, 50, -15, 2800)
    f.wait(2900)
    f.board("Flood-prone land", "Zoomed into Moose Jaw: the Water Security Agency's 1:500-year flood extent, with its floodway.")
    f.voice_done(400)
    f.js("Stage.hideChip()")


def corners(f):
    """Finer places: every census subdivision, the small communities."""
    step(f, 10, "Reach every corner of the province", CORNERS)
    f.run("() => atlas.clearMap()")
    home(f)
    f.say("co-1")
    pick_layer(f, "Who lives here")
    f.wait(1500)
    f.board("Every subdivision", "Who lives here tints all of the province's census subdivisions by the immigrant share.")
    f.voice_done(200)
    f.say("co-2")
    fly(f, [-105.83, 50.93], 8.0, 35, -5, 2200)
    f.wait(2300)
    hint(f, "◫", "Click a subdivision", "for its census report", CORNERS)
    f.click({"lnglat": CRAIK_RM})
    f.move({"x": 700, "y": 520}, 800, wait=False)
    f.wait(1200)
    f.board("A rural municipality", "The rural municipality of Craik is clicked: its census report opens, saying it leaves out the towns inside it.")
    f.voice_done(300)
    f.say("co-3")
    f.run("() => atlas.clearMap()")
    f.wait(900)
    hint(f, "•", "Small dots", "the small communities", CORNERS)
    f.move({"lnglat": CRAIK}, 1200)
    f.wait(900)
    f.click()
    f.move({"x": 700, "y": 520}, 800, wait=False)
    f.wait(1400)
    f.board("A small community", "The town of Craik's dot is clicked and its own report opens.")
    f.voice_done(200)
    f.say("co-4")
    f.move({"sel": "#panel", "at": [0.5, 0.6]}, 700)
    f.scroll(1200, 3000)
    f.board("What it can tell you", "The small community's report: census, hazards, the nearest services in straight lines, and why a row is missing.")
    f.voice_done(300)
    f.run("() => document.getElementById('panel').scrollTop = 0")
    f.click({"sel": "#panel .close-x"})
    f.js("Stage.hideChip()")


def settling(f):
    """The layers for someone moving here, and the ones about the ground under a home, at a brisk pace."""
    step(f, 11, "Settle in and check around a home", SETTLE)
    f.run("() => atlas.clearMap()")
    home(f)
    f.say("se-1")
    hint(f, "☰", "Health · Settling in", "groups in the Layer menu", SETTLE)
    for name in ("Newcomer services", "Doctors & clinics", "Childcare", "Getting around"):
        pick_layer(f, name)
        f.wait(1000)
    f.board("Settling in", "Newcomer services, Doctors & clinics, Childcare and Getting around, picked in turn.")
    f.voice_done(200)
    f.say("se-2")
    hint(f, "☰", "Around the property", "a group in the Layer menu", SETTLE)
    for name in ("Hidden neighbours", "Drinking water", "Radon"):
        pick_layer(f, name)
        f.wait(1000)
    f.board("Around the property", "Hidden neighbours, Drinking water and Radon, picked in turn.")
    f.voice_done(200)
    f.say("se-3")
    pick_layer(f, "Light & dark")
    f.wait(1600)
    f.board("Light & dark", "Day length, aurora chances and dark-sky preserves, computed from latitude.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def town(f):
    step(f, 12, "Open a town's report", TOWN)
    f.run("() => { atlas.clearMap(); document.getElementById('event-ticker').hidden = true; }")
    fly(f, SASKATOON, 8.2, 40, -8, 2000)
    f.wait(2100)
    f.say("town-1")
    hint(f, "●", "Click a town dot", "point at it first to see its name", TOWN)
    f.move({"lnglat": SASKATOON}, 1100)
    f.wait(900)
    f.board("Point at a town", "The cursor rests on Saskatoon and its name pops up.")
    f.click()
    f.move({"x": 760, "y": 520}, 900, wait=False)
    f.voice_done(200)
    f.say("town-2")
    f.wait(600)
    f.camera({"sel": "#panel .tr-ct-map", "grow": 60}, 1300, whoosh=0.3, max=1.8)
    f.wait(700)
    f.click({"sel": '#panel .tr-ct-chips [data-ct="imm"]'})
    f.wait(500)
    f.board("Inside the city", "Zoomed on the census tract map at the top of Saskatoon's report; Immigrants is picked.")
    f.voice_done(200)
    f.camera("fill", 1100)
    f.say("town-3")
    panel_to(f, "#panel .outlooks", 260, 1800)
    f.camera({"sel": "#panel", "grow": 10}, 1200, max=1.5)
    f.board("Right now in town", "The Right now group: live readings near the town, its outlooks with issue and valid times, and any alerts.")
    f.voice_done(200)
    f.camera("fill", 1100)
    f.say("town-4")
    f.move({"sel": "#panel", "at": [0.5, 0.6]}, 600)
    f.scroll(2400, 4600)
    f.board("More of the report", "Further down: safety, a climate projection band, people, schools, doctors, water, home costs and the land around it.")
    f.voice_done(200)
    f.say("town-5")
    hint(f, "×", "Click the X", "to close the report", TOWN)
    f.run("() => document.getElementById('panel').scrollTop = 0")
    f.wait(300)
    f.click({"sel": "#panel .close-x"})
    f.board("Close", "The X at the top of the report is clicked.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def finder(f):
    step(f, 13, "Rank places with Town Finder", FINDER)
    home(f)
    f.say("fi-1")
    f.click({"sel": "#finder-btn"})
    f.wait(1200)
    f.board("Town Finder", "Town Finder opens in the side panel and score columns rise on the map.")
    f.voice_done(200)
    f.say("fi-2")
    hint(f, "⌖", "I work in…", "pick a town to count the drive to work", FINDER)
    f.camera({"sel": "#panel .work-row", "grow": 30}, 1200, whoosh=0.3, max=2.0)
    f.click({"sel": "#panel .work-sel"}, real=False)
    f.run("""() => {
      const s = document.querySelector('#panel .work-sel');
      s.value = [...s.options].find((o) => o.value === 'saskatoon') ? 'saskatoon' : s.options[1].value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }""")
    f.wait(1200)
    f.board("Where you work", "Zoomed on the workplace menu: Saskatoon is chosen.")
    f.voice_done(200)
    f.camera({"sel": "#panel .weights", "grow": 10}, 1300, whoosh=0.3, max=1.9)
    f.say("fi-3")
    hint(f, "⇆", "Drag a slider", "0 ignores it · 5 matters most", FINDER)
    f.wait(1000)
    now = f.run("() => +document.querySelector('.weight input[data-id=\"hospital\"]').value")
    f.drag(weight_at(f, "hospital", now), weight_at(f, "hospital", 5), 1100)
    f.board("Weights", "Zoomed on the sliders: Close to a hospital is dragged up to 5.")
    f.voice_done(200)
    f.say("fi-4")
    # the presets sit below the sliders: bring them into the panel's view first
    panel_to(f, "#panel .chips", 220, 1200)
    f.camera({"sel": "#panel .chips", "grow": 20}, 1100, max=1.9)
    f.click({"sel": '#panel [data-preset="newcomer"]'})
    f.board("Presets", "The New to Saskatchewan preset sets all the sliders at once.")
    f.voice_done(200)
    f.say("fi-5")
    hint(f, "☑", "Include small communities", "rank all the places together", FINDER)
    panel_to(f, "#panel .small-on", 260, 900)
    f.camera({"sel": "#panel .small-on", "grow": 120}, 1100, max=1.9)
    f.click({"sel": "#panel .small-on"})
    f.wait(600)
    f.board("Small communities too", "Include small communities is ticked: the small places join the ranking.")
    f.voice_done(200)
    f.say("fi-6")
    hint(f, "≡", "Click a town in the list", "to open its report", FINDER)
    f.camera("fill", 1300, whoosh=0.3)
    f.wait(500)
    # the ranking sits below the sliders: scroll the panel down to it
    panel_to(f, "#panel .rank-list", 160, 1800)
    f.move({"sel": "#panel .rank-list li", "at": [0.4, 0.5]}, 700)
    f.wait(300)
    f.click({"sel": "#panel .rank-list li", "at": [0.4, 0.5]})
    f.board("Pick from the ranking", "The top place in the ranking is clicked and its report opens.")
    f.voice_done(300)
    f.say("fi-7")
    f.click({"sel": "#panel .close-x"})
    f.wait(900)
    f.click({"sel": "#panel .close-x"})
    f.board("Back and close", "The report's X goes back to the ranking; the Finder's X closes it.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def sources(f):
    f.js("Stage.hideChapter()")
    f.say("so-1")
    hint(f, "◎", "Data & sources", "top right, or press S", SOURCES)
    f.click({"sel": "#about-btn"})
    f.wait(1500)
    f.board("Data & sources", "The sources view opens on its tree-ring round.")
    f.voice_done(200)
    f.say("so-2")
    f.move({"sel": ".src-round canvas", "at": [0.62, 0.38]}, 1000)
    f.wait(900)
    f.move({"sel": ".src-round canvas", "at": [0.66, 0.62]}, 1100)
    f.wait(900)
    f.board("Every ring has a source", "Pointing at the round: each wedge a source, each ring a year, read under the cursor.")
    f.voice_done(200)
    f.say("so-3")
    f.wait(400)
    f.voice_done(200)
    f.say("so-4")
    hint(f, "→", "See it on the map", "at the foot of each source", SOURCES)
    f.move({"sel": ".src-card:not(.bark)", "nth": 0, "at": [0.4, 0.3]}, 900)
    f.wait(1000)
    f.move({"sel": ".src-go", "nth": 0}, 700)
    f.wait(300)
    f.click()
    f.wait(1200)
    f.board("See it on the map", "Pointing at a source, then See it on the map opens that layer.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def keys(f):
    f.camera("fill", 800)
    f.say("keys-1")
    f.cursor(False)
    for key, name, colour in (("L", "Layer menu", KEYS), ("Space", "Play and pause", SPARK), ("← →", "Step a year", SPARK),
                              ("P", "Hide the side panel", TOUR), ("S", "Data & sources", SOURCES), ("Esc", "Close", KEYS)):
        hint(f, key, name, "", colour)
        if key == "L":
            f.key("l", 900)
            f.key("Escape", 300)
        elif key == "Space":
            f.key(" ", 1500)
            f.key(" ", 300)
        elif key == "← →":
            f.key("ArrowRight", 400)
            f.key("ArrowRight", 600)
        elif key == "P":
            f.key("p", 1000)
            f.key("p", 300)
        elif key == "S":
            f.key("s", 1500)
        else:
            f.key("Escape", 800)
        f.wait(200)
    f.board("Shortcuts", "Each key gets a chip as it is pressed: L, Space, arrows, P, S, Escape.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def ending(f):
    f.run("() => { atlas.clearMap(); atlas.map.flyTo({ ...atlas.HOME, duration: 3000 }); }")
    f.camera("rest", 1600, whoosh=0.5)
    f.wait(1700)
    f.js("Stage.fade(0.82, 2000)")
    f.sfx("impact", 0.5)
    f.mark("end")
    f.wait(700)
    f.js("([u, fine]) => Stage.end('Saskatchewan’s safety, justice and land, in open data', u, fine)",
         [f.url, "Open data from Saskatchewan, Statistics Canada and the Government of Canada · nothing to install"])
    f.say("end-1")
    f.board("End card", "The window drifts back; the end card shows the name and address.")
    f.voice_done(3000)
    f.js("Stage.blackout(1600)")
    f.wait(1800)


SCENES = [
    dict(id="intro", title="Introduction", run=intro,
         shows="The title.", camera="App full-frame.", motion="Title rises out of a blur; fade up from black.", sound="A glassy note; music pad fades in.",
         lines={"intro-1": "Here's how to use Living Skies Atlas: Saskatchewan's past, its present, and a few what-ifs, step by step."}),
    dict(id="tour", title="Find your way around", run=tour,
         shows="The opening screen and where each control is.", camera="Full-frame.", motion="A spotlight moves from control to control.", sound="Whooshes.",
         lines={"tour-1": "When the app opens, you see just the province, with a dot for each of its {towns} main towns and cities, and fainter dots for {small} smaller communities.",
                "tour-2": "The Layer button, at the top left, puts data on the map.",
                "tour-3": "At the top right are the Town Finder, Data and sources, and a button that hides the side panel.",
                "tour-4": "The side panel explains whatever you are looking at.",
                "tour-5": "And the timeline along the bottom runs through time: the past, right now, and the decades ahead."}),
    dict(id="map", title="Move the map", run=move_map,
         shows="Drag, scroll, right-drag and the map buttons.", camera="Full-frame; zoom onto the map buttons.", motion="Real drags and scrolls.", sound="Clicks.",
         lines={"map-1": "Drag the map to move around.",
                "map-2": "Scroll to zoom in and out.",
                "map-3": "Hold the right mouse button and drag to tilt and turn the view.",
                "map-4": "The buttons at the top right of the map zoom in and out, and the compass turns north back up."}),
    dict(id="layers", title="Show a data layer", run=layers,
         shows="Opening the Layer menu, its groups, and picking Crime severity.", camera="Zoom onto the menu, then full-frame.", motion="Cursor clicks.", sound="Clicks, whooshes.",
         lines={"layer-1": "To put data on the map, click Layer, or press L.",
                "layer-2": "There are {layers} layers, in groups: justice and safety, history, places and living, health, settling in, and around the property.",
                "layer-3": "Click one to show it. Let's pick Crime severity. The side panel now describes that layer."}),
    dict(id="timeline", title="Play the timeline", run=timeline,
         shows="Picking Wildfires; play, speed, pause, dragging the slider, and clicking an event marker.", camera="Zoomed on the timeline; full-frame for the event.", motion="Real clicks and a slider drag.", sound="Clicks.",
         lines={"time-1": "History layers, like Wildfires, play on the timeline. Click play, or press the space bar.",
                "time-2": "Use Speed to choose how many years pass each second.",
                "time-3": "Click pause to stop. Drag the slider to jump to any year.",
                "time-4": "The marks above the slider are events. Click one, and the map jumps there. The biggest burns are drawn as their mapped outlines; smaller fires as circles.",
                "time-5": "The event's story opens in the side panel, with what else was happening at the time."}),
    dict(id="switching", title="Switch, combine and clear layers", run=switching,
         shows="Keeping one on with its switch, picking it, the +1 badge, and clearing the map.", camera="Zoomed on the menu and the Layer button.", motion="Real clicks.", sound="Clicks.",
         lines={"sw-1": "Each layer has a switch. Flip Tornadoes on, and it joins the wildfires on the map.",
                "sw-2": "Click a layer's name to show its story and its timeline. The other layers stay on.",
                "sw-3": "The badge on the Layer button tells you how many more layers are on the map.",
                "sw-4": "To clear the map, open Layer and click Clear the map at the top."}),
    dict(id="now", title="See what's happening right now", run=right_now,
         shows="River floods at its Now stop, the live gauges, the Right now box with its ages, Smoke & air now, and Wildfires stepped back into this year's daily record.",
         camera="Zoomed on the timeline and the Right now boxes; full-frame for the map.", motion="Layers picked from the menu; the map glides over the gauges.", sound="Clicks, whooshes.",
         lines={"now-1": "Three layers run right up to today: River floods, Wildfires, and Smoke and air. Pick one, and its timeline opens at Now.",
                "now-2": "Each column is a river gauge reporting live: its latest flow, against that river's normal spring peak.",
                "now-3": "The site rereads these government feeds about every hour, and every reading shows its age. After three hours it turns grey, and after a day it comes off the map.",
                "now-4": "Smoke and air shows the air quality health index right now, and the wildfire smoke forecast, with when it was issued and when it runs out.",
                "now-5": "Between the last official year and today, the atlas keeps its own daily record. It is marked provisional, and it never joins the official numbers."}),
    dict(id="ahead", title="Look ahead with the climate models", run=ahead,
         shows="Climate: the slider dragged past the record into the hatched projections, the range on the map, and the projection table.",
         camera="Zoomed on the timeline, then on the panel's table.", motion="A real slider drag.", sound="Clicks.",
         lines={"ah-1": "Climate runs past the record. Drag the slider beyond 2020, and the timeline turns hatched: from here on, it shows what climate models project, not what was measured.",
                "ah-2": "A projection is always a range, never one number: a solid column for a low-emissions future, and a wire frame for a high one.",
                "ah-3": "The side panel puts numbers on it, for three thirty-year periods up to 2100."}),
    dict(id="whatif", title="Ask what if a hospital closed", run=what_if,
         shows="Hospital access; Meadow Lake Hospital closed in a scenario; the places that would drive farther; the banner; Clear.",
         camera="Zoomed on the hospital list and the scenario box; full-frame for the map.", motion="A hospital chosen, the map flies to it.", sound="Clicks, whooshes.",
         lines={"wi-1": "Hospital access shows the drive from each town to its nearest hospital.",
                "wi-2": "Now ask, what if one closed? Choose a hospital here, or click one on the map. Every place that relied on it falls back to its next nearest hospital, by road.",
                "wi-3": "Close Meadow Lake's hospital, and {mlHit} places would drive farther. Meadow Lake itself, {mlAdd} minutes more.",
                "wi-4": "The red banner is a reminder that this is your scenario, not anyone's plan. Town reports and the Town Finder keep the real values. Click Clear to end it."}),
    dict(id="land", title="Read the land", run=land,
         shows="What grows here played from 2009; Hidden neighbours with the power grid alone; River floods' flood-prone land in Moose Jaw.",
         camera="Full-frame; zoomed on the panel's switches.", motion="The timeline plays; the map flies to the grid and into Moose Jaw.", sound="Clicks, whooshes.",
         lines={"la-1": "What grows here maps the farm belt from satellite images, every year since 2009.",
                "la-2": "Play it to watch canola spread, and pulses and pasture come and go.",
                "la-3": "Hidden neighbours now includes the power grid. Switch off oil and gas, and you see just the high-voltage lines, substations and power plants.",
                "la-4": "And River floods shades the land a 1:500-year flood would cover, as the Water Security Agency mapped it, here in Moose Jaw. No shading doesn't mean no risk: most of the province has never been mapped."}),
    dict(id="corners", title="Reach every corner of the province", run=corners,
         shows="Who lives here tinting every census subdivision; a rural municipality's census report; a small community's dot and its report.",
         camera="Full-frame.", motion="The map flies to Craik; real clicks on the map.", sound="Clicks.",
         lines={"co-1": "The atlas reaches past the towns. Who lives here colours all {csds} census subdivisions: rural municipalities, villages and reserves too.",
                "co-2": "Click one for its census report. A rural municipality's numbers leave out the towns inside it, and the report says so.",
                "co-3": "With those layers off, the fainter dots are the small communities. Click one, like Craik, for its own report.",
                "co-4": "It brings together the census, hazards and the nearest services. Those are measured in straight lines, not drives, and where something is missing, the report says why."}),
    dict(id="settling", title="Settle in and check around a home", run=settling,
         shows="Health and Settling in layers; Around the property layers; Light & dark.", camera="Full-frame.", motion="Each layer picked from the menu in turn.", sound="Clicks.",
         lines={"se-1": "Moving here? The Health and Settling in groups map newcomer services, doctors and clinics, childcare, and getting around.",
                "se-2": "Around the property is about the ground under a home: wells and industry nearby, drinking water advisories, and radon.",
                "se-3": "And Light and dark works out day length, northern lights and dark skies from where you are."}),
    dict(id="town", title="Open a town's report", run=town,
         shows="Clicking Saskatoon; its census tract map; the Right now group; scrolling the report; closing it.", camera="Zoomed on the tract map; full-frame for the rest.", motion="Hover, click, scroll.", sound="Clicks.",
         lines={"town-1": "Point at a town dot to see its name, and click it to open the town's report. Here's Saskatoon.",
                "town-2": "For Saskatoon and Regina, the report opens with a map of the city's census tracts. Pick a measure, like immigrants, to see how its neighbourhoods differ.",
                "town-3": "Right now gathers the live readings near town: rivers, air and any weather alerts, plus outlooks for fire danger, storms and smoke, each with when it was issued and when it expires.",
                "town-4": "Every layer adds to the report: safety, a climate projection, people, schools, doctors, water, home costs, and the land around it.",
                "town-5": "Click the X at the top to close it."}),
    dict(id="finder", title="Rank places with Town Finder", run=finder,
         shows="Opening Town Finder, setting a workplace, a slider, the New to Saskatchewan preset, including the small communities, opening a place from the ranking, closing.", camera="Zoomed on the workplace, sliders, presets and the tick box; full-frame for the list.", motion="A real slider drag.", sound="Clicks.",
         lines={"fi-1": "Finally, choosing where to live. Click Town Finder to rank the towns by what matters to you.",
                "fi-2": "If you work in one town, pick it here, and the drive to work counts too.",
                "fi-3": "Each slider sets how much one thing counts, from zero, ignore it, to five, matters most. Drag one, and the ranking updates right away.",
                "fi-4": "Or click a preset, like New to Saskatchewan, to set them all at once.",
                "fi-5": "Tick Include small communities to rank all {all} places together. Drive times only count for the main towns.",
                "fi-6": "The columns on the map show each place's score. Click one in the list to open its report.",
                "fi-7": "Closing the report takes you back to the ranking. Click the X again to leave Town Finder."}),
    dict(id="sources", title="See where the data comes from", run=sources,
         shows="Opening Data & sources, reading the tree-ring round, and jumping to a layer from a source.", camera="Full-frame.", motion="Hover, click.", sound="Clicks.",
         lines={"so-1": "So where does all this come from? Click Data and sources.",
                "so-2": "It's drawn like a tree's cross-section. Each wedge is one source, and each ring one year, glowing as strongly as that source's record. Projections grow past the bark.",
                "so-3": "There's no server behind the atlas. Every number comes from public open data, fetched and checked by the site's own scripts, and the live feeds are refreshed every hour.",
                "so-4": "Each source says who publishes it and under what licence. Click See it on the map to open its layer."}),
    dict(id="keys", title="Keyboard shortcuts", run=keys,
         shows="The keyboard shortcuts, each pressed in turn.", camera="Full-frame.", motion="A chip for each key.", sound="Key clicks.",
         lines={"keys-1": "Last, the shortcuts. L opens the layer menu, space plays and pauses, the arrow keys step a year, P hides the side panel, S opens the sources, and Escape closes things."}),
    dict(id="end", title="End card", run=ending,
         shows="Title and address.", camera="Back to the floating window.", motion="Logo spins up.", sound="Soft impact; music fades.",
         lines={"end-1": "That's everything you need. Enjoy exploring."}),
]

SCRIPT_TITLE = "Living Skies Atlas explainer: narration script"
BOARD_TITLE = "Living Skies Atlas: explainer storyboard"


def youtube(found, url, chapters):
    return f"""TITLE
Moving to (or Living in) Saskatchewan? An Unofficial Open-Data Map, Built with Claude Code

DESCRIPTION
An unofficial, independent guide to Living Skies Atlas: a free 3D map that brings Saskatchewan's open data together in one place, for people who already live here and for those who are new or thinking of moving. It is not affiliated with or endorsed by the Government of Saskatchewan or any agency whose data it uses. I put it together with Claude Code (Anthropic's AI coding tool).

This video shows where to click, step by step: moving the map, showing and combining its {found['layers']} data layers and playing the timeline; then the atlas in every tense: live river, fire and air readings that refresh hourly, the daily record it keeps of them, climate projections to 2100, and a what-if that closes a hospital to see who would drive farther. It reads the land (crops by year, the power grid, flood-prone land), reaches all {found['csds']} census subdivisions and {found['small']} small communities, opens Saskatoon's report with its census tracts, ranks {found['all']} places with Town Finder, and shows where every number comes from.

Try it yourself: {url}

Everything in this video is the real application, filmed frame by frame; the live readings are the ones the site showed on the day it was filmed. The narration uses a synthetic voice (Kokoro).

{chapters}

Data: Statistics Canada, Canadian Wildland Fire Information System, Natural Resources Canada, Environment and Climate Change Canada, Northern Tornadoes and Hail Projects, Agriculture and Agri-Food Canada, Water Security Agency, Government of Saskatchewan, Saskatchewan Health Authority, Health Canada, ISED Canada, IRCC, CMHC. Contains information licensed under the Open Government Licence – Canada, the Open Government Licence – Saskatchewan and the Statistics Canada Open Licence; some sources are Crown copyright for non-commercial use, CC BY-NC or the ECCC Data Servers End-use Licence (each is listed under Data & sources in the app). Map data © OpenStreetMap contributors (ODbL); basemap © CARTO. Data extract {found['extract']}.

This is an exploration tool, not legal, real-estate, insurance or health advice. Projections are model ranges, and the hospital closure is a hypothetical, not an announced plan.

TAGS
Saskatchewan, moving to Saskatchewan, Saskatchewan newcomers, Saskatchewan residents, open data, interactive map, climate projections, wildfire, unofficial, Claude Code, AI built app, tutorial, Regina, Saskatoon
"""
