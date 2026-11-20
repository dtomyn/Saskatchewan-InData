# Six things worth showing someone

The atlas answers careful questions well. These six plans add moments that make a visitor stop and look, each grown from something the atlas already has, and each still a static site on GitHub Pages.

| # | Plan | What a visitor sees | Effort | Needs |
|---|---|---|---|---|
| 1 | ✅ [Live aurora and the night line](1-live-aurora.md) | Tonight's auroral oval over the north, and the edge of night crossing the province | S | — |
| 2 | ✅ [Wind and smoke in motion](2-wind-and-smoke.md) | Particles streaming with the wind; the smoke forecast drifting over 72 hours | M | A particle layer |
| 3 | ✅ [Replay a fire season](3-fire-season-replay.md) | A season's hotspots igniting day by day, burn outlines filling in behind | S–M | The daily record |
| 4 | ✅ [Guided fly-throughs](4-guided-tours.md) | "Take the tour": the camera flies, layers switch, captions explain | M | — |
| 5 | [A town's future climate twin](5-climate-twin.md) | An arc from a town to the place whose climate today is the town's in 2060 | M | — |
| 6 | [3D cities with flood water](6-3d-cities-and-flood.md) | Regina and Saskatoon as buildings on terrain, the 1-in-500-year flood against them | L | A decision on tiles |

Why this order: plan 1 is the smallest and rides on the hourly run that already exists. Plans 3 and 4 need no new source. Plan 2 is the biggest spectacle but needs a new kind of layer. Plan 6 is the largest and waits on the tiles decision in [`digital-twin/4-physical-systems.md`](../digital-twin/4-physical-systems.md).

## What "deployable to GitHub Pages" rules out

- No server: nothing computes on request. A live value is a small file the hourly `live.yml` run writes, then the browser reads it.
- No file over 100 MB and a site under 1 GB (Pages' limits). Big data goes into range-read files (PMTiles), cut to what is shown.
- The schedule can run late, and GitHub turns it off after 60 days without activity. Every live value shows its age and stops being drawn when old.

## Rules every plan keeps

The same as [`digital-twin/README.md`](../digital-twin/README.md): data arrives through `npm run data` stages; open data with its licence in Data & sources; say when a value is computed, inferred, modelled or stale; outside text goes through `esc()` / `safeUrl()`; the map starts empty; live, modelled and scenario values never change the Town Finder; docs, intents and the film move with the behaviour.

One more for this set: **a spectacle still has to be true.** Motion and glow are drawn from published values only. Where an effect is decoration (a particle's trail, a camera move), it must not suggest a measurement that is not there.

## Conventions

As in `ROADMAP.md`: *(verify)* marks a source not yet confirmed open and fetchable from a script; effort is S, M or L. Each plan ends with "Done when" checks and, where a choice is the owner's, "To confirm before building".
