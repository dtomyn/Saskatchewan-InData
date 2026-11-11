# Map Atlas Blueprint

A reusable spec for building an animated, open-data map atlas with the same look, feel and capabilities as **Island Atlas** (Vancouver Island in data), plus a scripted explainer video filmed from the real app.

**How to use this file**

1. Copy it into a new, empty repository.
2. Fill in **Part 1 – Project brief** (the only part you need to write). Delete the example lines in *italics*.
3. Give it to Claude Code with: *"Build this atlas from MAP-ATLAS-BLUEPRINT.md. Start with the milestones in Part 9, one at a time."*

Parts 2–8 are the house style and architecture. Change them only on purpose, so every atlas you make feels like part of the same family.

---

## Part 1 – Project brief (Living Skies Atlas)

### 1.1 The idea

| Field | Answer |
|---|---|
| Atlas name | Living Skies Atlas |
| Tagline | Saskatchewan’s safety, justice and land, in open data |
| The one question it answers | How safe is each Saskatchewan community, and how far is it from police, a court and a hospital? |
| Region | Saskatchewan |
| Bounding box (W, S, E, N) | -110.1, 48.9, -101.3, 60.1 |
| Opening camera | intro: -106.0, 54.6, zoom 3.6, flat; home: -105.6, 51.75, zoom 5.35, pitch 45, bearing -12 |
| Outline geometry | Statistics Canada 2021 cartographic boundary file, PRUID 47 |
| Timeline span | 1871 (treaties) → today; history layers 1886 → 2025 |
| Accent / brand colours | defaults |

### 1.2 Places

| Field | Answer |
|---|---|
| What a place is | city, town or northern village (62) |
| Where the list comes from | names in `scripts/places.mjs`, located with the CGNDB geonames API |
| Report / finder names | Town Report / Town Finder |
| Finder headline question | Where should we live? |

### 1.3 Layers

| id | Name | Icon | Colour | Kind | Years | Visual idiom | Source | Licence |
|---|---|---|---|---|---|---|---|---|
| crime | Crime severity | ◆ | #ff4d8d | time | 1998 → 2025 | place columns (chips: CSI, violent, solved) | StatCan 35-10-0061-01 | StatCan Open Licence |
| justice | Courts & police | ⚖ | #ffd166 | static | today | sites + drive-time columns + route pulses | OpenStreetMap / OSRM | ODbL |
| treaties | Treaties & reserves | ◈ | #e9c46a | static | 1871–1906 | tinted areas + bright parcels | ISC Historic Treaties; NRCan CLSS | OGL – Canada |
| fires | Wildfires | 🔥 | #ff8a3d | time | 1959 → 2025 | flare then scar (area-true circles) | NRCan CNFDB points | OGL – Canada |
| tornadoes | Tornadoes | 🌪 | #9ad8ff | time (monthly) | 1980 → today (gap 2010–2016) | funnel flare then dot; track lines (estimated ends faint) | ECCC National Tornado Database; Northern Tornadoes Project | OGL – Canada; CC BY-NC 4.0 |
| rivers | River floods | ≋ | #4cc9f0 | time | 1912 → 2025 | columns vs. normal | ECCC HYDAT | OGL – Canada |
| climate | Climate | 🌡 | #f25f5c | time | 1886 → 2020 | station colour + stripes | ECCC AHCCD | OGL – Canada |
| normals | Climate normals | ☀ | #c5e86c | static | 1981–2010 | columns with chips | ECCC normals | OGL – Canada |
| population | Population | ◍ | #3ecf8e | time | 2001 → 2025 | place columns (colour = 5-yr growth) | StatCan 17-10-0155-01 | StatCan Open Licence |
| hospitals | Hospital access | ✚ | #6c8cff | static | 2020 list | sites + drive-time columns | StatCan ODHF; OSRM | OGL – Canada; ODbL |
| camping | Camping & rec | ⛺ | #59d18c | static | today | park polygons + flickering campfires + drive-time columns; Weekend Reach ignition wave (arcs to every campground within 1–4 h, live count vs the median place, camera framed via `atlas:fly`); park report cards | Sask. PCS ParksAsTitled; Parks Canada; OSM; OSRM | OGL – Canada; ODbL |

Menu groups: Base map (`province`) · Justice & safety (`crime justice treaties`) · History on the timeline (`fires tornadoes rivers climate`) · Places & living (`population hospitals camping normals`).

### 1.4 Historic events

Treaty 4 (1874.71), Treaty 6 (1876.64), the Riel trial and execution in Regina (1885.88), Saskatchewan becomes a province (1905.67), the Regina Cyclone (1912.5), the Souris River floods (2011.45), the 2015 northern fires (2015.5). Data-driven: fires over 100,000 ha, F3+ or casualty tornadoes, province-wide high-water years, the warmest year.

### 1.5 Place Report and Finder

Report rows: Crime Severity, Violent crime, Crimes solved, Courthouse, Police, Hospital, Population, Region / treaty, Campground, Parks nearby, Wildfires nearby, Tornadoes, Climate, climate normals.

Finder criteria (default weight): Low crime (3), Low violent crime (2), Crimes get solved (1), Police nearby (1), Court nearby (1), Close to a hospital (3), Close to camping (0), Low wildfire exposure (1), Fewer tornadoes (0), Milder (1), Sunnier (1), Less snow & frost (0), Growing (2), Services & amenities (2). Presets: Balanced, Safety first, Growing family, Quiet & small.

### 1.6 Deep finder

Not built.

### 1.7 Data & sources view

An aspen round (the tree of the parkland belt): wedge per source, ring per year.

### 1.8 Explainer film

Not built yet.

---

## Part 2 – Principles (don't break these)

