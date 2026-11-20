# 3. Replay a fire season

**Effort:** S–M. **Depends on:** the daily record (digital-twin plan 2) and the burn outlines (4a), both built. **Status:** built (`AtlasLayer.replay` in `src/layer-kit.ts`, the replay in `src/fires.ts`, `fireSeason` in `src/history.ts`, the timeline in `src/main.ts`).

## Goal

Let a visitor press one button on Wildfires and watch a whole season: hotspots igniting day by day across the north, the estimated perimeters growing, and a running count beside them. The data is already collected; today it can only be scrubbed by hand on the timeline's recent span.

## What a visitor sees

- A **Replay the season** button in the Wildfires panel, with a year picker once more than one season is on record.
- The map pulls back to the forest. The timeline runs from 1 April to 31 October in about 40 seconds. Each day's hotspots flare bright, then cool to embers that stay; estimated perimeters spread behind them.
- A counter in the panel: the date, hotspots seen that day, hotspots so far, and a small bar chart of hotspots per day filling in under it.
- At the end, the season's NBAC burn outlines fade in when that year's composite has been published, with the hectares it reports.

## Sources

None new. `history/` on the `data-history` branch holds hotspots by day (the backfill reaches the whole current season through CWFIS's `public:hotspots`), and `fires.json` holds the outlines.

To check first: how many seasons the record holds today, and the size of a full season's month files (2025's hotspots may run to tens of thousands of points; the replay should load them through `ensureFeed` as the recent span already does).

## App

1. `src/fires.ts`: a replay mode on the layer's recent span. It sets the timeline's range to the season, a speed in days per second, and plays; the existing `firesHistory` view supplies each day.
2. Drawing: today's hotspots large and bright, earlier ones decaying over ~5 days to a small dim ember (one `ScatterplotLayer` with a per-point age attribute, so the season is uploaded once and only a uniform changes per frame).
3. The counter and the per-day bars in the panel, updated from `panel.update`.
4. `atlas.replaySeason(year)` on the `?film` handle, so the film and the intent check can drive it.

## Honest labelling

- Hotspots are heat seen from a satellite, not confirmed fires: flares and farm burning are in there. The counter says "hotspots", never "fires", and never a burned area.
- A day the hourly run missed is a gap in the bar chart, never a zero.
- The record is provisional and never joins the wildfire statistics (never splice). The NBAC outlines at the end are the official record and are labelled as that.
- Perimeters are estimates from hotspots, drawn dashed.

## Done when

- The button plays the current season end to end without a stall, and pausing leaves the map and counter on the same day.
- The counter's season total equals the number of rows in that season's history files.
- A missing day shows as a gap; a season with no record yet does not offer a button.
- The intent "Understand natural hazards" has a `?film` check for it.

## As built

- The record held one season when this was built: 2026, 72,971 hotspots in seven month files (about 1.9 MB, the largest 1.2 MB), all 214 days covered by the backfill. They load when the button is pressed, apart from the recent span's `ensureFeed`, so a season can still be replayed after the archive publishes its year.
- The daily record keeps hotspots only, not CWFIS's estimated perimeters, so the dashed edges are the atlas's own estimate: hotspots on a grid of about 2 km, each cell remembering when it first lit, an edge drawn around patches of six cells or more. The panel and Data & sources say so.
- Drawing is two layers over the same points (embers and flares), each a `DataFilterExtension` range, so the season is uploaded once and only the range changes per frame; the flare fades with `filterSoftRange` over five days.
- A season still running is replayed to its last day on record. The NBAC ending has not been seen with real data yet: the composite reaches 2024 and the record starts in 2026.
- The replay is not in the explainer film (it would need a fixed season, so the film stays repeatable); `atlas.replaySeason(year)` is there for when it is.
