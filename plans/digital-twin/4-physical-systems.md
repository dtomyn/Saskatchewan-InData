# 4. Physical systems: the land and what is built on it

> **Status (2026-11-13):** 4a, 4b and 4c are built. 4d is skipped (traffic counts are not open data), 4e and 4f are held back. What was found and decided is under **Outcome** at the end.

**Effort:** M each for fire perimeters and crops, M for the power grid, L for buildings. **Depends on:** nothing, but a decision on tiles (below) comes first for anything large.

## Goal

A twin represents physical things, not only statistics about places. The atlas already has some: the province outline, relief shading from open terrain tiles, park outlines, reserves, wells, pipelines, mines, airports, transit routes. Add the ones that change what a visitor can learn, in this order.

## 4a. Real fire perimeters (M)

`fires.json` has an empty `perimeters` array, and fire scars are drawn as circles of the right area.

- Source: the National Burned Area Composite, listed on CWFIS's GeoServer as `public:nbac`. *(verify)* years covered, licence and size for Saskatchewan.
- `fires` stage: fetch Saskatchewan's polygons, simplify with `polys()`, fill `perimeters` as `[year, hectares, polys]`.
- Layer: draw the perimeter where one exists, the circle where none does, and say which in the tooltip.
- This also gives plan 1's live hotspots something to be compared with.

## 4b. What grows here (M)

A new time layer from AAFC's Annual Crop Inventory: a 30 m map of crop and land cover types, yearly since about 2009 on the prairies. *(verify)* the image service and that it answers raw categories the way the drought service does.

- Stage `crops`: the `drought` stage's method (`exportImage`, raw categories, a Web Mercator grid, run-length encoded), on a 1–2 km grid taking the most common class in each cell. One request per year, cached in `.cache/crops/`.
- Group the inventory's classes into about ten: cereals, canola, pulses, other crops, pasture and forage, native grassland, forest, wetland, water, built-up.
- Layer in "History on the timeline": the grid tinted by class, with a chart of each class's share by year.
- Per place: the land within 25 km by class, for the Town Report.
- Say that a cell shows its most common class, so small fields vanish.

## 4c. The power grid (M)

- Transmission lines, substations and generating stations from OpenStreetMap (`power=line`, `substation`, `plant`) through the existing `overpass` helper. Coverage is partial: say so, as the transit layer does for buses.
- Fits "Hidden neighbours" as a new chip, or its own layer in "Around the property".
- A live outage feed from SaskPower would make this the first networked system with a state. *(verify)* that one exists as data; if so it joins plan 1's live stages.

## 4d. Roads as things, not just basemap lines (M)

The basemap draws roads, and OSRM routes over them, but no road is an entity the visitor can click.

- Provincial highway segments with traffic counts, from the Ministry of Highways *(verify open data and licence)*.
- Primary weight corridors, seasonal and ice roads *(verify)*.
- Road conditions from the Highway Hotline, if plan 1 finds a feed.
- Skip this if the traffic counts are not open: a second drawing of the basemap's roads adds nothing.

## 4e. Buildings (L)

- Sources: Statistics Canada's Open Database of Buildings (municipal footprints; *(verify)* which Saskatchewan cities) or Microsoft's Canadian Building Footprints (whole province, machine-drawn; *(verify)* licence).
- Hundreds of thousands of outlines will not fit the JSON pattern. This needs tiles: see the decision below.
- Draw as extruded blocks only when zoomed into a town. Heights are mostly unknown: a flat default height must be labelled as not measured, or leave them flat.
- Value is mostly visual. Do it last, and only if tiles are adopted for another reason.

## 4f. True 3D terrain (S, optional)

The relief shading's elevation tiles can also drive MapLibre's 3D terrain. Saskatchewan is flat enough that it matters only in the Cypress Hills, the Qu'Appelle valley and the north. *(verify)* that deck.gl's interleaved layers sit correctly on terrain before spending time here.

## Decision first: tiles for big layers

Everything today is one JSON file per layer, loaded at start (`public/data/` totals about 5 MB). Buildings, and crops at a finer grid, break that.

Recommended: **PMTiles**, a single static file read with HTTP range requests. It needs no server, so the site stays static, and MapLibre and deck.gl can both read it. To settle before building 4e:

- How a stage builds one (the usual tool, tippecanoe, is not a Node package) and whether that runs locally or only in the workflow.
- Where the file lives: Git has a 100 MB per-file limit and Pages a 1 GB site limit, so a large file belongs in the Pages artifact, not the repository.
- That GitHub Pages serves range requests reliably for it.

4a to 4d do not need tiles.

## Docs and film

Each new layer follows the usual list: `MAP-ATLAS-BLUEPRINT.md` Part 1.3, `README.md` (what's on the map, data sources, caveats), `CLAUDE.md` (stage order, data notes), an intent to serve ("Understand natural hazards" for perimeters, "Check around the property" for the grid, a new "See how the land is used" for crops), and the storyboard if a filmed layer changes (the wildfire scene will).

## Outcome

- **4a, built.** NBAC on CWFIS's GeoServer is real: `public:nbac`, OGL – Canada, 3,478 Saskatchewan polygons 1972–2024 (2,155 of 200 ha or more are kept). WFS 1.0.0 with `srsName=EPSG:4326` answers lon/lat; one request a year, up to ~21 MB, cached in `.cache/nbac/`. Kept whole, the outlines were 9.4 MB, so only burns of 200 ha or more get one, simplified by Visvalingam–Whyatt (Douglas–Peucker left spikes on the pixel-stepped edges): ~1.3 MB. 3,095 start points sit inside an outline and draw no circle. The row is `[year, ha, polys, t, start points]`, not `[year, ha, polys]`: the time and the linked points are what let the layer play and drop the circles.
- **4b, built.** The inventory is one image service per year (`annual_crop_inventory/2009` … `/2025`), U8 raw codes, and answers `exportImage` like the drought service. It covers the farm belt only, to about 55–56° N. A nearest-neighbour export at 2 km would give one sample per cell, not its most common class, so the stage samples at 500 m (three strips a year, ~6 MB cached) and folds 6 × 6 into each 3 km Web Mercator cell (~1.8 km on the ground). 17 years are ~1.3 MB. Eleven classes (bare or burned added to the ten). Its own intent: [See how the land is used](../../intents/see-how-the-land-is-used.md).
- **4c, built** as a chip in Hidden neighbours: 12,700 km of line (by voltage class), 313 substations, 38 generating stations, ~100 KB. The SaskPower outage feed exists (`saskpower.com/api/sitecore/Content/GetOutageJsonFile`, by service region, planned and unplanned) but is undocumented and states no licence, so it is not a live stage.
- **4d, skipped.** GeoHub lists the Highway Traffic Volume Map only as a PDF; with no counts as data, a second drawing of the roads adds nothing.
- **4e and 4f, held back.** Buildings need the tiles decision and are mostly visual; nothing else built here needed tiles. 3D terrain is optional and unverified with deck.gl's layers on terrain.
- `public/data/` (committed) is ~8.2 MB with these, under 10 MB.
- The explainer film's wildfire scene now shows outlines; its storyboard needed no change (same names and selectors), but the film has not been re-rendered.

## Done when

- Wildfires shows true outlines for the years NBAC covers and circles otherwise, with the tooltip saying which.
- `rm -rf .cache/crops && npm run data crops` completes and the layer plays through its years.
- Every new source has its licence in the Data & sources view.
- `public/data/` stays under 10 MB without tiles.
