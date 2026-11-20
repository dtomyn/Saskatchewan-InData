"""Come for the sky: a short narrative film for someone who knows almost nothing about Saskatchewan.

Where the how-to (video/storyboard.py) teaches the controls, this one tells a story: a week's visit that slowly turns
into the thought of staying. Day by day it shows the sky (Light & dark: the longest day, the aurora, the sky right now,
the dark-sky preserves), the lakes (Camping & rec's Weekend Reach), the land (What grows here, Treaties & reserves),
a city (Saskatoon in 3D and its Town Report), the question of staying (Town Finder), and then, plainly, the catch:
winter, wildfire, storms, floods, crime and a warming climate, each from the layer that maps it. It ends where it
began, under the sky. The app's features are used, never taught: the cursor opens menus and clicks chips as a
visitor would, and the narration talks about the place, not the buttons.

The narration only says what the app's data shows ({name} is filled from FACTS below and render.py's own facts), and
it keeps the atlas's rules: a hotspot is not a confirmed fire, the aurora forecast is a model's, not a sighting, a
climate twin is a model range, not a forecast, and a flood extent is "touches the mapped extent", never "will flood".

Render it with `--film sky` (it needs `npm run data now`, like the how-to: it films Sky now and the daily record):
  .venv/Scripts/python.exe video/render.py --film sky --storyboard
  .venv/Scripts/python.exe video/render.py --film sky --preview
  .venv/Scripts/python.exe video/render.py --film sky
"""
import storyboard as how
from storyboard import CLOCK, LIVE, SOUNDS, fly, panel_to, pick_layer, pick_option  # noqa: F401  (CLOCK, LIVE, SOUNDS: read by render.py)

NAME = "living-skies-come-for-the-sky"
SCRIPT_TITLE = "Come for the sky: narration script"
BOARD_TITLE = "Come for the sky: storyboard"

SKY = "#3dffa8"
DAWN = "#ffd166"
LAKE = "#4cc9f0"
GOLD = "#f4c430"
CITY = "#7ee0a1"
HOME_C = "#a99bff"
CATCH = "#ff6b6b"
FUTURE = "#e86cff"

SASKATOON = [-106.6700, 52.1300]
SASKATOON_RIVER = [-106.6620, 52.1240]   # downtown and the bridges
WASKESIU = [-106.0800, 53.9200]          # Prince Albert National Park
GRASSLANDS = [-107.4500, 49.1500]
MOOSE_JAW = [-105.5450, 50.3960]
SOUTH = [-105.4, 50.6]                   # the farm belt


# Numbers for the narration, read from the app's data when the film starts.
FACTS = """() => {
  const d = atlas.data;
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const word = (n, cap) => { const w = WORDS[n] ?? String(n); return cap ? w[0].toUpperCase() + w.slice(1) : w; };
  const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)} hours and ${m % 60} minutes`; };
  const L = d.light, towns = Object.entries(L.towns);
  const north = towns.sort((a, b) => b[1].d[2] - a[1].d[2])[0];
  const name = (k) => (d.munis.find((m) => m.key === k) || d.small.find((m) => m.key === k) || { name: k }).name;
  const C = d.camping;
  const reach = C.reach.saskatoon || [];
  const H = d.housing.census.saskatoon, J = d.jobs.towns.saskatoon;
  const money = (v) => '$' + Math.round(v / 1000) + ',000';
  const jan = d.normals.stations.find((s) => /Saskatoon Diefenbaker/.test(s.name));
  const T = d.twins, tw = T.towns.saskatoon.tw;
  const twinName = (e) => { if (e[0] < 0) return null; const s = T.stations[e[0]]; return s.k ? name(s.k) : s.name; };
  const years = d.treaties.treaties.map((t) => t.year);
  const bldg = d.buildings.areas.find((a) => a.name === 'Saskatoon');
  return {
    sktnDay: hm(L.towns.saskatoon.d[2]), northName: name(north[0]), northDay: hm(north[1].d[2]),
    often: towns.filter(([, t]) => t.a === 'often').length,
    preserves: word(L.preserves.length),
    parks: C.parks.length, camps: C.camps.filter((c) => c.kind !== 'backcountry').length,
    reach4: reach.filter((r) => r[1] <= 240).length,
    treaties: word(d.treaties.treaties.length, true), treatyFrom: Math.min(...years), treatyTo: Math.max(...years),
    sktnBldg: (Math.floor(bldg.n / 1000) * 1000).toLocaleString('en-CA'),
    sktnValue: money(H.value), sktnInc: money(J.inc), sktnOwn30: Math.round(H.own30),
    sktnJan: Math.abs(Math.round(jan.tJan)), sktnFrost: Math.round(jan.frostDays),
    twinLow: twinName(tw.ssp126[1][0]) || 'warmer than anywhere here today',
    twinHighWarm: tw.ssp585[1][0][0] === -1,
    tor: d.tornadoes.rows.filter((r) => r[2] >= 2017).length,
    torFrom: 2017,
  };
}"""


