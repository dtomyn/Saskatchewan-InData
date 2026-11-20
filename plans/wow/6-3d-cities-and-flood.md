# 6. 3D cities with flood water

**Effort:** L. **Depends on:** the tiles decision in [`digital-twin/4-physical-systems.md`](../digital-twin/4-physical-systems.md) (4e buildings, 4f terrain, both held back there) and the flood-prone land (3d, built). **Status:** not started.

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
