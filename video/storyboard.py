"""The Living Skies Atlas how-to video: a step-by-step walkthrough of where to click, in order.

The narration says what to do and where, and what each layer is for; it doesn't comment on the data the app shows.

video/render.py plays these scenes against the real app. Each scene has:
  title, shows, camera, motion, sound   what the storyboard page and script.md say about it
  lines                                 narration, by id; {name} is filled from the app's data (see facts() in render.py)
  run(f)                                the scene itself, using the Film calls in render.py

Targets for f.move / f.click / f.camera: {"sel": css, "text": substring, "nth": i, "at": [fx, fy], "grow": px}
for an element in the app, {"lnglat": [lon, lat]} for a place on the map, or {"cx", "cy", "z"} for a camera view.
The camera also takes "fill" (the app fills the frame) and "rest" (the window floats on the background).

The layers are named here as the Layer menu names them; if a layer is renamed, change it here too
(`--check` only fills in the narration; a missing name shows up as "no element" when filming).
"""
import re

# Words the voice reads wrongly from their spelling, as replacements in its phonemes (none needed yet).
SOUNDS = {}


def spoken(text):
    """What the voice reads: the caption text with symbols written out."""
    text = text.replace("3D", "three-D").replace("→", "to").replace("+1", "plus one").replace("&", "and")
    return re.sub(r"\s+", " ", text)


TOUR = "#4cc9f0"
MAP = "#8fdcff"
JUSTICE = "#ff4d8d"
SPARK = "#ff8a3d"
STORM = "#f9d65c"
SETTLE = "#3ecf8e"
HOME = "#5eead4"
TOWN = "#7ee0a1"
FINDER = "#a99bff"
SOURCES = "#d8a06a"
KEYS = "#ffb35c"

NORTH_BATTLEFORD = [-108.2862, 52.7574]
STEPS = 9


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


def fly(f, center, zoom, pitch=40, bearing=-10, ms=1800):
    f.run("([c, z, p, b, ms]) => atlas.map.flyTo({ center: c, zoom: z, pitch: p, bearing: b, duration: ms })", [center, zoom, pitch, bearing, ms])


def home(f, ms=1800):
    f.run("ms => atlas.map.flyTo({ ...atlas.HOME, duration: ms })", ms)


# ---------------------------------------------------------------------------------------------------

def intro(f):
    f.wait(400)
    f.run("() => { atlas.map.stop(); atlas.map.jumpTo(atlas.HOME); }")
    f.js("Stage.title('How to use Living Skies Atlas', 'A step-by-step guide', ['Living', 'Skies'])")
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
    f.wait(600)
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
    start = f.run("() => { const s = document.getElementById('scrub'); return (+s.value - +s.min) / (+s.max - +s.min); }")
    f.drag(range_at(f, "#scrub", start), range_at(f, "#scrub", 0.55), 1500)
    f.board("Scrub", "Paused; the slider is dragged forward through the decades.")
    f.voice_done(200)
    f.say("time-4")
    hint(f, "◆", "Click a marker", "to jump to that event", SPARK)
    f.click({"sel": '.ev[title*="north burns"]'})
    f.camera("fill", 1500, whoosh=0.3)
    f.wait(1600)
    f.camera({"sel": "#panel", "grow": 10}, 1200, max=1.5)
    f.board("Event", "The 2015 marker is clicked; the map flies north and the story of the 2015 fires opens in the side panel.")
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