def prepare(found):
    """Checks the data still says what the narration says (render.py calls this before filming)."""
    # line fu-2 only holds while Saskatoon's high-emissions twin is "warmer than anywhere": stop rather than say something untrue
    if not found.get("twinHighWarm"):
        raise SystemExit("Saskatoon's 2041-2070 high-emissions twin is no longer 'warmer than anywhere': rewrite line fu-2")


def spoken(text):
    text = how.spoken(text)
    return text.replace("$", "").replace(",000", " thousand dollars") if "$" in text else text


def beat(f, kicker, line, colour, hold=5200):
    f.js("([k, t, c, h]) => Stage.beat(k, t, c, h)", [kicker, line, colour, hold])
    f.sfx("whoosh", 0.3, seconds=0.9, pan_from=-0.6, pan_to=0.3, bright=0.7)


def orbit(f, degrees, ms, zoom=None, pitch=None):
    """A slow, even turn of the camera around the map's centre (the map animates on the film's clock)."""
    f.run("""([d, ms, z, p]) => { const m = atlas.map; m.easeTo({ bearing: m.getBearing() + d, duration: ms, easing: (t) => t,
      ...(z != null ? { zoom: z } : {}), ...(p != null ? { pitch: p } : {}) }); }""", [degrees, ms, zoom, pitch])


def clean(f):
    """Clears the map and any open report, so each day starts from the plain province."""
    f.run("() => { atlas.clearMap(); }")
    f.wait(200)


def chip(f, sel, ms=700):
    """Clicks a chip in the side panel, scrolling the panel to it first if it is out of view."""
    f.run("s => document.querySelector(s)?.scrollIntoView({ block: 'nearest' })", sel)
    f.click({"sel": sel})
    f.wait(ms)


# ---------------------------------------------------------------------------------------------------

def cold(f):
    f.wait(300)
    f.run("() => { atlas.map.stop(); atlas.clearMap(); atlas.map.jumpTo({ center: [-105.6, 52.6], zoom: 4.9, pitch: 52, bearing: -28 }); }")
    f.js("Stage.letterbox(true, 1)")
    f.cursor(False)
    f.run("() => atlas.focus('light')")
    f.wait(400)
    f.run("() => document.querySelector('#panel [data-m=\"now\"]')?.click()")
    f.wait(600)
    f.js("Stage.fade(0, 3200)")
    orbit(f, 26, 26000, pitch=48)
    f.say("c-1")
    f.wait(3400)
    f.board("Cold open", "Black bars; the province fades up at a low angle, night's shade and the aurora forecast over it, turning slowly.")
    f.voice_done(400)
    f.say("c-2")
    f.voice_done(600)
    f.js("Stage.title('Come for the sky', 'A week in Saskatchewan. Maybe longer.', ['sky'])")
    f.sfx("riser", 0.35, seconds=2.4)
    f.mark("pulse")
    f.wait(1800)
    f.board("Title", "The title rises over the turning map.")
    f.wait(1800)
    f.js("Stage.hideTitle(900)")
    f.wait(700)
    f.js("Stage.letterbox(false, 1400)")
    f.wait(600)


