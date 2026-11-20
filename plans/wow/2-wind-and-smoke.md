# 2. Wind and smoke in motion

**Effort:** M. **Depends on:** nothing built; reuses the hourly run. **Status:** not started.

## Goal

On Smoke & air (and Wildfires at Now), show the air moving: particles streaming with the current wind, and the wildfire smoke forecast drifting across the province over the next 72 hours. Today the atlas has one smoke number per place for tomorrow (`now-outlooks`).

## What a visitor sees

- A **Wind** chip: a few thousand short trails flowing with the surface wind, faster and brighter where it is stronger. Hotspots sit under them, so it is plain where smoke would go.
- A **Smoke forecast** chip: the forecast plume as a soft brown tint, with a small scrubber (now → +72 h) that plays by itself.
- A Right now block with the model run time and the hour shown.

## Sources

| What | Feed | Status |
|---|---|---|
| Surface wind (10 m, u and v) | ECCC HRDPS or RDPS on MSC GeoMet, as a coverage (`geo.weather.gc.ca/geomet`, WCS) or from the Datamart GRIB2 files | *(verify)*: the `projections` stage already reads a GeoMet coverage, so the route is known; the layer names and a script-readable format for wind are not confirmed |
| Smoke plume, hourly, 72 h | RAQDPS-FW (FireWork) surface PM2.5 from wildfires on GeoMet | *(verify)*: `now-outlooks` reads the daily-maximum layer one point at a time; an hourly grid for the province in one request is not confirmed |

Licence for both: ECCC Data Servers End-use Licence, already used by the outlooks.

## Pipeline

1. Stage `now-wind`: one request for u and v over the province's box on a coarse grid (about 0.25°, roughly 50 × 45 cells), written to `public/data/now/wind.json` as two quantised arrays with the run and valid times. Target under 30 KB.
2. Stage `now-plume`: the smoke grid for every third hour to +72 h (25 frames) on the same grid, quantised to a byte and run-length encoded (most of it is zero). Target under 150 KB. If one request cannot return a grid, fall back to fewer frames, never to a picture of a map.
3. Both join `NOW_STAGES` and the workflows' restore lists.

## App

1. A particle layer (`src/particles.ts`): positions advected on the CPU from the grid each frame and drawn as a deck.gl `PathLayer` of short trails, about 3,000 particles. It must stop when the layer is off, the tab is hidden, or the visitor prefers reduced motion (then draw static arrows).
2. The plume as a `BitmapLayer` built on a canvas per frame, as the live aurora does (plan 1).
3. `?film`: off, like every live reading.

## Honest labelling

- Both are **model forecasts**, shown with the run time and valid time and dropped once the last valid time passes.
- The wind is as fresh as the hourly run, and the particles are an illustration of its direction and speed, not a count of anything.
- Forecast smoke is PM2.5 from fires only, not the AQHI and not a smoke-day count; never chart them together.
- Neither feeds the Town Finder.

## Done when

- `npm run data now` writes `wind.json` and `plume.json`, and a failed part keeps its last file.
- `atlas.focus('smoke')` then the Wind chip shows moving trails at 50 frames a second or better on a laptop; the tab's CPU falls to idle when the layer is turned off.
- The Smoke forecast scrubber's last frame matches the per-place values in `outlooks.json` for the same hour.
- With reduced motion set, arrows are drawn and nothing animates.

## To confirm before building

- Which model for wind: HRDPS (2.5 km, 48 h) or RDPS (10 km, 84 h). RDPS is enough for a province-wide picture and matches the plume's 72 hours.
- Whether a forecast wind (a scrubber shared with the plume) is wanted, or only the current hour.
