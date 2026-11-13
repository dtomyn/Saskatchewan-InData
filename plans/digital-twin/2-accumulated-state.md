# 2. Accumulated state: keep what "now" was

**Effort:** M. **Depends on:** plan 1. **Unlocks:** a timeline with no gap between the archives and today.

## Goal

Plan 1 overwrites each live file every hour. Keep a compact daily record of them, so the timeline runs from the archive's last year up to today, and point-in-time layers (drinking water advisories, weather alerts) gain a history they have never had.

## Where the history lives

A separate `data-history` branch, appended to by the scheduled workflow. `main` stays clean, its ruleset is untouched (it covers the default branch only), and the history survives a bad deploy.

- A new `archive` job in `live.yml` is the only one with `contents: write`. Like the deploy job, it runs no repository code: it takes the live files as an artifact from the build job, appends them, commits and pushes to `data-history`.
- The build job checks out `data-history` (read only) into `public/data/history/` before `npm run build`, so the site ships it.

## Format

One file per feed per month, daily roll-ups rather than every reading:

| File | Row |
|---|---|
| `history/rivers/2026-11.json` | per station, per day: `[day, min, max, mean discharge, flag]` |
| `history/fires/2026-11.json` | per day: hotspots `[lon, lat, frp]`, de-duplicated by the feed's id |
| `history/air/2026-11.json` | per community, per day: `[day, max AQHI, hours reported]` |
| `history/alerts/2026-11.json` | one row per alert: code, start, end, places covered |
| `history/water/2026-11.json` | one row per advisory: opened, closed, where, kind |

Each file records `source`, the first and last run that fed it, and how many hourly runs each day is built from. A day with few runs is flagged, not hidden.

A roll-up step (`scripts/history.mjs`, run by `npm run data history`) reads the month file, merges today's live file into it and writes it back. It must be safe to run twice on the same hour.

## Backfill

So the record does not start on the day this ships:

- Rivers: `hydrometric-realtime` keeps a recent window *(verify how long)*; `hydrometric-daily-mean` holds the official daily record, which lags by a year or more.
- Fires: CWFIS `public:hotspots` with a date filter for the current season *(verify how far back it goes)*.
- Air: `aqhi-observations-realtime` retention *(verify)*.
- Water and alerts: none; they start when the archive starts. Say so in the panel.

## App

1. `src/data.ts`: `loadHistory(feed, month)`, fetched only when the timeline enters the recent span. `loadAll()` must not grow.
2. Each layer with a history draws the recent span from it, replacing plan 1's hatching.
3. The recent span looks different from the record: dashed sparkline and a "provisional" badge (blueprint principle 4).
4. Drinking water gains a short timeline (advisories opening and closing). Once a year of history exists, a Finder criterion "Fewer advisory days" becomes possible at weight 0.
5. Data & sources view: each history shows its first day, last day and count of gaps.

## Rules

- **Never splice.** A provisional series is not joined to the official one (the crime layer's rule). When HYDAT, the NFDB or NAPS publishes a year, the layer shows the official year and drops the provisional one from view. The files stay.
- Hotspot counts are not fire counts and never feed the wildfire statistics.
- A missed run is a gap, not a zero.
- Keep history files small: a month of rivers should stay under about 300 KB. Measure before choosing the fields.
- Retention: keep everything. Revisit if the branch passes 200 MB.

## Docs

`MAP-ATLAS-BLUEPRINT.md` (pipeline, deployment), `README.md` (refreshing the data, caveats), `CLAUDE.md` (the history branch and the no-splice rule), intent "Check where the data comes from".

## Done when

- Two scheduled runs an hour apart leave one day row per station, not two.
- Deleting a day's runs shows a gap on the timeline.
- Scrubbing rivers from the last HYDAT year to Now shows no hatched span.
- `main` has no commits from the workflow.

## Built

Built with the recommended choices: a `data-history` branch, and an `archive` job in `live.yml` that holds `contents: write` (and runs no repository code). What the feeds keep, checked 2026-11-13: real-time gauges about 30 days (from 2026-10-14), AQHI observations about 3 days, weather alerts only what is current; CWFIS `public:hotspots` keeps every season (WFS 2.0, `srsName=CRS:84`, paged). `hydrometric-daily-mean` (official) runs to 2026-04-30 for Saskatchewan; it is not used, so provisional and official days are never mixed. Differences from the plan:

- Rivers and AQHI days are recomputed whole from each feed's own window every run (yesterday and today; `history-backfill` reaches back once), not appended from the live files, so a missed run is filled as long as the feed still holds it. The gauge feed is paged one day at a time: deep offsets stall.
- Hotspots are de-duplicated by position and minute: the feed's ids are not stable. A hotspot month in a big season is large (July 2026: 1.2 MB); it is fetched only when the timeline enters 2026 on Wildfires.
- The build job checks out `data-history` read-only and fails if the branch exists but cannot be read, so the record is never restarted by accident; the archive is additive (nothing is deleted).
- AQHI days draw on the map only, never on the smoke-day sparkline (an index is never charted with a count).
- Drinking water stays a static layer; its panel shows the record as a bar per day (advisories listed), with gaps dashed. The Finder criterion waits for a year of history.
- The plan's check "Scrubbing rivers from the last HYDAT year to Now shows no hatched span" cannot hold yet: HYDAT's annual peaks end in 2025 and the gauge feed reaches back only to 2026-10-14, so January to mid-October 2026 stays hatched ("no record yet") until next year. The record fills it forward from here.

## To confirm before building

- A `data-history` branch (recommended) versus committing history to `main` or a second repository.
- Whether the workflow may hold `contents: write` at all; if not, the fallback is a manual weekly `npm run data history` committed by hand.