def sky(f):
    beat(f, "Day one", "The sky is the whole show", SKY)
    f.run("() => atlas.map.easeTo({ center: [-105.6, 54.2], zoom: 4.6, pitch: 35, bearing: -8, duration: 2600 })")
    f.cursor(True)
    f.wait(1200)
    f.say("s-1")
    chip(f, '#panel [data-m="jun"]', 900)
    f.board("The longest day", "Light & dark on June 21: daylight hours shade the province, longer to the north.")
    f.voice_done(300)
    f.say("s-2")
    chip(f, '#panel [data-m="aurora"]', 900)
    f.run("() => atlas.map.easeTo({ center: [-105.8, 56.2], zoom: 4.8, pitch: 45, bearing: 6, duration: 3400 })")
    f.board("Northern lights", "The aurora bands: in the far north the auroral oval is overhead even on quiet nights.")
    f.voice_done(300)
    f.say("s-3")
    chip(f, '#panel [data-m="now"]', 600)
    f.run("() => atlas.map.easeTo({ center: [-104.5, 53.2], zoom: 3.9, pitch: 30, bearing: -4, duration: 3600 })")
    f.wait(1200)
    f.board("Sky now", "Sky now: night's shade and the sunrise line over the province, and the aurora forecast with the time it is for.")
    f.voice_done(300)
    f.say("s-4")
    chip(f, '#panel [data-m="dec"]', 300)
    fly(f, GRASSLANDS, 6.3, 48, -20, 3600)
    f.wait(3200)
    orbit(f, 14, 7000)
    f.board("Dark-sky preserves", "December's long nights; the map glides south-west to Grasslands National Park and Cypress Hills, the dark-sky preserves.")
    f.voice_done(500)


def lakes(f):
    clean(f)
    beat(f, "Day two", "Then you find the lakes", LAKE)
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, duration: 2600 })")
    f.wait(800)
    pick_layer(f, "Camping & rec")
    f.wait(900)
    f.say("l-1")
    f.board("Camping & rec", "Parks and recreation sites, and a campfire for every campground.")
    f.voice_done(300)
    f.say("l-2")
    panel_to(f, "#panel .reach", 120, 1300)
    f.click({"sel": '#panel [data-lim="240"]'})
    f.wait(300)
    f.click({"sel": "#panel .reach-go"})
    f.wait(7500)
    f.board("Light the campfires", "Weekend Reach from Saskatoon: campfires ignite in rings as the drive time grows to four hours.")
    f.voice_done(300)
    f.say("l-3")
    fly(f, WASKESIU, 9.2, 58, 24, 4200)
    f.wait(4300)
    orbit(f, -18, 8000)
    f.board("The boreal north", "The map flies north into Prince Albert National Park: lakes and forest.")
    f.voice_done(500)


def land(f):
    clean(f)
    beat(f, "Day three", "Gold, to the horizon", GOLD)
    fly(f, SOUTH, 6.0, 50, -16, 3000)
    pick_layer(f, "What grows here")
    f.wait(400)
    f.run("() => { atlas.setTime(2009); const s = document.getElementById('speed-sel'); s.value = '2'; s.dispatchEvent(new Event('change')); }")
    f.wait(500)
    f.say("g-1")
    f.click({"sel": "#play"})
    orbit(f, 20, 12000)
    f.board("What grows here", "The farm belt, year by year since 2009: canola yellow, cereals tan, pasture green.")
    f.wait(6000)
    f.voice_done(400)
    f.click({"sel": "#play"})
    f.say("g-2")
    clean(f)
    pick_layer(f, "Treaties & reserves")
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, duration: 3200 })")
    f.wait(2600)
    f.board("Treaty land", "Treaties & reserves: the six numbered treaties that cover the province, and the reserves inside them.")
    f.voice_done(500)


