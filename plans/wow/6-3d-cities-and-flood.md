# 6. 3D cities with flood water

**Effort:** L. **Depends on:** the tiles decision in [`digital-twin/4-physical-systems.md`](../digital-twin/4-physical-systems.md) (4e buildings, 4f terrain, both held back there) and the flood-prone land (3d, built). **Status:** ✅ built (2026-11-20). What was found and decided is under **Outcome** at the end.

## Goal

Zoom into Regina or Saskatoon and see a city: buildings standing on real terrain, the river valley cut into it, and the Water Security Agency's 1-in-500-year flood lying against the streets it would reach.

## What a visitor sees

- Past zoom 12 in the two cities (and any community with a WSA flood map), buildings rise as plain extruded blocks.
- With River floods on, the mapped flood extent is a sheet of water; buildings whose footprint touches it are tinted, and the panel counts them.
- With terrain on, the South Saskatchewan and Wascana valleys, the Qu'Appelle and the Cypress Hills have shape, and the camera can tilt along them.

## Sources

| What | Source | Status |
|---|---|---|
| Building footprints | Statistics Canada's Open Database of Buildings (municipal footprints, OGL – Canada) | *(verify)* which Saskatchewan municipalities it holds, and whether any carry heights |
| Building footprints, everywhere else | Microsoft's Canadian Building Footprints (machine-drawn) | *(verify)* licence (ODbL, which the atlas already carries for OSM) |
| Heights | OSM `building:levels` / `height` where tagged | Sparse: most buildings will have none |
| Flood extent | WSA `1_500yr_Flood` and `Flood_Hazard_All` | Built (`floods` stage) |
| Terrain | The elevation tiles the relief shading already uses | Built; as 3D terrain *(verify)* with deck.gl's interleaved layers |

## How it stays inside GitHub Pages

- Buildings go in one **PMTiles** file per city, read with HTTP range requests (Pages serves them). No server.
- Limits: 100 MB a file, 1 GB a site. Keep footprints for the places with a flood map plus the two cities, simplify to zoom 12–15, and measure before committing: the target is under 40 MB in all.
- The file is built by a stage (`buildings`) and, being large and rarely changing, kept out of the main JSON load. Decide whether it is committed (Git LFS is not served by Pages) or attached to a release and fetched by `deploy.yml`.

## App

1. A PMTiles source in MapLibre with a `fill-extrusion` layer (simplest, and it sits correctly on MapLibre terrain), or deck.gl's `MVTLayer` if the flood tint needs per-building data the style cannot express.
2. The flood flag computed in the stage (footprint intersects the mapped extent) and stored as a tile attribute, so the app does no geometry.
3. Terrain as a toggle, off by default, since most of the province is flat and it costs frame rate.
4. A step back if deck.gl layers float above or sink into the terrain: keep terrain to the cities' close-up and leave province-wide layers flat.

## Honest labelling

- A building with no height in the source is drawn at one nominal storey and the panel says so: the skyline is not measured.
- "Touches the mapped 1-in-500-year extent" is not "will flood": floors, basements and defences are not in the data, and communities without a WSA map are unmapped, not safe.
- The count of touched buildings is the atlas's own working, so it goes in `DERIVED` in the sources catalogue, and never in the Finder.

## Done when

- The site stays under Pages' limits, and the first load of the app is no heavier (the tiles load only past zoom 12).
- Saskatoon at zoom 14 holds 30 frames a second or better on a laptop with buildings and the flood sheet on.
- The panel's count of buildings in the mapped extent matches a count made in the stage.
- Province-wide layers still draw correctly with terrain on, or terrain is limited as in step 4.

## To confirm before building

- PMTiles as the tile format (recommended in plan 4), and where the file lives (committed, or a release asset).
- Footprints from ODB only (official, fewer places) or Microsoft's too (everywhere, machine-drawn).
- Whether terrain is worth it at all once tried: it may only earn its place in two or three valleys.

## Outcome

- **Footprints: Microsoft's only.** Its Saskatchewan file (681,553 footprints, 22 MB zipped, ODbL) is one feature a line, so the stage streams it. Statistics Canada's ODB pages and downloads now sit behind a browser check that refuses scripted requests, so which Saskatchewan cities it holds, and whether any carry heights, is still *(verify)*; it would replace Microsoft's in the cities if it can be fetched.
- **Kept:** footprints whose centre falls in a box around each of the 22 flood-mapped communities' extents and town limits, Regina and Saskatoon among them (1 km padding; "Saskatoon South" joins Saskatoon, Battleford and North Battleford are "Battlefords"): 234,307 buildings.
- **Heights:** OpenStreetMap ways and relations with `height` or `building:levels` (3 m a storey), matched to the footprint under their centre: 4,176, mostly in Regina. Everything else stands one nominal storey (3.5 m), and the panel says so.
- **The flag** is worked out on the WSA's unsimplified outlines: 1 the footprint touches the floodway, 2 the rest of the 1:500-year extent, 3 only land protected by dikes (Lumsden). 219, 5,277 and 425 buildings. The same outlines ride in the tiles as the water sheet, so the tint and the water agree; River floods' own simplified polygons go transparent past zoom 12 (still clickable).
- **Tiles:** one PMTiles file, not one per city (fewer requests, one header). Zoom 12–15; at 12 only footprints of 250 m² or more. A small PMTiles v3 writer in `scripts/lib/pmtiles.mjs` (tiles cut with `geojson-vt`, encoded with `vt-pbf`), so the stage runs locally with npm packages only. **13.6 MB**, committed under `public/data/tiles/` (well under the 40 MB budget and Git's 100 MB). The stage throws over 40 MB.
- **Range requests:** served by Vite's dev server and `vite preview`; GitHub Pages serves them too (the PMTiles docs use it). The source lists tile URLs rather than a TileJSON, and the PMTiles reader is imported with the first tile, so the first load fetches no tile and gains under 2 KB gzipped of code (plus `buildings.json`, 3 KB).
- **App:** MapLibre `fill-extrusion` (step 1's simple option: the flag is a tile attribute, so the style expresses the tint). Gauge columns are hidden from zoom 11: in a city close-up the camera sits inside one.
- **Terrain (step 4 taken):** deck.gl's interleaved layers are drawn flat and slide off MapLibre's terrain (Fort Qu'Appelle's flood polygons moved off the valley at zoom 11.6), so the terrain button raises the land only from zoom 12, where the water and buildings are MapLibre's own and sit on it; turned on further out, it zooms in. Province-wide layers stay flat. It earns its place in the river valleys of the cities and the Qu'Appelle; the Cypress Hills show only in close-up.
- **Checks:** the counts decoded from every zoom-15 tile equal the stage's (234,307; 219 / 5,277 / 425). Saskatoon at zoom 14, pitched, held the browser pane's 30 fps cap with buildings and water on (the pane was hidden, which caps it, so the true ceiling was not measured). The production build loads the tiles under its CSP.
