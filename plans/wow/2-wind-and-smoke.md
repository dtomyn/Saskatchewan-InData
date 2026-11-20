# 2. Wind and smoke in motion

**Effort:** M. **Depends on:** nothing built; reuses the hourly run. **Status:** ✅ built (`now-wind`, `now-plume`, `src/particles.ts`, `src/wind.ts`). See *As built* at the end.

## Goal

On Smoke & air (and Wildfires at Now), show the air moving: particles streaming with the current wind, and the wildfire smoke forecast drifting across the province over the next 72 hours. Today the atlas has one smoke number per place for tomorrow (`now-outlooks`).

## What a visitor sees

- A **Wind** chip: a few thousand short trails flowing with the surface wind, faster and brighter where it is stronger. Hotspots sit under them, so it is plain where smoke would go.
- A **Smoke forecast** chip: the forecast plume as a soft brown tint, with a small scrubber (now → +72 h) that plays by itself.
- A Right now block with the model run time and the hour shown.

## Sources

| What | Feed | Status |
|---|---|---|
| Surface wind (10 m) | ECCC RDPS on MSC GeoMet's WCS (`geo.weather.gc.ca/geomet`), `RDPS_10km_WindSpeed_10m` and `RDPS_10km_WindDir_10m` | ✅ confirmed: GeoMet has no surface u and v layers, so speed and direction are read and u and v worked out; `FORMAT=image/tiff` answers an uncompressed 32-bit float GeoTIFF, read by `scripts/lib/tiff.mjs` |
| Smoke plume, hourly, 72 h | `RAQDPS.Sfc_PM2.5-WildfireSmokePlume` on the same WCS | ✅ confirmed: one request returns the province's grid for one hour (kg/m³), so a run is 25 small requests at most |

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

## As built

- **Wind model:** RDPS, the current forecast hour only (one frame, 17 KB). A forecast wind sharing the plume's scrubber is not built.
- **Grid:** 0.25° nodes from 112° W, 47.5° N (51 × 57), a margin around the province so wind and smoke are seen arriving.
- **Frames:** from the hour now is in, every third hour to the end of the newest run, so 25 right after a run and fewer as it ages (a new run every 12 hours).
- **Where:** both chips sit at the top of the Smoke & air and Wildfires panels and draw at the timeline's Now stop; turning one on from elsewhere on the timeline goes to Now.
- **Dropping:** the wind is not drawn once its hour is 3 hours past; a smoke frame is dropped once the next one's time has passed; neither is drawn when the file is more than 24 hours old.
- **The check against `outlooks.json`** cannot be made as written: the outlooks hold the day's highest value (the `-DMax` layer), not an hour's. The grid was checked instead against GeoMet's own point query (GetFeatureInfo) on the hourly layer for the same hour and run (3.24 µg/m³ in the file, 3.33 from the query).
- **Frame rate:** moving 3,000 particles costs about 1.4 ms a frame on the build machine. The browser pane used for checking caps at 30 frames a second with or without the layer, so 50 frames a second was not measured there.