def city(f):
    clean(f)
    beat(f, "Day four", "A city on a river", CITY)
    f.say("ci-1")
    fly(f, SASKATOON_RIVER, 12.6, 60, -32, 4200)
    f.wait(3600)
    # the terrain button raises the land under the buildings in close-ups
    f.click({"sel": "#terrain-btn"})
    f.run("() => atlas.map.easeTo({ center: [-106.6620, 52.1240], zoom: 14.6, pitch: 64, bearing: -58, duration: 5200 })")
    f.wait(5300)
    orbit(f, 40, 11000)
    f.board("Saskatoon in 3D", "Down into Saskatoon: its buildings stand in 3D along the river, the terrain raised under them, the camera circling.")
    f.voice_done(400)
    f.say("ci-2")
    f.wait(1500)
    f.run("() => { atlas.map.stop(); atlas.openTown('saskatoon'); }")
    f.move({"sel": "#panel", "at": [0.5, 0.35]}, 900, wait=False)
    f.wait(1600)
    f.camera({"sel": "#panel .tr-ct-map", "grow": 60}, 1300, whoosh=0.3, max=1.7)
    f.board("Saskatoon's report", "Saskatoon's Town Report opens on its census tracts; the median home value and household income.")
    f.voice_done(300)
    f.camera("fill", 1100)
    f.say("ci-3")
    f.move({"sel": "#panel", "at": [0.5, 0.6]}, 600)
    f.scroll(1800, 3800)
    f.board("Further down", "The report scrolls on: home costs, schools, doctors, water and the land around it.")
    f.voice_done(400)
    f.run("() => { document.getElementById('panel').scrollTop = 0; }")
    f.click({"sel": "#panel .close-x"})
    f.wait(400)


def stay(f):
    clean(f)
    f.run("() => { const b = document.getElementById('terrain-btn'); if (b?.getAttribute('aria-pressed') === 'true') b.click(); }")
    beat(f, "Day five", "What if you stayed?", HOME_C)
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, pitch: 45, duration: 3200 })")
    f.say("st-1")
    f.wait(1400)
    f.click({"sel": "#finder-btn"})
    f.wait(1200)
    f.board("Town Finder", "Town Finder opens and score columns rise over the towns.")
    f.voice_done(200)
    f.say("st-2")
    panel_to(f, "#panel .chips", 220, 1200)
    f.click({"sel": '#panel [data-preset="newcomer"]'})
    f.wait(800)
    orbit(f, 16, 9000)
    f.board("New to Saskatchewan", "The New to Saskatchewan preset sets the weights; the columns re-rank.")
    f.voice_done(300)
    f.say("st-3")
    panel_to(f, "#panel .rank-list", 160, 1600)
    f.move({"sel": "#panel .rank-list li", "at": [0.4, 0.5]}, 700)
    f.click({"sel": "#panel .rank-list li", "at": [0.4, 0.5]})
    f.wait(1400)
    f.board("A place that fits", "The top place in the ranking opens its report.")
    f.voice_done(400)
    f.click({"sel": "#panel .close-x"})
    f.wait(700)
    f.click({"sel": "#panel .close-x"})
    f.wait(400)


def catch(f):
    clean(f)
    beat(f, "Day six", "The honest part", CATCH)
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, duration: 2400 })")
    f.say("h-1")
    f.voice_done(300)
    # winter
    f.say("h-2")
    pick_layer(f, "Climate normals")
    f.wait(600)
    chip(f, '#panel [data-v="frostDays"]', 1200)
    f.board("Winter", "Climate normals on Frost days: every station's days a year with a low at or below freezing.")
    f.voice_done(300)
    # fire: the season replay from the daily record
    clean(f)
    f.say("h-3")
    pick_layer(f, "Wildfires")
    f.wait(500)
    f.run("() => { atlas.replaySeason(); }")
    f.wait(15000)
    f.board("A fire season", "Wildfires replays this year's season from the daily record: hotspots flare, cool to embers, and the panel counts them day by day.")
    f.voice_done(600)
    f.run("() => atlas.leaveReplay()")
    clean(f)
    # storms
    f.say("h-4")
    pick_layer(f, "Tornadoes")
    f.run("() => atlas.map.easeTo({ center: [-105.6, 51.2], zoom: 5.6, pitch: 45, bearing: -10, duration: 2800 })")
    f.wait(2400)
    f.board("Storms", "Tornadoes: every one on record, mapped where it touched down.")
    f.voice_done(300)
    clean(f)
    # floods: the water sheet and the buildings that touch the mapped extent
    f.say("h-5")
    pick_layer(f, "River floods")
    f.run("() => atlas.setTime(atlas.layers.find((l) => l.id === 'rivers').range[1])")
    fly(f, MOOSE_JAW, 13.8, 60, -25, 4200)
    f.wait(4300)
    orbit(f, 24, 8000)
    f.board("Floods", "Into Moose Jaw: the mapped flood extent as water, and the buildings that touch it tinted.")
    f.voice_done(300)
    clean(f)
    # crime
    f.say("h-6")
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, duration: 3000 })")
    pick_layer(f, "Crime severity")
    f.wait(2000)
    f.board("Crime", "Crime severity: each town's index from Statistics Canada, on the timeline year by year.")
    f.voice_done(300)
    clean(f)


