# Towards a digital twin of Saskatchewan

Living Skies Atlas today is a **digital model**: its data arrives in batches through `npm run data` and shows the past up to each archive's last year. These five plans move it towards a twin, in the order to build them.

| Stage | Data flow | The atlas |
|---|---|---|
| Digital model | By hand or in batches | Today |
| Digital shadow | The real world updates the copy by itself | After plans 1 and 2 |
| Digital twin | Live, simulates what-ifs, and feeds decisions back | Plan 3 adds the what-ifs; see "What this will not become" |

## The plans, in build order

| # | Plan | What it adds | Effort | Needs |
|---|---|---|---|---|
| 1 | ✅ [A "now" on existing layers](1-live-now.md) | Hourly river, hotspot, air quality and weather alert readings, each with its age | M | — |
| 2 | ✅ [Accumulated state](2-accumulated-state.md) | A daily history of those readings, so the timeline reaches today | M | 1 |
| 3 | ✅ [Forecasts and what-ifs](3-forecasts-and-what-ifs.md) | Closure scenarios, climate projections, short-range outlooks | S to L by part | 1 for outlooks only |
| 4 | [Physical systems](4-physical-systems.md) | Fire perimeters, crops and land cover, the power grid, roads, buildings | M each, L for buildings | A decision on tiles for buildings |
| 5 | [Finer entities](5-finer-entities.md) | Every census subdivision and community, then city neighbourhoods | M to L by part | — |

Why this order: plan 1 reuses layers, panels and a timeline that already exist, so a live reading has somewhere to go. Plan 2 is small once plan 1 runs and is worth more the earlier it starts collecting. Plan 3's closure scenario (3a) needs nothing new and can be built at any time. Plans 4 and 5 are the largest and do not block the others.

Two parts stand alone and are cheap, if a quick win is wanted first: **3a** (what if this hospital closed: the data is already in `hospitals.json`) and **4a** (real fire perimeters).

## Rules every plan keeps

From `CLAUDE.md` and `MAP-ATLAS-BLUEPRINT.md` Part 2:

- All data comes through `npm run data` stages. The site stays static: no backend.
- Open data only, with its licence in the Data & sources view.
- Say when a value is inferred, borrowed, provisional or stale. A projection or scenario never looks like a record.
- Anything from outside the code goes through `esc()` / `safeUrl()`.
- The map starts empty. Live readings appear only once a layer is on.
- Live and scenario values never change the Town Finder's ranking.
- When a behaviour the blueprint describes changes, update the blueprint, the README and the intents with it; when a filmed feature changes, update the storyboard and re-render.

## Conventions

As in `ROADMAP.md`: *(verify)* marks a source not yet confirmed open and fetchable from a script; effort is S, M or L. Feeds marked "Works" were checked on 2026-11-13. Each plan ends with "Done when" checks and, where a choice is the owner's, "To confirm before building".

## What this will not become

A full twin closes the loop: the copy drives decisions in the real system, usually for an operator who controls it. A province has no single operator, and this atlas is for people choosing and understanding places. The realistic end state is a digital shadow with honest scenarios. It will not predict crime, model individual people, or estimate anything that a named public source has not published.
