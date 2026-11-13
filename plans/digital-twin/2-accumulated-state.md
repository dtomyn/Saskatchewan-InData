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

## To confirm before building

- A `data-history` branch (recommended) versus committing history to `main` or a second repository.
- Whether the workflow may hold `contents: write` at all; if not, the fallback is a manual weekly `npm run data history` committed by hand.