def settling(f):
    """The layers for someone moving here: who lives here, help for newcomers, getting around, childcare, doctors."""
    step(f, 6, "Settle in: services and community", SETTLE)
    f.say("se-1")
    hint(f, "☰", "Settling in · Health", "groups in the Layer menu", SETTLE)
    pick_layer(f, "Who lives here")
    f.wait(1400)
    f.board("Who lives here", "Census 2021: who lives in each place, from the immigrant share to languages spoken.")
    f.voice_done(200)
    f.say("se-2")
    pick_layer(f, "Newcomer services")
    f.wait(1400)
    f.board("Newcomer services", "Settlement offices, Service Canada and licence issuers on the map.")
    f.voice_done(200)
    f.say("se-3")
    pick_layer(f, "Doctors & clinics")
    f.wait(1200)
    f.voice_done(100)
    pick_layer(f, "Childcare")
    f.wait(1200)
    f.board("Doctors and childcare", "Doctors & clinics, then Childcare: clinics and licensed childcare across the province.")
    f.voice_done(200)
    f.say("se-4")
    pick_layer(f, "Getting around")
    f.wait(1600)
    f.board("Getting around", "Airports, trains, intercity buses and city transit routes.")
    f.voice_done(200)
    f.say("se-5")
    pick_layer(f, "Workday Reach")
    f.wait(1600)
    f.board("Workday Reach", "The drive to work from each town.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def property_checks(f):
    """The layers about the ground under a home: industry, water, radon, and light."""
    step(f, 7, "Check what's around a home", HOME)
    f.run("() => atlas.clearMap()")
    f.say("pr-1")
    hint(f, "☰", "Around the property", "a group in the Layer menu", HOME)
    pick_layer(f, "Hidden neighbours")
    f.wait(1600)
    f.board("Hidden neighbours", "Oil and gas wells and reported industrial sites near the towns.")
    f.voice_done(200)
    f.say("pr-2")
    pick_layer(f, "Drinking water")
    f.wait(1400)
    f.board("Drinking water", "Drinking water advisories in effect.")
    f.voice_done(200)
    f.say("pr-3")
    pick_layer(f, "Radon")
    f.wait(1400)
    f.board("Radon", "Homes tested for radon, by health region.")
    f.voice_done(200)
    f.say("pr-4")
    pick_layer(f, "Light & dark")
    f.wait(1600)
    f.board("Light & dark", "Day length, aurora chances and dark-sky preserves, computed from latitude.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def town(f):
    step(f, 8, "Open a town's report", TOWN)
    f.run("() => { atlas.clearMap(); document.getElementById('event-ticker').hidden = true; }")
    fly(f, NORTH_BATTLEFORD, 7.6, 40, -8, 2000)
    f.wait(2100)
    f.say("town-1")
    hint(f, "●", "Click a town dot", "point at it first to see its name", TOWN)
    f.move({"lnglat": NORTH_BATTLEFORD}, 1100)
    f.wait(900)
    f.board("Point at a town", "The cursor rests on North Battleford and its name pops up.")
    f.click()
    f.move({"x": 760, "y": 520}, 900, wait=False)
    f.voice_done(200)
    f.say("town-2")
    f.wait(1200)
    f.move({"sel": "#panel", "at": [0.5, 0.6]}, 700)
    f.scroll(1400, 3200)
    f.board("The report", "The map flies to the town and its report fills the side panel; the panel scrolls through safety, people and daily needs.")
    f.voice_done(200)
    f.say("town-3")
    f.scroll(1800, 3600)
    f.board("More of the report", "Further down: schools, internet, community, doctors, newcomer help, getting around, childcare, water, radon and home costs.")
    f.voice_done(200)
    f.say("town-4")
    hint(f, "×", "Click the X", "to close the report", TOWN)
    f.run("() => document.getElementById('panel').scrollTop = 0")
    f.wait(300)
    f.click({"sel": "#panel .close-x"})
    f.board("Close", "The X at the top of the report is clicked.")
    f.voice_done(300)
    f.js("Stage.hideChip()")


def finder(f):
    step(f, 9, "Rank towns with Town Finder", FINDER)
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
    f.move({"sel": "#panel", "at": [0.5, 0.5]}, 500)
    f.scroll(f.run("() => { const p = document.getElementById('panel'); return document.querySelector('#panel .chips').getBoundingClientRect().top - p.getBoundingClientRect().top - 220; }"), 1200)
    f.camera({"sel": "#panel .chips", "grow": 20}, 1100, max=1.9)
    f.click({"sel": '#panel [data-preset="newcomer"]'})
    f.board("Presets", "The New to Saskatchewan preset sets all the sliders at once.")
    f.voice_done(200)
    f.say("fi-5")
    hint(f, "≡", "Click a town in the list", "to open its report", FINDER)
    f.camera("fill", 1300, whoosh=0.3)
    f.wait(500)
    # the ranking sits below the sliders: scroll the panel down to it
    f.move({"sel": "#panel", "at": [0.5, 0.5]}, 700)
    f.scroll(f.run("() => { const p = document.getElementById('panel'); return document.querySelector('#panel .rank-list').getBoundingClientRect().top - p.getBoundingClientRect().top - 160; }"), 1800)
    f.move({"sel": "#panel .rank-list li", "at": [0.4, 0.5]}, 700)
    f.wait(300)
    f.click({"sel": "#panel .rank-list li", "at": [0.4, 0.5]})
    f.board("Pick from the ranking", "The top town in the ranking is clicked and its report opens.")
    f.voice_done(300)
    f.say("fi-6")
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
    f.board("Data & sources", "The sources view opens.")
    f.voice_done(200)
    f.say("so-2")
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
         lines={"intro-1": "Here's how to use Living Skies Atlas, step by step."}),
    dict(id="tour", title="Find your way around", run=tour,
         shows="The opening screen and where each control is.", camera="Full-frame.", motion="A spotlight moves from control to control.", sound="Whooshes.",
         lines={"tour-1": "When the app opens, you see just the province, with a dot for each of its {towns} towns and cities.",
                "tour-2": "The Layer button, at the top left, puts data on the map.",
                "tour-3": "At the top right are the Town Finder, Data and sources, and a button that hides the side panel.",
                "tour-4": "The side panel explains whatever you are looking at.",
                "tour-5": "And the timeline along the bottom plays the history layers."}),
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
                "time-4": "The marks above the slider are events. Click one, and the map jumps there and its story opens in the side panel, with what else was happening at the time."}),
    dict(id="switching", title="Switch, combine and clear layers", run=switching,
         shows="Keeping one on with its switch, picking it, the +1 badge, and clearing the map.", camera="Zoomed on the menu and the Layer button.", motion="Real clicks.", sound="Clicks.",
         lines={"sw-1": "Each layer has a switch. Flip Tornadoes on, and it joins the wildfires on the map.",
                "sw-2": "Click a layer's name to show its story and its timeline. The other layers stay on.",
                "sw-3": "The badge on the Layer button tells you how many more layers are on the map.",
                "sw-4": "To clear the map, open Layer and click Clear the map at the top."}),
    dict(id="settling", title="Settle in: services and community", run=settling,
         shows="The Settling in and Health layers: Who lives here, Newcomer services, Doctors & clinics, Childcare, Getting around, Workday Reach.", camera="Full-frame.", motion="Each layer picked from the menu in turn.", sound="Clicks.",
         lines={"se-1": "Moving here? The Settling in and Health groups are for you. Who lives here shows each place's census: where people come from and the languages they speak.",
                "se-2": "Newcomer services maps settlement offices, Service Canada, and where to get a licence.",
                "se-3": "Doctors and clinics, and Childcare, show where to find care for the family.",
                "se-4": "Getting around shows airports, trains, intercity buses and city transit.",
                "se-5": "And Workday Reach shows the drive to work from each town."}),
    dict(id="property", title="Check what's around a home", run=property_checks,
         shows="The Around the property group: Hidden neighbours, Drinking water, Radon; then Light & dark.", camera="Full-frame.", motion="Each layer picked from the menu in turn.", sound="Clicks.",
         lines={"pr-1": "Around the property is about the ground under a home. Hidden neighbours shows wells and reported industrial sites.",
                "pr-2": "Drinking water shows the advisories in effect today.",
                "pr-3": "Radon shows how many homes tested high, region by region.",
                "pr-4": "And Light and dark works out day length, northern lights and dark skies from where you are."}),
    dict(id="town", title="Open a town's report", run=town,
         shows="Pointing at and clicking a town dot, scrolling its report, closing it.", camera="Full-frame.", motion="Hover, click, scroll.", sound="Clicks.",
         lines={"town-1": "Point at a town dot to see its name, and click it to open the town's report.",
                "town-2": "The map flies to the town and the report opens in the side panel. Scroll down to see all of it.",
                "town-3": "Every layer adds to the report: schools, internet, doctors, newcomer help, water, radon, home costs, and more.",
                "town-4": "Click the X at the top to close it."}),
    dict(id="finder", title="Rank towns with Town Finder", run=finder,
         shows="Opening Town Finder, setting a workplace, a slider, the New to Saskatchewan preset, opening a town from the ranking, closing.", camera="Zoomed on the workplace, sliders and presets; full-frame for the list.", motion="A real slider drag.", sound="Clicks.",
         lines={"fi-1": "Click Town Finder to rank the towns by what matters to you.",
                "fi-2": "If you work in one town, pick it here, and the drive to work counts too.",
                "fi-3": "Each slider sets how much one thing counts, from zero, ignore it, to five, matters most. Drag one, and the ranking updates right away.",
                "fi-4": "Or click a preset, like New to Saskatchewan, to set them all at once.",
                "fi-5": "The columns on the map show each town's score. Click a town in the list to open its report.",
                "fi-6": "Closing the report takes you back to the ranking. Click the X again to leave Town Finder."}),
    dict(id="sources", title="See where the data comes from", run=sources,
         shows="Opening Data & sources and jumping to a layer from it.", camera="Full-frame.", motion="Hover, click.", sound="Clicks.",
         lines={"so-1": "Click Data and sources to see where every layer comes from.",
                "so-2": "Point at a source to read about it, and click See it on the map to open that layer."}),
    dict(id="keys", title="Keyboard shortcuts", run=keys,
         shows="The keyboard shortcuts, each pressed in turn.", camera="Full-frame.", motion="A chip for each key.", sound="Key clicks.",
         lines={"keys-1": "Finally, the shortcuts. L opens the layer menu, space plays and pauses, the arrow keys step a year, P hides the side panel, S opens the sources, and Escape closes things."}),
    dict(id="end", title="End card", run=ending,
         shows="Title and address.", camera="Back to the floating window.", motion="Logo spins up.", sound="Soft impact; music fades.",
         lines={"end-1": "That's everything you need. Enjoy exploring."}),
]