1. **Open data only.** Every number comes from a named public source with a licence. No scraped paywalled data, no invented values (e.g. tsunami arrival times only from published modelling, never estimated).
2. **Re-runnable data, no manual downloads.** All data arrives through `npm run data` stages. Prove it by deleting `.cache/` and running from empty. Anything genuinely impossible to fetch (no feed exists) is typed into a script with a dated comment and listed under "Still open" in the roadmap.
3. **Fully static site.** No backend. Pre-built JSON in `public/data/` is committed, so `npm install && npm run dev` works immediately.
4. **Honest labelling.** Projections look different from records (hatched, dashed, a "projection, not a record" badge). Show ranges, not single numbers, for model output. Say when a value is borrowed from the nearest station, estimated, or covers a wider area. Missing data is skipped, never penalized.
5. **Starts empty.** The map opens on just the region with place dots. Nothing is overlaid until the user picks a layer.
6. **Every number is counted from the loaded data**, including the counts on the sources page and figures said in the video narration.
7. **Escape everything from data.** Names from crowd-edited sources (OpenStreetMap, Wikidata) or the visitor go through `esc()` before `innerHTML`; links go through `safeUrl()`. A build-time Content-Security-Policy backs this up.
8. **Plain English.** UI text, panel ledes and narration are short, concrete and jargon-free. Explain what a measure means ("2% chance in 50 years") the first time it appears.
9. **Caveats section.** The README says it's an exploration tool, not professional advice, and names the main limitations of the data.

---

## Part 3 – Stack and repo layout

- **MapLibre GL JS** basemap: CARTO Dark Matter style, shaded relief from Mapzen/AWS Terrarium tiles.
- **deck.gl** (`@deck.gl/core`, `layers`, `aggregation-layers`, `geo-layers`, `extensions`, `mapbox`) through `MapboxOverlay({ interleaved: true })`, so flat layers can sit under basemap labels.
- **d3** for panel charts and scales.
- **Vite + TypeScript**, `base: './'` so it works from any GitHub Pages sub-path.
- Pipeline: **Node ESM scripts**; dev deps only (`@turf/*`, `exceljs`, `fflate` as needed).
- Video: **Python 3.12 + Playwright (Microsoft Edge for GPU WebGL) + imageio-ffmpeg + kokoro-onnx + soundfile + numpy**, in a `uv` venv at `.venv/`.

```
index.html                 app shell: map, appbar, panel, top actions, timeline (with its event ticker), tooltip, modal, loader
src/main.ts                state, map init, render loop, focus/menu/timeline, keyboard, hashes, ?film handle
src/layers.ts              AtlasLayer interface + one factory per layer + CURATED_EVENTS
src/data.ts                types for every JSON file, loadAll(), formatters (fmt), helpers (km, lowerBound…)
src/metrics.ts             per-place derived metrics, CRITERIA, rankPlaces()
src/panels.ts              Place Report and Place Finder panels, weights in localStorage
src/charts.ts              d3 barChart, lineChart, scatterChart, stripes, rampCSS — all with a playhead
src/sources.ts             the Data & sources view
src/<deepfinder>.ts        optional deep finder (rail, funnel, report, shortlist)
src/html.ts                esc(), safeUrl()
src/style.css              the whole design system (Part 4)
scripts/fetch-data.mjs     pipeline: SOURCES stages, cache, manifest
scripts/places.mjs         the place list and any hand-typed facts
scripts/<big-stage>.mjs    large stages split into their own module, imported lazily
public/data/*.json         committed outputs + manifest.json
video/storyboard.py        main film scenes; storyboard_<film>.py for supplements
video/render.py            the renderer (Film class)
video/sfx.py               synthesized sounds and music bed
video/stage/               stage.html/css/js (the framed "set") and vt.js (animation clock sync)
.devcontainer/             Node 22 container for app + pipeline
.github/workflows/deploy.yml  build + deploy to Pages, least privilege
README.md, ROADMAP.md
```

`package.json` scripts: `dev` → `vite`, `build` → `tsc --noEmit && vite build`, `preview`, `data` → `node scripts/fetch-data.mjs`.

---

## Part 4 – Look and feel

### 4.1 Mood

Dark, cinematic, glowing data on a near-black map. Frosted-glass UI floating over a full-bleed 3D map. Data *moves*: things flare, ripple, rise and cool. Serif display numbers give it an editorial, atlas-like feel; a mono face marks data values and ranges.

### 4.2 Design tokens (copy exactly)

```css
:root {
  --bg: #060a12;
  --glass: rgba(11, 17, 30, 0.74);
  --glass-strong: rgba(9, 14, 26, 0.9);
  --line: rgba(148, 170, 210, 0.14);
  --line-strong: rgba(148, 170, 210, 0.28);
  --ink: #e9eef7;
  --ink-2: #b4bfd2;
  --ink-3: #7d8aa3;
  --accent: #ff8a3d;          /* swap per project in 1.1 */
  --good: #3ecf8e;
  --radius: 14px;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  --font: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif;
  --display: 'Fraunces', Georgia, serif;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
  color-scheme: dark;
}
```

Fonts from Google Fonts: Inter 400/500/600/700, Fraunces (opsz 9–144, 500/700), JetBrains Mono 500. Base size 14px (13px under 820px). Bad = `#ff6b6b`. Links `#9cc7ff`.

**Per-element colour:** every layer, section and card sets `--c` to its own colour, and components use `color-mix(in srgb, var(--c) N%, transparent)` for tints, borders and glows. This is what makes each layer feel coloured without new CSS.

Fixed feature colours: Finder violet `#a99bff` / `#7b61ff`; deep finder teal→lime `#5eead4 → #a3e635 → #fde047`; place/"good" green `#3ecf8e`; sources cedar `#ffb86b`.

### 4.3 Typography roles

