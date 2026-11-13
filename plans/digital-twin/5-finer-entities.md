# 5. Finer entities: the whole province, not 62 places

**Effort:** M for the census map, L for reports on every community, L for city neighbourhoods. **Depends on:** nothing, but it touches most stages, so do it last.

## Goal

The Town Report, the Finder and most per-place numbers cover the 62 places typed in `scripts/places.mjs`. A twin of Saskatchewan should cover all of it: every census subdivision (cities, towns, villages, rural municipalities, reserves; several hundred, to be counted by the stage), and inside the big cities, neighbourhoods.

## Why it is the last step

- More than a dozen stages read `municipalities.json`, and `metrics.ts`, `panels.ts` and the Finder assume its 62 keys.
- Drive times are the hard limit. Stages route through the public OSRM demo server, which is rate-limited: 62 places are polite, several hundred are not.
- Small places bring suppressed and rounded census values, so the honesty rules get more work, not less.

So build it in three steps, each useful alone.

## 5a. Census layers for every subdivision (M)

The census helpers already work for any CSD (`censusCSDs`, `censusProfile`); only the 62 are kept.

1. New stage `subdivisions`: Statistics Canada's 2021 cartographic boundary file for Saskatchewan's CSDs, read with the shapefile parser already written for the `radon` stage, simplified with `polys()`, written as `subdivisions.json` (id, name, type, centre, outline).
2. `housing`, `jobs` and `community` also write a compact table for all CSDs (`<name>-csd` keys alongside the 62).
3. Each of those layers gains a province-wide tint by subdivision under its existing town marks: median home value, median income, immigrant share and so on.
4. Clicking a subdivision that is not one of the 62 opens a short census-only report.

Rules:

- A share on a rounded 0 shows "—" (`pctText`). Suppressed values are skipped, never shown as zero.
- Reserves are their own subdivisions and some were not fully counted in 2021: label those "not enumerated", and keep the Treaties & reserves layer's wording.
- A rural municipality surrounds its towns and excludes them: say so in the tooltip.

## 5b. A report for every community (L)

Two tiers of place:

| Tier | Places | Gets |
|---|---|---|
| 1 | The 62 in `scripts/places.mjs` | Everything, as today |
| 2 | Every other town, village and northern community | Census values, counts of what is mapped in town, hazards by location, and the nearest hospital, school and police by road |

Steps:

1. `places` stage writes both tiers to `municipalities.json` with a `tier` field; existing stages keep reading tier 1 unless changed.
2. Move stages to tier 2 in order of cost:
   - Location only (cheap): `fires`, `tornadoes`, `hail`, `drought`, `smoke`, `radon`, `light`, `internet`.
   - Overpass by town limits (moderate; batch the queries): `needs`, `doctors`, `schools`, `childcare`.
   - Routed (expensive): `hospitals`, `justice`, `schools`, `camping`, `transit`, `commute`.
3. Routing for tier 2 needs its own OSRM: run `osrm-backend` on the Geofabrik Saskatchewan extract, locally in Docker or as a workflow step, and point the `OSRM` constant at it by an environment variable. The public server stays the default for tier 1 so `npm run data` still works with nothing installed. *(verify)* build time and memory for the extract.
4. `commute.json` is a 62 × 62 matrix. Do not square it for every community: for tier 2 keep each place's drives to the 62 only.
5. `metrics.ts`: `townMetrics` takes any place; criteria a tier-2 place lacks are skipped, never penalized (principle 4). The Finder gains a "Include small communities" switch, off by default.
6. Performance: check `loadAll()` size and the Finder's ranking time with several hundred places; move per-place tables to arrays keyed by index if the JSON grows past a few MB.

Inferred values multiply here (borrowed stations, rural RCMP detachments standing in for a village, a hospital counted as a clinic). Each keeps its label.

## 5c. Inside the cities (L)

Regina and Saskatoon are each one dot with one crime rate and one home value.

- Census by dissemination area or census tract from the same SDMX API *(verify the geography levels it serves)*.
- Neighbourhood boundaries and police-reported crime by neighbourhood from the two cities' open data portals *(verify both exist, their licences, and that categories can be compared)*.
- Radon already works by FSA inside cities, and transit by route: the pattern exists.
- A city report then opens with a neighbourhood map. Neighbourhood crime counts are not the Crime Severity Index: never put them on the same scale as the province-wide layer.

## Docs and film

- `MAP-ATLAS-BLUEPRINT.md` Part 1.2 (places), 1.5 (report and Finder), Part 6 (the optional local OSRM).
- `README.md`, `CLAUDE.md` (stage order, the tier rule, new data notes).
- Intents: "Choose where to live" and "Size up one town" change most.
- The film's Finder and report scenes count "62 places" in narration: every such number is counted from the data (principle 6), so re-render.

## Done when

- 5a: a visitor can click any part of the province and get at least census values, with every suppressed value shown as "—".
- 5b: a tier-2 village opens a report with no row silently missing: each absent value says why.
- `npm run data` with no local OSRM still completes for tier 1.
- The Finder's default ranking of the 62 is unchanged.

## To confirm before building

- Whether the pipeline may depend on Docker for tier-2 routing (recommended, optional) or must stay Node-only (then tier 2 gets straight-line nearest, labelled as such).