SCRIPT_TITLE = "Living Skies Atlas explainer: narration script"
BOARD_TITLE = "Living Skies Atlas: explainer storyboard"


def youtube(found, url, chapters):
    return f"""TITLE
How to use Living Skies Atlas: a step-by-step guide

DESCRIPTION
A walkthrough of Living Skies Atlas, the 3D map of Saskatchewan's safety, justice and land in open data: where to click, step by step. Moving the map, showing and combining its {found['layers']} data layers, playing the timeline, the layers for settling in and for checking around a home, town reports, ranking the province's {found['towns']} towns with Town Finder, the data sources, and the keyboard shortcuts.

Try it yourself: {url}

Everything in this video is the real application, filmed frame by frame. The narration uses a synthetic voice (Kokoro).

{chapters}

Data: Statistics Canada, Canadian Wildland Fire Information System, Environment and Climate Change Canada, Northern Tornadoes and Hail Projects, Agriculture and Agri-Food Canada, Government of Saskatchewan, Saskatchewan Health Authority, Health Canada, ISED Canada, IRCC, Natural Resources Canada, CMHC. Contains information licensed under the Open Government Licence – Canada, the Open Government Licence – Saskatchewan and the Statistics Canada Open Licence; some sources are Crown copyright for non-commercial use or CC BY-NC (each is listed under Data & sources in the app). Map data © OpenStreetMap contributors (ODbL); basemap © CARTO. Data extract {found['extract']}.
This is an exploration tool, not legal, real-estate, insurance or health advice.

TAGS
Saskatchewan, tutorial, how to, open data, interactive map, moving to Saskatchewan, newcomers, Regina, Saskatoon
"""
