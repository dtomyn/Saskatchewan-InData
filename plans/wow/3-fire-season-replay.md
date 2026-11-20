# 3. Replay a fire season

**Effort:** S–M. **Depends on:** the daily record (digital-twin plan 2) and the burn outlines (4a), both built. **Status:** not started.

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

## To confirm before building

- Whether the replay belongs in the explainer film (it would need a fixed season, so the film stays repeatable).
