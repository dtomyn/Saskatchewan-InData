# 1. Live aurora and the night line

**Effort:** S. **Depends on:** the hourly run (digital-twin plan 1). **Status:** ✅ built (2026-11-20); what was built is under **Built** at the end.

## Goal

Light & dark says how often the aurora comes overhead, from latitude alone. Add what the sky is doing **now**: NOAA's forecast of the auroral oval for the coming hour as a green glow on the map, and the edge of night crossing the province.

## What a visitor sees

- A fifth chip on Light & dark, **● Sky now**.
- The map darkens where it is night, with thin sunrise and sunset lines that move as the minutes pass.
- The auroral oval glows green. On a quiet night it lies over the territories, so zooming out shows it hanging north of the province; in a storm it comes down over the towns.
- Each labelled place shows NOAA's chance of aurora overhead and whether it is dark there.
- A Right now block: the highest chance among the places, the time the forecast is for, how old the measurement behind it is, the planetary Kp, and how many places are in darkness.
- In every Town Report's Right now group: "Aurora overhead".

## Source

Checked on 2026-11-20.

| What | Feed | Status |
|---|---|---|
| Chance of aurora overhead | NOAA Space Weather Prediction Center, OVATION: `services.swpc.noaa.gov/json/ovation_aurora_latest.json`. A 1° grid of the globe (65,160 points, `[longitude 0–359, latitude, 0–100]`), with an Observation Time (when the solar wind was measured upstream of Earth) and a Forecast Time 30 to 90 minutes later. Re-run every few minutes; about 900 KB | Works |
| Planetary Kp | `services.swpc.noaa.gov/products/noaa-planetary-k-index.json`: the observed 3-hour index | Works |
| The edge of night | Computed in the browser from the clock (the Astronomical Almanac's low-precision solar position, about 0.01°) | No feed |

Licence: a U.S. Government work, in the public domain. Both feeds send `Access-Control-Allow-Origin: *`, so the browser could read them directly; they go through a stage anyway, as every live reading does (plan 1 of the digital twin explains why).

## Pipeline

1. Stage `now-aurora`, in `NOW_STAGES`: keep a window over western Canada (125–85° W, 44–75° N: 41 × 32 values, about 3 KB), wide enough to show the oval north of the province. Write `public/data/now/aurora.json` with `observed`, `valid`, the grid and the Kp.
2. The stage fails (and so keeps the last file) if the grid is not the expected one or has holes over the window. The Kp part is left out when it fails, never zero.
3. Add `aurora` to the list of files `live.yml` and `deploy.yml` restore before they run.

## App

1. `src/sky.ts`: the sun's position and altitude, the sunrise and sunset lines, sampling the grid between its points, and one picture of the sky (night's shade plus the aurora) built for a `BitmapLayer`, its rows spaced in Web Mercator.
2. `src/light.ts`: the chip, the drawing (the picture, the two lines, place dots and labels), the Right now block in place of the legend, a tooltip that reads the sun and the chance at the cursor. Repainted once a minute.
3. `src/now.ts`: the Town Report cell.
4. `src/sources-catalog.ts`: an entry under Right now.

## Honest labelling

- It is **a model's short forecast, not a sighting**: say so wherever a number appears, with the time it is for and the age of the solar wind reading.
- It is the chance of aurora **overhead**. A display can be seen low in the north from hundreds of kilometres south of the green: the note says so, so that a low number in Regina is not read as "nothing to see".
- The run is hourly and the oval moves within minutes. The forecast is not drawn once the time it was made for is **3 hours** past (stricter than the usual 24), and the block then says why.
- Where the sun is up or the sky is in twilight the aurora cannot be seen: it is drawn at a third of its strength there.
- Clouds, the moon and city lights are not in it.
- The edge of night is computed, not read, and is drawn even when there is no aurora file.
- Never in the Town Finder, and not rolled into the daily record.

## Film and docs

- With `?film` the chip is hidden (no live readings in the film); `?film&now` shows it.
- Updated: `README.md`, `MAP-ATLAS-BLUEPRINT.md` (5.9, the layer table), `CLAUDE.md`, `ROADMAP.md`, and the intent "Know the climate and the light".

## Done when

- `npm run data now-aurora` writes `now/aurora.json` and `npm run build` passes.
- On `/?film&now`: `atlas.focus('light')`, the Sky now chip, then zooming out shows the oval, the night shade and a Right now block with an age.
- A Town Report's Right now group has an "Aurora overhead" cell.
- Without `now/aurora.json` the chip still draws night's edge and the block is the dashed box; with `?film` there is no chip.

## Built

As planned. Differences and details:

- The chance is painted by its square root, eased in under 3 %, so a quiet night's few percent show without the feed's whole-number steps drawing as blocks. The legend's ramp uses the same curve.
- The picture fades out over the window's last 4°, so it has no hard edge on the map.
- The places' values are sampled in the browser (`auroraAt`), not written by the stage, so the tooltip, the labels and the Town Report all read one grid.
- The layer still opens on Dec 21: Sky now is a chip the visitor picks.

Added after a second look (2026-11-20):

- **The camera frames the sky.** Picking the chip pulls back to the province with the territories north of it, so a quiet night shows the oval instead of an empty province.
- **Tonight's outlook.** The stage also keeps NOAA's predicted Kp (`noaa-planetary-k-index-forecast.json`, the windows of the next 36 hours). The block shows the highest one in the coming dark hours and, by the same Kp rule as the Aurora chip, how many places the oval would then reach. A quiet moment still says what the night may bring. It is a forecast read against a rule of thumb, labelled as an outlook.
- **Small communities** get an "Aurora overhead now" cell (`auroraCell`), sampled from the same grid.
- **A Sky now link** in the Town Report and the small-community report opens Light & dark on the chip.
- **Checked on the production build** (`living-skies-built`, with the CSP): the picture is built in the page from the JSON, so nothing new is fetched and the CSP needs no change.

Left as they are, on purpose:

- **The three-hour limit.** It follows from an hourly run and an oval that moves in minutes. Only reading the feed in the browser would shorten it (next list).
- **Hidden with `?film`.** The film loads no live readings so that it renders the same every time; a live sky cannot be in it.

Not done, and worth doing next:

- **Clouds**: ECCC's cloud-cover forecast on GeoMet *(verify)* would turn "chance overhead" into "chance you can see it".
- **Reading in the browser**: the feed allows it, and it would make the oval minutes old instead of up to an hour. It would be the first reading not to come through a stage; decide that for all live readings together.
- **The explainer film** does not show it (the film loads no live readings).