| Role | Style |
|---|---|
| Brand name | Fraunces 700, 26px |
| Panel title (h2) | Fraunces 700, 24px, line-height 1.15 |
| Big numbers (hero stats, year readout 34px, metric values 19px) | Fraunces 700, `tabular-nums` |
| Kicker above titles | 11px, uppercase, letter-spacing 1.4px, weight 600, colour `var(--c)` |
| Section heads (h3) | 12px uppercase, letter-spacing 1.1px, `--ink-3` |
| Lede | 13.5px, `--ink-2`, line-height 1.55 |
| Data values, ranges, axis labels | JetBrains Mono 10.5–11.5px |
| Notes, source lines | 11–11.5px `--ink-3` |

### 4.4 Screen layout (desktop)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ (◎) Atlas Name        [● Layer: Wildfires  +1 ▾]     [Deep finder][◎ Finder][Data & sources][▯] │
│     tagline                                                          ┌───────────┐ │
│                                                                      │  panel    │ │
│                                                                      │  380px    │ │
│                    full-bleed 3D map + vignette                      │  kicker   │ │
│                                                                      │  h2       │ │
│                                                                      │  lede     │ │
│                                                                      │  hero ×2  │ │
│                                                                      │  chart    │ │
│ ┌──────────────────────────── timeline (92px) ───────────────────┐   │  source   │ │
│ │ (▶)  1950   ▁▂▃▅▂▁▇▃ sparkline ◆ ◆ events  ━━━━●──────  Speed │   └───────────┘ │
│ └────────────────────────────────────────────────────────────────┘                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **App bar** top-left (14px/16px): spinning conic-gradient brand mark (38px ring, 18s spin, glow), name, tagline; then the **layer picker** — one pill button showing the focused layer's icon, a "LAYER" micro-label, its name, a `+N` badge for extra visible layers, and a chevron.
- **Top actions** top-right: pill buttons. The Finder button is violet-glowing (`.accent`); the deep finder has a teal-lime gradient; Data & sources has a tiny tree-ring icon; an icon button hides the panel (`P`).
- **Side panel** right, 380px, glass, `top: 72px`, scrolls; collapses with a fade + slide.
- **Timeline** bottom, glass, radius 18px, grid `52px 92px 1fr 92px`: round accent play button (pulses while playing), year + month readout, track (sparkline canvas 34px, event diamonds, range scrubber with glowing thumb and filled-to-here track, mono min/label/max), speed select (½, 1, 2, 4, 8 yr/s; default 2).
- **Event ticker** docked on the timeline's top edge: one line (mono date in the event's colour, bold title, a **Details ›** pill) that shows as playback crosses an event and fades after 7s. Never a stack of cards over the map; the full story belongs in the panel.
- **Tooltip** follows the pointer (+14px), glass-strong, max 280px, key/value with mono values.
- **Map controls** moved left of the panel; restyled to glass with inverted icons.
- **Vignette** radial darkening over the map edges.
- **Loader** full-screen: spinning conic ring + one-line message ("Loading a century of … history…"), fades out over 0.8s.

**Responsive:** under 1100px the panel is 330px and the brand tagline hides. Under 820px: brand text hides, the layer menu becomes full-width fixed, Data & sources and panel buttons hide, the panel docks above the timeline (max 34vh), the timeline spans the width without the speed control, and map controls hide.

### 4.5 Components

| Component | Recipe |
|---|---|
| `.glass` | `--glass` bg, `backdrop-filter: blur(14px) saturate(140%)`, 1px `--line` border, `--radius`, `--shadow` |
| `.pill-btn` | radius 999px, 8×14px padding, `--line-strong` border, glass bg, 600 weight 12.5px |
| Layer menu | 330px dropdown, glass-strong, grouped with uppercase group heads; rows = 28px tinted icon tile, name, mono year range, and an on/off switch (`role="switch"`). The active row has a `--c` gradient and a glowing 3px left bar. The top row is the base map: highlighted as "Just the region" when nothing is on, otherwise a dashed-outline "Clear the map" reset. Ends with a hint line. Behaviour in §5.3 |
| Hero stats | 2-column grid of tiles: big Fraunces value, small label |
| Metric tile (reports) | label with coloured dot, Fraunces 19px value, 11px sub-line |
| Callout | 2px `--c` left border, faint bg, 12.5px |
| Chips | small pills; `.on` fills with `--c` at 25% |
| Legend / ramp | colour swatches; a 10px CSS gradient ramp with mono end labels |
| Source line | top border, 11px `--ink-3`, "Source: …" — every layer panel ends with one |
| Range bar | track + translucent band (10th–90th percentile) + white tick (median) + grey tick (today) |
| Projection badge | dashed `--c` border, hatched background, uppercase "Projection, not a record" |
| Static note | when the active layer is static, or no layer is active, the timeline greys out (opacity .16) and a centred note says why: "X doesn't change over time", "No layer picked — click one for its timeline", or "No history layer on the map" |
| Rank list | rank number (mono), name + sub-line, gradient score bar (`#7b61ff → #3ecf8e`) with mono 0–100 |
| Switch | 34×19 track; checked = `--c` with glow; springy thumb |
| Modal | dimmed blurred backdrop, glass sheet ≤760px, Fraunces title |
| Close button | 28px square, top-right, `×` |

Charts (`charts.ts`): small d3 bar/line/scatter/stripes charts sized to the panel width, axis text `--ink-3` 10px, grid `--line`, and a **playhead** that tracks the timeline (`setPlayhead(t)`). Dashed lines for projections; muted lines for context series. Charts are created after the panel is in the DOM (one `requestAnimationFrame`).

### 4.6 Map visual idioms (deck.gl)

Pick one per layer in the brief:

| Idiom | How it works | Used for |
|---|---|---|
| **Flare then scar** | New items extrude and glow white-yellow→red with additive blending for a glow window tied to playback speed (`max(0.25, speed × 0.9)` years), then settle into a dim flat "scar" filtered by `DataFilterExtension` to `[start, time]`. **Ageing variant** (logging): the scar changes with age (bare ground → regrowth → young forest) by stacking copies of the layer, each one colour, with `filterRange` `[time − age, time]` and a `filterSoftRange` that fades it out on the GPU, so nothing is recoloured per frame. Big shape sets load on first show | fires, logging, construction, events with area |
| **Ripple at depth** | Points drawn at true depth (exaggerated ×3) with expanding surface shockwave rings | earthquakes, incidents |
| **Drill holes** | A line from the ground down to each item's real depth (exaggerated, with ×10/×30/×100 chips), coloured by a measured value, a dot at the bottom (hollow when the value is poor) and a tick for a level inside the hole; new items flash down their hole as the timeline passes them; the matching panel chart draws them side by side, shallowest to deepest | water wells, boreholes, mines |
| **Columns vs. normal** | `ColumnLayer` per station, height = value, colour = ratio to the station's own normal | river gauges, smoke days, counts |
| **Station colour** | Points/columns coloured on a diverging ramp (blue → grey → red) + warming-stripes chart | climate anomalies |
| **Surface** | Interpolated grid drawn to a bitmap, clipped to the outline, translucent, under labels; hatched for projections | hazard models, projections |
| **Place columns** | Extruded columns at each place, height/colour by the place metric; years interpolated between data points | population, prices, crime |
| **Glowing web** | Paths with additive glow, moving particles along them, routes coloured by effort | trails, roads, routes |
| **Beams** | Vertical columns of light sized by a real value | waterfalls, towers |
| **Water rise** | Low ground as translucent extruded cells that appear as a front sweeps in (`DataFilterExtension` with a soft range, the front read from the clock), a bright additive crest at the edge, and the water rising after; label the sweep as order, not timing, unless modelled times are published | tsunami, storm surge, sea-level rise |
| **Map-wide haze** | Full-map tint whose strength follows a regional average for the year | smoke, drought |
| **Hexagon field** | The region as extruded hexagons on a published grid (shrunk ~20% so seams show), height and colour by a measured value eased between periods, a soft additive glow under each, and gaps (or dark flat cells) where there is nothing; a chip row switches between measures | internet speeds, coverage, any gridded count |

Shared rules:

- Flat layers (ids matching `/scars|embers|base|stems/`) are re-inserted before the first basemap label layer; 3D columns stay on top.
- `NO_DEPTH` (`depthWriteEnabled: false, depthCompare: 'always'`) for overlays; an `ADDITIVE` blend preset for glows.
- Transitions on elevation/colour (~600ms, cubic-out) when values change.
- Data sorted by time once; `lowerBound()` slices the "active now" window each frame instead of filtering everything.

### 4.7 Basemap styling

- CARTO Dark Matter; hillshade from Terrarium DEM (exaggeration 0.55, shadow `#02040a`, highlight `rgba(150,175,215,.22)`, accent `#0b1424`, light from 315°) inserted **under the water layer** so the sea stays flat.
- Region outline as two lines: a wide blurred glow (`#4cc9f0`, width 10, blur 10, opacity .16) and a crisp line (`#8fdcff`, 0.8px, .5).
- Sky/fog: sky `#060a12`, horizon `#12233d`.
- Opening: start at a wide flat view, then `flyTo(HOME)` over 4.2s with curve 1.6 after the loader fades.
- `maxPitch: 75`, antialiasing on, compact attribution.

### 4.8 Motion

Menu in: 0.18s fade/slide down. Panel swap: fade + 6px rise. Ticker in: 0.4s springy rise. Play button pulse ring. Brand mark slow spin. Selected place: a white ring pulsing out every 1.6s. Event beacons: three staggered expanding white rings over 3.5s. Respect `prefers-reduced-motion` for full-screen views.

---

## Part 5 – App architecture

### 5.1 The layer contract

Every layer is one factory in `layers.ts` returning:

```ts
export type Ctx = { time: number; speed: number; data: Data; selected: string | null; hovered: string | null; focusedId: string; clock: number };
export type AtlasEvent = { t: number; layer: string; title: string; body: string; lon?: number; lat?: number; zoom?: number };
export type PanelHandle = { update: (ctx: Ctx) => void };

export interface AtlasLayer {
  id: string; name: string; icon: string; color: string;
  range: [number, number];          // timeline span for this layer
  monthly?: boolean;                // arrow keys step a month instead of a year
  static?: boolean;                 // doesn't change over time (see 5.3)
  period?: string;                  // caption for a static layer, e.g. "1981–2010 average"
  available: boolean;               // false if its JSON is missing
  unavailable?: string;             // what to run to get it
  build: (ctx: Ctx) => Layer[];     // deck.gl layers for this moment
  spark: () => { x: number; y: number; color?: string }[];  // timeline sparkline
  events: () => AtlasEvent[];       // data-driven events (e.g. record years)
  panel: (el: HTMLElement, ctx: Ctx) => PanelHandle;         // story panel; update() ~every 90ms
  tooltip: (info: PickingInfo) => string | null;
  click?: (info: PickingInfo) => boolean;
}
```