def future(f):
    beat(f, "Day six, still", "And the climate is moving", FUTURE)
    pick_layer(f, "Climate")
    f.wait(500)
    f.say("fu-1")
    chip(f, '#panel [data-twin="on"]', 600)
    pick_option(f, "#panel .twin-town", "saskatoon")
    f.wait(2600)
    f.board("Climate twin", "The Climate twin chip: an arc from Saskatoon to the station whose climate today matches its projected one, 2041–2070.")
    f.voice_done(300)
    f.say("fu-2")
    f.camera({"sel": "#panel .twin-out", "grow": 20}, 1300, whoosh=0.3, max=1.8)
    f.wait(1600)
    f.voice_done(300)
    f.camera("fill", 1100)
    f.say("fu-3")
    chip(f, '#panel [data-twin="all"]', 300)
    f.run("() => atlas.map.easeTo({ ...atlas.HOME, pitch: 50, duration: 3200 })")
    f.wait(2400)
    orbit(f, 18, 8000)
    f.board("Every place", "Every place at once: arcs sweep south, and red marks the places warmer than anywhere here today.")
    f.voice_done(500)
    chip(f, '#panel [data-twin="all"]', 100)
    chip(f, '#panel [data-twin="on"]', 300)


def home_again(f):
    clean(f)
    beat(f, "Day seven", "Come for the sky", DAWN, hold=0)
    f.cursor(False)
    f.run("() => { atlas.focus('light'); }")
    f.wait(300)
    f.run("() => document.querySelector('#panel [data-m=\"now\"]')?.click()")
    f.run("() => atlas.map.easeTo({ center: [-105.6, 52.6], zoom: 4.9, pitch: 52, bearing: -28, duration: 4200 })")
    f.say("e-1")
    f.wait(4300)
    orbit(f, 20, 20000)
    f.board("Under the sky", "Back where it began: the province under night's edge and the aurora forecast, turning slowly.")
    f.voice_done(400)
    f.js("Stage.letterbox(true, 1600)")
    f.say("e-2")
    f.voice_done(500)
    f.js("Stage.hideBeat(800)")


def ending(f):
    f.camera("rest", 1800, whoosh=0.5)
    f.wait(1800)
    f.js("Stage.fade(0.82, 2000)")
    f.sfx("impact", 0.5)
    f.mark("end")
    f.wait(700)
    f.js("([u, fine]) => Stage.end('Come for the sky. Stay for everything under it.', u, fine)",
         [f.url, "Every number from open data: Saskatchewan, Statistics Canada and the Government of Canada · unofficial · nothing to install"])
    f.say("end-1")
    f.board("End card", "The window drifts back; the end card.")
    f.voice_done(3200)
    f.js("Stage.blackout(1800)")
    f.wait(2000)


