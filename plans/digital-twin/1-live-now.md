# 1. A "now" on the layers the atlas already has

**Effort:** M for rivers, fires, air and alerts together. **Depends on:** nothing. **Unlocks:** plans 2 and 3.

## Goal

Rivers, wildfires and smoke each end at their archive's last year. Give each a **Now** reading that refreshes by itself about once an hour, and say how old every reading is.

## How it stays a static site

A scheduled GitHub Actions run rebuilds a small set of live stages, builds the site and deploys it to Pages. Nothing is committed and there is still no backend.

This keeps the rule that all data comes from `npm run data` stages. It also means a feed that is down keeps its last file and records the error in `manifest.json`, as every other stage does.

Fetching in the browser instead is possible (the CSP already allows `connect-src https:` and the feeds below send `Access-Control-Allow-Origin: *`), but it would break that rule and copy the clipping and borrowing logic into the app. Leave it for later, if hourly turns out too slow.

## Feeds

Checked on 2026-11-13 unless marked *(verify)*.

| Layer | Feed | What it gives | Status |
|---|---|---|---|
| River floods | `api.weather.gc.ca/collections/hydrometric-realtime` (`PROV_TERR_STATE_LOC=SK`) | Level and discharge every few minutes per station, with ice and estimate symbols | Works |
| Wildfires | CWFIS GeoServer WFS `public:hotspots_last24hrs` | Satellite heat detections: position, time, sensor, fire radiative power, agency | Works |
| Wildfires | CWFIS `public:m3_polygons_current` | Perimeters estimated from hotspots | Layer listed; content *(verify)* |
| Wildfires | Agency-reported active fires (CIFFC or the Saskatchewan Public Safety Agency) | Fires with a name, size and status | *(verify)*: CWFIS's `activefires.csv` answers 404 |
| Smoke & air | `aqhi-observations-realtime`, `aqhi-forecasts-realtime` | Hourly AQHI per community, and the forecast | Works |
| Smoke & air | ECCC FireWork smoke forecast (GeoMet WMS) | PM2.5 from wildfire smoke, next 72 h | *(verify)*: only retrospective `RAQDPS-FW.CE_*` layers found |
| All hazard layers | `api.weather.gc.ca/collections/weather-alerts` | Alert polygons with code, type, times and text | Works |
| Drinking water | Already fetched per day by the `water` stage | Advisories in effect | Add to the scheduled run |
| Getting around | Highway Hotline road conditions | Road closures and conditions | *(verify)*: the map page shows no open feed |
| Getting around | GTFS-realtime for Regina and Saskatoon | Vehicle positions, service alerts | *(verify)*: no URL confirmed |

Build the four that work first. Park the rest in `ROADMAP.md` under "Still open".

## Pipeline

1. Add stages `now-rivers`, `now-fires`, `now-air` and `now-alerts` to `SOURCES`, writing `public/data/now/<name>.json`. Make `npm run data now` run all four.
2. Each file carries `asOf` (the newest reading's time), `fetched`, `source` and the licence, plus compact rows:
   - `now-rivers`: for the 285 stations in `rivers.json`, the latest level and discharge, its time, and its symbol (ice, estimated). Add the ratio to the station's `median` annual peak, which is the "against normal" the layer already draws.
   - `now-fires`: hotspots clipped with `inSask`, as `[lon, lat, time, frp]`, plus the estimated perimeters once verified.
   - `now-air`: latest AQHI and the forecast maximum for each Saskatchewan community, and for each of the 62 places the nearest community within 150 km (the smoke layer's borrowing rule).
   - `now-alerts`: alerts whose polygon touches the province, simplified with `polys()`, with the places inside each.
3. Do not cache live responses in `.cache/` (or cache by hour).
4. Keep `public/data/now/` out of git (`.gitignore`). A clone without it shows the usual dashed box: "run `npm run data now`".

## Workflow

Add `.github/workflows/live.yml`: `schedule` hourly plus `workflow_dispatch`, the same least-privilege shape as `deploy.yml`, running `npm ci`, `npm run data now water`, `npm run build`, then the Pages deploy. Share the `pages` concurrency group.

Two limits to design for: GitHub runs scheduled jobs late when busy, and turns schedules off in a repository with no activity for 60 days. So the app must never assume a reading is fresh.

## App

1. `src/data.ts`: types for the four files, loaded in `loadAll()` and `null` when absent.
2. `AtlasLayer` gains an optional `now?: { asOf: () => number | null; build: (ctx) => Layer[] }`. A layer with one extends its `range` to today.
3. Timeline: a **Now** stop at the right end. Focusing a time layer already jumps to `range[1]`, so it lands on Now. The span between the archive's last year and today is hatched ("no record yet") until plan 2 fills it.
4. Panels (`src/layers.ts` rivers and fires, `src/smoke.ts`): a "Right now" block above the story with the reading, its age in plain words ("40 minutes ago"), and the source line.
5. Town Report: a "Right now" row group: river nearest the town, hotspots within 50 km, AQHI, alerts in effect.
6. Data & sources view: the live stages show their `updated` time from the manifest like any other.

## Honest labelling

- Every live value shows its age. Older than 3 hours is greyed and labelled "stale"; older than 24 hours is not drawn.
- Hotspots are heat seen from a satellite, not confirmed fires: they include flares and farm burning. Say so in the lede.
- Hotspot perimeters are estimates, drawn dashed.
- A river reading marked ice-affected or estimated is flagged. Many gauges are seasonal and silent in winter: show "no reading", not zero.
- AQHI is an index of three pollutants, not the PM2.5 smoke-day count: do not mix them in one chart.
- AQHI for a place is borrowed from the nearest community: say which.
- Live readings never feed the Town Finder (point-in-time, as with drinking water).
- Alert text comes from outside the code: `esc()` it.

## Film and docs

- With `?film`, do not load `now/` so the film stays repeatable.
- Update `MAP-ATLAS-BLUEPRINT.md` (layer contract, timeline, pipeline, deployment), `README.md` (what's on the map, refreshing the data, caveats), `CLAUDE.md` (stages, data notes) and the intents "Understand natural hazards" and "Check where the data comes from".

## Done when

- `npm run data now` writes four files and `npm run build` passes.
- `atlas.clearMap(); atlas.focus('rivers')` lands on Now and the panel shows a reading with its age.
- Editing a file's `asOf` to yesterday greys it; removing `public/data/now/` shows the dashed box and no errors in the console.
- The hourly workflow has deployed three times in a row without a hand.

## Built

Built as planned, with the recommended choices: `public/data/now/` is not committed, and the schedule is hourly (`17 * * * *`). Differences: the live stages keep their own `now/manifest.json`, so running them changes no committed file; both workflows first download the `now/` files the site is serving, so a failed feed keeps its last file in CI too; `deploy.yml` also runs `npm run data now`; `?film&now` loads the live files for checking by hand; estimated perimeters are kept while heat was seen within 7 days (the layer holds the whole season); hotspots and alerts take `asOf` from when the list was read. The four *(verify)* feeds are parked in `ROADMAP.md`.

## To confirm before building

- Not committing `public/data/now/` (recommended) versus committing it like the rest of `public/data/`.
- Hourly schedule (recommended) versus every 3 hours.