Panel recipe for every layer: kicker (layer colour) → h2 → lede (what you're seeing, one or two sentences) → hero stats that update with time → one or two charts with a playhead → legend/ramp → callout for the key insight → note on caveats → source line. If unavailable: a dashed box saying which `npm run data <stage>` to run.

### 5.2 State and render loop

```ts
const state = {
  time, playing, speed,
  focused: 'base',            // the ACTIVE layer: its story in the panel, its timeline; 'base' = none active
  timeLayer: '<first time layer>',  // last active time-based layer; static layers leave it alone
  visible: new Set<string>(), // the layers switched on — exactly what's drawn (never contains 'base')
  selected, hovered,          // place keys
  mode: 'layer' | 'place' | 'finder' | 'deep',
  ranked, beacons,
};
```

One `requestAnimationFrame` loop: advance time when playing (`dt × speed`, stop at the end of the range), fire events crossed since last frame (ticker + beacon), `render()` (rebuild the deck layer list from visible layers + place pins/finder columns + selected ring + beacons), sync the timeline UI, update the panel every ~90ms.

### 5.3 Layer behaviour

**On the map vs. active.** Every layer has two independent facts, and the UI shows each in exactly one place:

| | Meaning | Shown by | Changed by |
|---|---|---|---|
| **On the map** | drawn on the map (any number of layers) | the row's switch | the switch, and nothing else turns a layer off |
| **Active** | its story is in the side panel and, if it's a time layer, the timeline is its (at most one) | the highlighted row and the picker button's name | clicking the row's name |

Rules, all in two functions (`setLayerOn(id, on)` for the switch, `focus(id)` for a name click) plus `clearMap()`:

1. **Switch on** → add to `visible`. If no layer is active, it also becomes active (so the first layer you turn on gives you its story and timeline straight away). Otherwise it's just added; the active layer doesn't change.
2. **Click a name** → make it active, switching it on if it was off. Other layers stay on; nothing is replaced. The menu closes.
3. **Switch off** → remove from `visible`. If it was the active layer, there's no active layer any more: stop playback, the panel and timeline drop it (`focus('base')`, which must not clear `visible`).
4. **Clear the map** (the top row while anything is on) → empty `visible`, stop playback, no active layer.
5. **No active layer but some on** → the picker reads "N layers on", the timeline shows "No layer picked", and the panel lists the layers that are on, each a click away from becoming active. Never show "Just the region" as selected while anything is on.
6. **Picker badge** `+N` = layers on the map besides the active one.
7. **Anything that opens a layer from elsewhere** (a map click on an overlay's feature, a link in a Place Report) calls `focus(id)`: it becomes active and every other layer stays on. A feature is clickable whenever its layer is on the map, not only while it's active; the exceptions are full-coverage rasters, which would swallow clicks meant for thin lines underneath, so they're pickable only while active.

- **Static layers**: when the active layer is static, the timeline dims with a note; the timeline keeps the last active time layer's range, so time layers that are still on keep animating underneath.
- **Per-item values from a later stage** (a deep-finder measure added after the items were built) go in their own file in the items' order with a hash of their ids, loaded optionally; a mismatch leaves the values missing (the filter passes everything) rather than misaligned. This keeps parallel work off the big items file.
- **Place layers** draw their own columns, so plain place pins hide while one is on the map. Some static layers draw place columns only while active.
- **Events**: curated (`CURATED_EVENTS`) + each layer's `events()`. Diamonds on the track. Crossing one during playback shows the ticker and a beacon. A layer's **Key moments** list holds its own events, island-wide events in a time layer's years, and any island-wide event that names the layer in `layers` (how a static layer gets its historic story).
- **An event has its own panel** (`src/events.ts`), opened from a diamond, the ticker's Details, or the **Key moments** list each layer's panel ends with. The timeline stops at the event's date and the map flies there. Only `t`, `layer`, `title` and `body` are required; optional fields deepen the panel without touching it: `stats` (headline tiles), `sections` (heading + text), `image` (with credit), `sources` (links), `layers` (what "Show it on the map" switches on, at the event's date), `end` (for events that ran a while), and `detail(el)` for anything richer a layer wants to draw. The panel adds context for every event by itself: the layer year by year with the moment marked, **Also happening** (other layers' events within 18 months), the closest towns (each opens its report, and closing it comes back to the event), and earlier / later moments. Back returns to wherever the first event was opened from.
- **Everything on the map opens a panel on click, never just a hover bubble.** A town (its dot, or its column on any layer) opens its report; any other feature opens the event panel described above, as a record with no date when it's a place rather than a moment (`t` is optional). A layer gives its features rich panels with `describe(info) → AtlasEvent` (an earthquake's rank and depth, a gauge's or station's chart of its record via `detail`). A layer without `describe` still gets a panel built from its tooltip: the bold line becomes the title and each `<span class="tk">label</span> <span class="tv">value</span>` pair a headline tile, so keep tooltips in that shape. Tooltips end with "Click for details" unless they already say what a click does.
- **Hover** anything for a tooltip; **click** a place dot → Place Report.
- **A report can open a layer** ("See a century of logging on the map"): it dispatches `atlas:layer` with the layer id; main focuses it and, for a time layer, jumps to the end of its range (today), where the story the report summarised ends.
- **A layer's panel list can open one of its features** (Floodplains' study list): it dispatches `atlas:event` with an `AtlasEvent` (the same one `describe` returns for a click on the map), and main opens it with `openEvent`, so the list and the map lead to the same details panel.
- **A layer can frame the camera** (Weekend Reach): it dispatches `atlas:fly` with `{ bounds: [[w, s], [e, n]] }` and main fits the map to it, leaving room for the side panel.
- **A report can start a layer's own action** ("Light the campfires" in the Town Report): it dispatches `atlas:reach` with the place key; the camping layer focuses itself through `atlas:layer`, then starts its wave.

### 5.4 Place Report and Finder

- `metrics.ts` computes a `PlaceMetrics` per place from all data (nearest station within a reach, counts within a radius since a year, trailing medians, interpolated years). Record *which* station/area a value came from and how far away, and show it.
- `CRITERIA`: `{ id, label, hint, value(t), higherIsBetter, defaultWeight }`.
- `rankPlaces()`: **percentile-rank each criterion across places** (ties share the average rank, flip if lower is better), then a weighted average over criteria the place has data for. Score 0–1, shown 0–100.
- Finder panel: violet kicker, the headline question, lede, sliders (0–5, label + hint), preset chips, ranked list, note on how scores work. Weights persist in `localStorage` under `<atlas-id>:weights` (wrapped in try/catch).
- On the map: ranked places as violet→mint columns (`#2b1f6b → #7dffc4`), top 5 brighter, top 10 labelled "1 · Name".
- Clicking a place flies there, shows the pulsing ring, opens its report; closing returns to the ranking.

### 5.5 Deep finder (if in the brief)