SCENES = [
    dict(id="cold", title="Cold open", run=cold,
         shows="The province at a low angle under night's shade and the aurora forecast; the title.", camera="Full-frame, letterboxed.",
         motion="The map turns slowly; the title rises.", sound="A riser; the music comes in.",
         lines={"c-1": "Ask someone who's never been, and Saskatchewan is a rectangle in the middle of the map. Flat. Cold. Somewhere you drive through.",
                "c-2": "So say you come for a week, just to see. Here's what you'd find, and what you'd want to know before you stayed."}),
    dict(id="sky", title="Day one: the sky", run=sky,
         shows="Light & dark: June's daylight, the aurora bands, Sky now, and Grasslands' dark sky.", camera="Full-frame.",
         motion="Chips clicked in the panel; the map glides north, then south-west.", sound="Whooshes.",
         lines={"s-1": "They call it the land of living skies. On the longest day, Saskatoon gets {sktnDay} of daylight. Up at {northName}, {northDay}, and twilight hardly ends.",
                "s-2": "Go north, and the northern lights stop being rare. In {often} of its towns, the aurora reaches overhead even on quiet nights.",
                "s-3": "This is the sky as this film was made: the edge of night across the province, and the aurora forecast laid over it. A model's forecast, not a sighting, with the time it's for.",
                "s-4": "Winter brings the long nights. And in the south, {preserves} dark-sky preserves, Grasslands and Cypress Hills, keep them as dark as they get."}),
    dict(id="lakes", title="Day two: the lakes", run=lakes,
         shows="Camping & rec, Weekend Reach from Saskatoon lit to four hours, and Prince Albert National Park.", camera="Full-frame.",
         motion="Campfires ignite outward from Saskatoon; the map flies north.", sound="Clicks, whooshes.",
         lines={"l-1": "Most people picture wheat. Then they find the lakes. The atlas maps {parks} parks and recreation sites, and {camps} campgrounds, each one a campfire on the map.",
                "l-2": "Start from Saskatoon and light the campfires. Each one catches when a drive from the city would get there. Within four hours, {reach4} of them.",
                "l-3": "A long weekend puts you on a lake in Prince Albert National Park, at the edge of the forest that covers the north."}),
    dict(id="land", title="Day three: the land", run=land,
         shows="What grows here played from 2009 over the farm belt; Treaties & reserves.", camera="Full-frame.",
         motion="The timeline plays; the camera turns.", sound="Clicks.",
         lines={"g-1": "Head south, and the land becomes a patchwork you could read from space. Every year since 2009, satellites have mapped what grows in each field. That yellow is canola.",
                "g-2": "And all of it is Treaty land. {treaties} numbered treaties, signed between {treatyFrom} and {treatyTo}, cover the province, with the First Nations reserves inside them. It's worth knowing whose land you're standing on."}),
    dict(id="city", title="Day four: the city", run=city,
         shows="Saskatoon in 3D with terrain; its Town Report: census tracts, home value, income, more.", camera="Full-frame; zoomed on the tract map.",
         motion="The map flies down into the city and circles it; the report scrolls.", sound="Whooshes.",
         lines={"ci-1": "Saskatoon sits on the South Saskatchewan River, a city of bridges. All {sktnBldg} or so of its buildings stand in 3D, right down to the street.",
                "ci-2": "Every place has a report. In the last census, the median home in Saskatoon was worth {sktnValue}, and the median household earned {sktnInc} a year.",
                "ci-3": "Only {sktnOwn30} percent of owners spend more than a third of their income on shelter. Keep scrolling: schools, doctors, water, and the land around it."}),
    dict(id="stay", title="Day five: what if you stayed?", run=stay,
         shows="Town Finder with the New to Saskatchewan preset; the top place's report.", camera="Full-frame.",
         motion="Columns re-rank as the camera turns.", sound="Clicks.",
         lines={"st-1": "By day five, the question changes. Not where to go next, but where you could live.",
                "st-2": "Town Finder weighs what a move turns on: a doctor nearby, childcare, schools, settlement services, internet, the drive to work. Choose what matters, and every town ranks itself.",
                "st-3": "Then open any of them, and see what living there would really be like."}),
    dict(id="catch", title="Day six: the honest part", run=catch,
         shows="Climate normals; this year's fire season replayed; tornadoes; Moose Jaw's flood extent in 3D; crime severity.", camera="Full-frame.",
         motion="Each layer picked in turn; the season plays; the map flies into Moose Jaw.", sound="Clicks, whooshes.",
         lines={"h-1": "Now the catch. Every place has one, and the atlas doesn't hide them.",
                "h-2": "Winter is real. January in Saskatoon averages minus {sktnJan} degrees, and on {sktnFrost} days a year the temperature drops below freezing.",
                "h-3": "Summer brings fire, mostly in the northern forest, and smoke that travels. This is this year's season, day by day, from the atlas's own daily record. These are satellite hotspots, not confirmed fires.",
                "h-4": "Storms build fast on the open prairie. {tor} tornadoes are on record here since {torFrom}.",
                "h-5": "Rivers rise in spring. Where the province has mapped a flood extent, you can see which buildings touch it.",
                "h-6": "And crime runs high in some towns. Each one's crime severity is here, year by year, from Statistics Canada, so you can see which."}),
    dict(id="future", title="Day six: the climate", run=future,
         shows="Climate's Climate twin: Saskatoon's arc, its twin line, then every place.", camera="Zoomed on the twin line; full-frame for the arcs.",
         motion="Arcs sweep across the province.", sound="Clicks.",
         lines={"fu-1": "And the climate is moving. Match Saskatoon's projected climate for 2041 to 2070 against the whole province today.",
                "fu-2": "With low emissions, it's like {twinLow} today. With high emissions, it's warmer than anywhere in Saskatchewan now. A model range, never a forecast.",
                "fu-3": "Do it for every place, and the arcs all point south."}),
    dict(id="home", title="Day seven: come for the sky", run=home_again,
         shows="Back to the opening view: the province under night's shade and the aurora forecast.", camera="Full-frame; the bars return.",
         motion="The map turns slowly.", sound="The music settles.",
         lines={"e-1": "None of it is hidden, and that's the point. You can see the risks, place by place, and still find somewhere that fits.",
                "e-2": "So come for the sky. You might stay for everything under it."}),
    dict(id="end", title="End card", run=ending,
         shows="Title and address.", camera="Back to the floating window.", motion="Logo spins up.", sound="Soft impact; music fades.",
         lines={"end-1": "Living Skies Atlas. Every number from open data. Go and see for yourself."}),
]


