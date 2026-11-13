# 3. Forecasts and what-ifs

**Effort:** S for closures, M for climate projections, S for outlooks, L for floods. **Depends on:** plan 1 for the outlooks; closures and projections stand alone.

## Goal

The atlas shows what was and (after plan 1) what is. Add what is expected and what would happen if. Every one of these is model output, so each must look different from a record: hatched or dashed, a "projection, not a record" badge, and a range instead of a single number (blueprint principle 4). None is ever invented in this repo (principle 1): the atlas shows published modelling or recomputes from its own routed drives.

Build in this order.

## 3a. What if this closed? (S)

The cheapest real what-if, and the data is already there: `hospitals.json` keeps each town's **two** nearest hospitals by road, with minutes, kilometres and the route.

1. Hospital access panel: clicking a hospital offers "What if this closed?".
2. Every town whose nearest hospital is that one switches to its second: the map redraws the routes, and the panel lists the towns affected with the added minutes, worst first.
3. A "scenario" banner stays on the map and panel until cleared. The Town Report and Finder keep the real values.
4. Then widen it:
   - Raise `keep` in `driveTimes` from 2 to 3 so two closures can be combined.
   - Apply the same pattern to high schools (`schools`), courts and police (`justice`) and clinics (`doctors`), wherever the stage already routes to more than one target.

State in the lede that it is a scenario the visitor chose, not a plan anyone has announced. Only drive time changes: it says nothing about capacity or wait times.

## 3b. Climate projections (M)

Extend the Temperature and Climate normals story forward.

- Source: ClimateData.ca's per-location API (`data.climatedata.ca/generate-charts/{lat}/{lon}/{variable}`). Checked 2026-11-13: it answers JSON with 30-year observations and scenario medians. *(verify)* the CMIP6 (SSP) dataset parameter, the percentile ranges and the licence.
- Alternative: ECCC's `geomet-climate` WMS serves CanDCS-U6 downscaled indices (layers seen); gridded, so heavier to read.
- New stage `projections`: one request per place and variable, cached in `.cache/projections/`, writing `projections.json`. Variables: mean temperature, hottest day, days above 30 °C, frost-free days, precipitation. Two scenarios (a low and a high), three 30-year windows to 2100, each with median and 10th–90th percentile.
- App: the climate layer's timeline runs past today to 2100, hatched. The panel chart draws the range as a band. The Town Report gains one row: "By the 2050s: +x to +y °C".
- No Finder criterion: a projection should not rank towns.

## 3c. Short-range outlooks (S each, after plan 1)

Small additions to the "Right now" blocks, each a published forecast:

| Outlook | Source | Status |
|---|---|---|
| Air quality tomorrow | `aqhi-forecasts-realtime` | Works (already fetched in plan 1) |
| Thunderstorms | `api.weather.gc.ca/collections/thunderstorm_outlook` | Collection listed; coverage of Saskatchewan *(verify)* |
| Fire danger | CWFIS `public:fdr_current_shp` | Layer listed *(verify content)* |
| Wildfire smoke | ECCC FireWork | *(verify)*, as in plan 1 |
| Drought next month | AAFC Canadian Drought Outlook | *(verify a service exists beside the monitor's)* |
| River flows | Water Security Agency forecasts and advisories | *(verify)*: likely web pages and PDFs only |

Show the issue time and the valid time of every forecast, and drop it once the valid time has passed.

## 3d. Floods (L, last)

Turning a gauge level into a flooded area needs a fine elevation model and hydraulic modelling. Doing that here would be inventing values. Instead:

- Look for published flood mapping: NRCan's flood hazard and susceptibility products and the Water Security Agency's community flood maps *(verify open, licence, coverage)*.
- If open: a static "Flood-prone land" overlay under River floods, labelled with the return period it was modelled for.
- If not: record it under "Still open" in `ROADMAP.md` and stop.

## Docs and film

- `MAP-ATLAS-BLUEPRINT.md`: event panels and layer behaviour (the scenario banner), the projections stage.
- `README.md` caveats: a scenario is the visitor's own; a projection is a model range.
- Intents: "Reach help in an emergency" (closures), "Know the climate and the light" (projections), "Understand natural hazards" (its "none of it is a forecast" line changes).
- The film's hospital scene is unaffected unless it clicks a hospital: check `video/storyboard.py`.

## Done when

- Closing a hospital in the app changes the routes of exactly the towns that had it as nearest, and clearing the scenario restores them.
- The Finder ranking is identical with and without a scenario.
- Scrubbing the climate layer past today shows hatching, a badge and a band, never a single line.
- `rm -rf .cache/projections && npm run data projections` completes.
