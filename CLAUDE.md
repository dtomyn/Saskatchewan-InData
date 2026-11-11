# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Living Skies Atlas: a static, no-backend Vite + TypeScript web app that maps Saskatchewan's safety, justice and land in open data on a 3D map (MapLibre basemap + deck.gl layers + d3 charts). It is the Saskatchewan sibling of Island Atlas (`C:\HouseShopping-VancouverIsland`) and keeps its framework, look and conventions; `MAP-ATLAS-BLUEPRINT.md` describes them, with this atlas's brief filled in as Part 1.

## Commands

```bash
npm run dev               # http://localhost:5173 (.claude/launch.json: "living-skies")
npm run build             # tsc --noEmit + vite build: the only automated check (no tests, no linter)
npm run data [stage…]     # rebuild public/data/*.json from the original sources
```

Data stages (in run order): `province places fires tornadoes rivers climate normals population crime treaties justice hospitals`. `places` writes `municipalities.json`, which `justice` and `hospitals` read. Raw downloads cache in `.cache/`; a failing stage keeps its old JSON and records the error in `public/data/manifest.json`. `public/data/` is committed.

## Rules for this repo

- All data comes from `npm run data` stages, never hand-edited JSON. The only hand-typed data is the place-name list in `scripts/places.mjs` and the curated events in `src/layers.ts` (`CURATED_EVENTS`, well-documented facts only, each with a source link).
- Anything from outside the code (OSM names, data strings) goes through `esc()` / `safeUrl()` in `src/html.ts` before `innerHTML`. The production build ships a CSP (`vite.config.ts`).
- Say when a value is inferred or borrowed: the in-town police rule (`nearestJustice` in `src/justice.ts`), borrowed climate stations, rural RCMP detachments standing in for a town.
- When you change a behaviour the blueprint describes (layer menu rules, event panels), update `MAP-ATLAS-BLUEPRINT.md` and the README with it.

## Architecture

Same shape as Island Atlas:

- **`src/main.ts`** owns state (`visible`, `focused` — `'province'` means none active — `timeLayer`, `mode: layer | town | finder | event`), the frame loop, the layer menu (`setLayerOn`, `focus`, `clearMap`), click routing and the timeline. `?film` exposes `window.atlas`.
- **`src/layers.ts`**: the `AtlasLayer` contract, shared helpers (exported for the layer modules), and the fires, rivers, climate, normals, population, crime and hospitals layers, `CURATED_EVENTS`, the base `province` layer and `buildLayers()`.
- **`src/justice.ts`** (Courts & police), **`src/treaties.ts`** (Treaties & reserves), **`src/tornado.ts`** (Tornadoes): one layer each.
- **`src/metrics.ts`**: `townMetrics(data)` per place and the Town Finder `CRITERIA` / `rankTowns`. **`src/panels.ts`**: Town Report and Town Finder. **`src/sources.ts`**: the Data & sources view. **`src/events.ts`**: the event/feature panel.
- **`src/data.ts`**: `loadAll()`, the JSON types, formatters.
- **`scripts/fetch-data.mjs`**: one async function per stage in `SOURCES`; helpers for caching, OGC API, ArcGIS REST, Overpass (with mirrors) and OSRM drive times (`driveTimes`).

## Data notes

- Crime: each place takes one police service's series (its own municipal one while current, otherwise the rural RCMP detachment of the same name); series are never spliced.
- Fires: CNFDB cause codes are `N` (natural/lightning), `H` (human), `H-PB` and `RE` (dropped), `U`.
- Overpass is often at capacity; the client retries across mirrors and caches only complete JSON.

## Verifying in the browser

Load `/?film`, wait for the map, then e.g. `atlas.clearMap(); atlas.focus('crime'); atlas.setTime(2024.5)` or `atlas.openTown('north battleford')`. When the browser pane is hidden the map's frame loop is throttled; take a screenshot before trusting a visual check.