def youtube(found, url, chapters):
    return f"""TITLE
Come for the Sky: a Week in Saskatchewan (and Maybe Longer) | Living Skies Atlas

DESCRIPTION
Never been to Saskatchewan? Follow a week's visit that turns into the thought of staying: the longest days and the northern lights, {found['camps']} campgrounds lighting up within a drive of Saskatoon, the farm belt from space, Treaty land, Saskatoon in 3D, and Town Finder's take on where a newcomer might live. Then the honest part: winter, wildfire, storms, floods, crime and a warming climate, each shown from the data that maps it.

Everything in this film is Living Skies Atlas, a free, unofficial 3D map of Saskatchewan's open data, filmed frame by frame from the real app. It is not affiliated with or endorsed by the Government of Saskatchewan or any agency whose data it uses. I built it with Claude Code (Anthropic's AI coding tool). The narration uses a synthetic voice (Kokoro).

Try it yourself: {url}

{chapters}

Hotspots are satellite detections, not confirmed fires; the aurora is a model's forecast, not a sighting; a climate twin is a model range, not a forecast; a mapped flood extent says a building touches it, not that it will flood. Data: Statistics Canada, Natural Resources Canada, Environment and Climate Change Canada, Canadian Wildland Fire Information System, NOAA, Agriculture and Agri-Food Canada, Water Security Agency, Government of Saskatchewan, Indigenous Services Canada, Parks Canada, Northern Tornadoes Project, Microsoft building footprints. Contains information licensed under the Open Government Licence – Canada, the Open Government Licence – Saskatchewan and the Statistics Canada Open Licence; each source and its licence is listed under Data & sources in the app. Map data © OpenStreetMap contributors (ODbL); basemap © CARTO. Data extract {found['extract']}.

This is an exploration tool, not legal, real-estate, insurance or health advice.

TAGS
Saskatchewan, visit Saskatchewan, moving to Saskatchewan, northern lights, Saskatoon, Prince Albert National Park, Grasslands National Park, prairies, open data, interactive map, 3D map, Claude Code
"""
