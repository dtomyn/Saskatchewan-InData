# 5. A town's future climate twin

**Effort:** M. **Depends on:** climate projections (digital-twin plan 3b) and Climate normals, both built. **Status:** not started.

## Goal

A range of degrees on a chart is hard to feel. Say it with a place instead: "By the 2060s, Prince Albert's climate is projected to be like Swift Current's today", and draw the arc on the map.

## What a visitor sees

- On the Climate layer, a **Climate twin** chip. Click a town: an arc lifts from it and lands on its twin, both labelled, with the period and scenario.
- A slider for the period (2021–2050, 2041–2070, 2071–2100) and the scenario chips the projections already have. Moving it sends the arc's far end sliding south.
- Show-all mode: every town's arc at once, a fan of lines pointing the same way.
- In the Town Report, one row: "Climate twin, 2041–2070: like *X* today (range: *Y* to *Z*)".

## Sources

None new for matches inside the province: `projections.json` (CanDCS-U6 30-year means per place: 10th, 50th and 90th percentiles) and `normals.json` (1991–2020 station normals).

The limit that decides the design: **the south has no twin inside Saskatchewan.** Estevan in 2060 is warmer than anywhere in the province today. Two ways to handle it:

- (a) say "warmer than anywhere in Saskatchewan today" and draw no arc (no new data);
- (b) add reference points south of the border from an open normals set, e.g. NOAA's 1991–2020 U.S. Climate Normals for a few dozen Great Plains stations *(verify: format, and that their variables line up with ECCC's)*.

Build (a) first; (b) is what makes the southern towns interesting.

## Method

1. Compare like with like: the projection is a change against the model's own baseline, so add each place's projected **change** (future minus the model's 1991–2020) to its **observed** normals, then look for the place whose observed normals are nearest.
2. Distance over the variables the projections carry (annual mean temperature and total precipitation today; summer and winter means if they are added), each scaled by its spread across the province's places.
3. The twin for the median, plus the twins for the 10th and 90th percentiles as the range. If the nearest match is farther than a threshold, there is no twin: say so.
4. Computed in a stage (`twins`, reading `projections.json` and `normals.json`) so the app only draws it. Never in the Finder.

## Honest labelling

- A twin is a **model range matched on two or three numbers**, not a forecast of what a town will be like: soils, daylight, water and people do not move. Badge it as a projection (hatched, like the timeline past the record).
- Always show the range (the 10th and 90th percentile twins), never the median alone.
- Many places borrow a climate station; a twin built on a borrowed station says so on both ends.
- "No twin in Saskatchewan" is a finding, not a gap: show it plainly.

## Done when

- `npm run data twins` writes `twins.json` for the 62 places, three periods and each scenario.
- A town's twin for the median lies between its 10th and 90th percentile twins in temperature.
- `atlas.focus('climate')`, the chip, then a click on Prince Albert draws one arc and names the twin, the period and the scenario; the Town Report row agrees.
- A southern town reads "warmer than anywhere in Saskatchewan today" under option (a).

## To confirm before building

- Option (a) only, or (b) with reference points outside the province.
- Which variables define "like": annual means only (what is built), or seasonal ones added to the projections stage first (a better match, more downloads).