Left rail (360px, glass, slides in) + bottom **funnel** + right result list:

- Huge gradient count of matches at the top; preset chips ("Our brief", "Show everything").
- Collapsible sections, each with an icon tile in its colour; every slider sits on a **histogram of the items that value would let through given all the other filters** (kept bars glow in `--c`, cut range hatched).
- Funnel: one stage per section showing count after that step with a bar; the step that cuts the most is flagged "tightest"; the last stage glows.
- Matches glow on the map and rank by a score; cards show rank, title, badges, mini meters, score ring.
- Item report: hero + score ring, radar of strengths, arcs to the places it relies on, satellite toggle, links out, shortlist star with notes and asking price (localStorage).
- In deep mode the timeline, layer picker and panel button hide.
- A measure added later by its own data stage goes in its own file beside the item file (`<deep>-<topic>.json`, in the item file's order with the item ids to check it), loaded optionally: stages stay independent and re-runnable, and the item file isn't rebuilt for every new measure.
- **Extra measures from another stage** go in a side file (e.g. `land-neighbours.json`) that follows the main file's item order and carries a hash of its id column; the finder loads it if present and checks the hash, so stages built in parallel never rewrite the main file, and a stale side file is ignored rather than misread. Its filters default to off, so the starting brief is unchanged.
- **Surroundings ring** (optional): a ring around the item, sectors × distance bands, each cell coloured by what covers most of it (park, public land, water, logging by age…), measured in the pipeline on a raster grid, with a key of shares.

### 5.6 Data & sources view

Full-screen overlay (`S`, `#sources`): left = intro (kicker, big title, lede, stat row: sources, records, years covered) and the metaphor visual drawn on a canvas, with an animated year counter at its centre; right = 420px card list grouped by layer. Each card: colour bar, name, status from `manifest.json` (ok/failed, updated date), publisher, linked dataset title, what it gives, **a count read from the loaded data** ("**12,431** fire perimeters"), the endpoint in mono, licence pill, and "See it on the map →". Then a "What the atlas works out itself" list of derived figures, a licence summary and a "Copy citation" button.

### 5.7 Navigation and keys

`L` layer menu · `Space` play/pause · `←/→` step a year (or month) · `P` panel · `S` sources · `Esc` closes. Hashes: `#sources`, `#<deep-finder>`, `#<feature layer>`. Inputs never capture shortcuts. Right-drag or Ctrl-drag tilts/rotates.

### 5.8 Film handle

When loaded with `?film`, expose `window.<atlasId> = { map, state, data, layers, focus, clearMap, openPlace, openFinder, openDeep, closeDeep, setPlaying, setTime, setPanelOpen, setMenu, showSources, HOME }` for the video renderer only.

---

## Part 6 – Data pipeline

`scripts/fetch-data.mjs` is a dictionary of **stages**, one per source:

```js
const SOURCES = {
  async base() { /* outline geometry → base.json */ },
  async fires() { /* fetch, clip to outline, simplify, quantize, writeOut('fires', …) */ },
  async places() { /* … */ },
  async deep() { const { buildDeep } = await import('./deep.mjs'); await buildDeep({ log, cached, writeOut, … }); },
};
const order = ['base', /* …stages that others read come first… */, 'deep'];
```

- `npm run data` runs all in order; `npm run data fires crime` runs some.
- Helpers: `cached(name, producer)` (raw responses in `.cache/`), `fetchBuf(url, { retries: 3, timeout })` with backoff, `fetchJSON`, `cachedJSON`, `pool(items, size, fn)` for polite concurrency, paged readers for the common APIs (WFS, OGC API), `writeOut(name, data)` (compact JSON + KB log).
- Clip everything to the region outline (`onRegion(lon, lat, tolerance)`), simplify geometry, round coordinates to 4 dp, store arrays-of-tuples for big point sets (`[lon, lat, t, size, cat]`), keep times as fractional years.
- Every output includes a `source` string (publisher, dataset, licence).
- **A failing stage never breaks the others**: it's logged, the old file stays, and `manifest.json` records `{ ok, updated, lastError, lastAttempt }`, which the sources view shows.
- Rate-limited services (routing, point-query APIs): batch, sleep between calls, cache each response.
- Huge global files sorted by a spatial key (e.g. quadkey-sorted parquet): read only the region's rows with HTTP range requests and cache the clipped rows, never the whole file.
- Validate a response before caching it: a busy BC WFS answers HTTP 200 with an XML `ExceptionReport`, which a plain cache would keep forever. Parse it, check for `features`, retry with backoff.
- Area questions (share of land logged, what's next door) are answered on a raster: rasterize polygons onto a grid (scanline fill with per-row edge buckets) and count cells, so overlaps count once. Remove slivers (road allowances, trail corridors) from ownership masks with a morphological opening.
- Big stages live in their own module and receive the helpers as arguments.
- Feeds that change seasonally (timetables) take the most common value over the next few weeks and fail with a clear message when the feed runs out.
- Acceptance: `rm -rf .cache && npm run data` completes and `npm run build` passes.

---

## Part 7 – Security, quality and deployment

- `esc()` / `safeUrl()` in `src/html.ts` for anything not a literal.
- Build-only CSP meta tag via a Vite plugin: `default-src 'self'; script-src 'self'; worker-src 'self' blob:; child-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; object-src 'none'; base-uri 'self'; form-action 'none'`.
- GitHub Pages workflow: `permissions: {}` at the top; build job `contents: read`, `persist-credentials: false`, Node 22, `npm ci`, `npm run build`, upload `dist`; deploy job alone gets `pages: write` + `id-token: write`.
- Optional: rulesets for owner-only pushes and a protected `main`, `CODEOWNERS`.
- Dev container: Node 22, curl, `npm ci` into a `node_modules` volume, port 5173, `ATLAS_WATCH_POLL` for file watching from Windows.
- `tsc --noEmit` must pass; the page must log no errors (the video renderer fails on page errors).

---

## Part 8 – The explainer video

A narrated, step-by-step **how-to** film, recorded from the real built app by script, so it can be re-rendered after any change to the app or data.

### 8.1 Rules for the film

- The narration says **what to click and where**, in order. It doesn't comment on what the data shows.
- Every click, drag, scroll and key press is real; the app responds for real.
- Deterministic: a virtual clock steps one frame at a time (Playwright fake clock + `vt.js`, which pins CSS/Web Animations to that clock), so every run gives the same film on any machine.
- Numbers said aloud come from the app's data (`facts()` reads them through the film handle; lines use `{name}` placeholders).
- **Master at 2560×1440, plus a 1920×1080 copy. Never 4K.** 30 fps.
- Re-render after `npm run data`.

### 8.2 The stage

`video/stage/stage.html` is a 1920×1080 "set":

- **Background**: slow aurora — three huge blurred blobs (teal `#1d6f8f`, violet `#5b3cc4`, ember `#c4612a`) drifting over faint generated contour lines (`#7fb4ff`, 22%) on a deep navy radial gradient.
- **Window**: the app in an iframe (1600×900) inside a floating browser window — rounded 16px, traffic-light dots, a URL pill showing the site address, a cool outer glow. The **camera** zooms and pans this window (Screen Studio-style): `"fill"` (app fills the frame), `"rest"` (window floats on the background), or a target element/region.
- In the window (zoom with it): a **cursor** (arrow and hand), click **ripples**, a **spotlight** that dims everything but a target, and **pins** (labels on map points).
- In the HUD (don't zoom): **title** (rises word by word out of a blur), **chapter tag** ("Step 3 of 9" + title, slides in from the left in the step colour), **chips** (on-screen hints: icon, "Drag", "to move the map"), **stats** cards, **end card** (logo spin-up, tagline, address, fine print), fades and blackout.

`Stage` API: `camera, cursorShow, cursorAt, cursorTo, mouse, press, point, rect, spot, pin, clearPins, fade, blackout, title, hideTitle, chapter, hideChapter, chip, hideChip, stats, hideStats, end, url`.

### 8.3 The `Film` API (used by scenes)

`wait(ms)`, `wait_until(js)`, `say(line_id)`, `voice_done(pad)`, `sfx(name, gain, …)`, `mark(name)`, `js(stage_expr, arg)`, `run(app_expr, arg)`, `camera(target, ms, whoosh=…)`, `cursor(on)`, `move(target, ms)`, `click(target)`, `drag(start, end, ms, button)`, `key(name)`, `scroll(dy, ms)`, `board(title, why)` (a storyboard frame: real screenshot + note).

Targets: `{"sel": css, "text": substring, "nth": i, "at": [fx, fy], "grow": px}` for an element, `{"lnglat": [lon, lat]}` for a map point, `{"cx", "cy", "z"}` for a camera view.

Scene helpers in the storyboard: `step(f, n, title, colour)` (chapter tag + whoosh), `hint(f, icon, head, body, colour)` (chip + blip), `spot/unspot`, `range_at` / `weight_at` (exact points on sliders), `open_menu_and_pick(f, name)`.

### 8.4 A scene

```python
dict(id="timeline", title="Play the timeline", run=timeline,
     shows="Play, speed, pause, dragging the slider, clicking an event marker.",
     camera="Zoomed on the timeline; full-frame for the event.",
     motion="Real clicks and a slider drag.",
     sound="Clicks.",
     lines={"time-1": "History layers play on the timeline. Click play, or press the space bar.",
            "time-2": "Use Speed to choose how many years pass each second."})
```

`run(f)` pattern: `step(...)` → `f.say(line)` → spotlight/hint → real moves and clicks → `f.board(...)` → `f.voice_done()` → next line.

### 8.5 Standard storyboard (adapt names)

| # | Scene | What happens |
|---|---|---|
| – | Intro | Black; title "How to use {Atlas}" rises; fade up on the app at HOME. Glassy note, music pad fades in. |
| 1 | Find your way around | Cursor touches a few place dots; spotlight walks: Layer button → top-right buttons → side panel → timeline. |
| 2 | Move the map | Drag, scroll-zoom, right-drag tilt/turn, zoom onto the map buttons (chips for each gesture). |
| 3 | Show a data layer | Zoom onto the menu; open Layer (or `L`); explain groups; pick the headline layer; panel updates. |
| 4 | Play the timeline | Play, change speed, pause, drag the slider, click an event diamond → map jumps, the event's panel opens. |
| 5 | Switch, combine and clear | Flip a second layer's switch on (it joins the map); click its name (it becomes active, the first stays on); point at the `+1`; click "Clear the map". |
| 6 | Open a place's report | Hover a dot (name), click; map flies; scroll the report; close. |
| 7 | Rank places with the Finder | Open; drag one slider (ranking updates); click a preset; point at the columns; open a place; close twice. |
| 8 | Deep finder (if any) | Filters, the count, a slider, presets, open an item, shortlist, satellite, back, Shortlist tab, close. |
| 9 | See where the data comes from | Open sources; hover a source; "See it on the map". |
| 10 | Keyboard shortcuts | A chip for each key as it's pressed: L, Space, arrows, P, S, Esc. |
| – | End card | Window drifts back to rest; fade; soft impact; end card with tagline + address; "That's everything you need. Enjoy exploring."; blackout. |

Give each step its own colour (tour cyan `#4cc9f0`, map `#8fdcff`, layer = the layer's colour, place green `#3ecf8e`, finder violet `#a99bff`, deep finder teal `#5eead4`, sources cedar `#d8a06a`, keys amber `#ffb35c`). `STEPS` = the number of numbered scenes.

**Supplemental films** for big features (`video/storyboard_<film>.py`, `--film <film>`): same voice and style, line ids prefixed (e.g. `tw-`) so cached narration never clashes, 5–8 steps on just that feature and where it appears elsewhere (reports, finders).

**A film per layer, and an overview** (`video/storyboard_layers.py`, `--film layer-<id>`, `--film overview`, `--film all`):

- **Layer film** (about a minute): title with a one-line hook → open the Layer menu and click the layer's name → three headline numbers count up while the narration says them → one or two **wow scenes**, the thing only this layer can show (a century played in seconds with a slow orbit; a tilt that reveals depth; an event marker clicked; chips that reshape the map) → zoom on the side panel → end card pointing to the overview.
- **Overview**: title → how the menu and timeline work → a few seconds per layer (its own moment, with a chip naming its film) → places and the finders → end card: "every layer has its own film".
- **Nothing hard-coded about the layer list.** A facts script (`video/layer_facts.js`) runs in the app before filming: it computes the narration's numbers and draws every layer's panel off-screen to read its name, headline, first sentence, four headline numbers and timeline events. The overview and `--film all` are built from that list, and a layer with no hand-written spec gets a generic film and overview moment from it. So a layer added later appears in the overview and gets a film with no film code; write a spec to give it a real hook and wow scene.
- Narration numbers come from the data or the panel's own headline numbers, so the voice never disagrees with the screen. Counters only take whole numbers; say decimals in the narration instead.
- During playback at a year a second or faster, hide the event ticker so it doesn't flicker through every event crossed; keep it for slow playback through a single event. After clicking a marker in a film, tap Back before reading the layer's own panel.
- `video/films.json` maps film names to their published links; every description links to the overview and the overview lists every layer film.

### 8.6 Sound and voice

- **Voice**: Kokoro (`kokoro-onnx`) running locally, voice `af_heart`, speed 0.98. `spoken()` rewrites symbols for speech ("3D" → "three-D", "→" → "to"); a `SOUNDS` dict fixes mispronunciations at the phoneme level. Each line is cached by text hash in `video/out/vo/` and regenerated only when its text changes. A real recording at `video/out/vo/recorded/<line-id>.wav` replaces it and the picture retimes to fit.
- **Sound effects** (synthesized in `sfx.py`, no samples): `click`, `whoosh` (panned), `riser`, `impact`, `blip(note)`.
- **Music**: a synthesized ambient pad bed with reverb that **ducks under the voice**, fading in at the intro and out at the end.

### 8.7 Outputs (`video/out/`)

`<name>.mp4` (1440p, x264 slow CRF 17, BT.709 tagged), `<name>-1080p.mp4`, `storyboard.html` (every board frame with scene title, shows/camera/motion/sound, narration), `script.md` (line ids + text), `.srt` captions, `youtube.txt` (title, description with chapters timestamps and a link to the live site).

Commands:

```bash
.venv/Scripts/python.exe video/render.py --storyboard   # storyboard page, script, captions, YouTube text
.venv/Scripts/python.exe video/render.py --preview      # quick 960×540 cut with sound
.venv/Scripts/python.exe video/render.py                # 1440p master + 1080p copy
```

Options: `--only <scene ids>`, `--start <scene>`, `--stills 10,60`, `--url`, `--no-build`, `--video-only`, `--film <name>`. The renderer builds the app, serves `dist/` locally, opens the stage in Edge, and fails if the page logs errors.

---

## Part 9 – Build order for Claude

Do one milestone at a time; each ends with `npm run build` passing and the app checked in the browser.

1. **Scaffold**: Vite + TS, `index.html` shell, `style.css` tokens and components (Part 4), map with basemap, hillshade, outline glow, loader and intro flight. Empty layer menu with "Just the region" (becomes "Clear the map" once anything is on). Place dots with tooltips.
2. **Pipeline skeleton**: `fetch-data.mjs` helpers, `base` and `places` stages, manifest. Prove from an empty cache.
3. **First time layer** end to end: stage → JSON → `AtlasLayer` (map, sparkline, panel with chart + playhead, tooltip) → timeline play/scrub/speed/keys.
4. **Events**: curated + data-driven, diamonds, the ticker, beacons, and the event panel.
5. **Remaining layers** from the brief, one per step; static-layer support when the first static one arrives; the on-the-map vs. active rules of §5.3 and `+N`.
6. **Place Report** (metrics) → **Place Finder** (criteria, ranking, presets, columns, localStorage).
7. **Data & sources** view with the chosen metaphor.
8. **Deep finder** (if in the brief).
9. **Security and deploy**: `esc`/`safeUrl` audit, CSP plugin, Pages workflow, dev container.
10. **README** (features table, tech, getting started, refreshing data, deploying, the video, data sources table, caveats) and **ROADMAP** (suggested build order table with effort, ✅ for built items, *(verify)* on unconfirmed sources, "Still open" lists).
11. **Explainer film**: stage, `vt.js`, `render.py`, `sfx.py`, `storyboard.py` with the standard scenes; render `--storyboard`, then `--preview`, then the 1440p master.

## Part 10 – Done checklist

- [ ] Opens on just the region; intro flight; no console errors.
- [ ] Every layer has map visuals, a sparkline (or static note), a full panel with a source line, and tooltips.
- [ ] Projections and estimates are visibly marked; ranges shown for model output.
- [ ] Place Report covers every layer that has a per-place meaning; Finder ranks with percentile scoring and saves weights.
- [ ] Sources view counts records from the loaded data and shows pipeline status.
- [ ] `rm -rf .cache && npm run data` works with no manual steps; a broken source doesn't break the rest.
- [ ] All outside text escaped; CSP present in the build; deploy workflow least-privilege.
- [ ] Usable at phone width (panel docks above the timeline).
- [ ] Layer menu: a switch only turns a layer on or off; a name click makes it active without turning others off; switching off the active layer drops its timeline; "Just the region" is never highlighted while a layer is on; overlay features are clickable.
- [ ] Film renders at 1440p + 1080p with storyboard, script, captions and YouTube text; narration only says where to click.
