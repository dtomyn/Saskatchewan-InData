# Understand natural hazards

**Who:** buyers, farmers, insurers' customers and the curious who want to know what the land and sky have done to a place over time.

**The question:** How often has fire, smoke, wind, hail, drought or flood reached here, is it changing, and what is happening right now?

## What answers it

The Layer menu's **History on the timeline** group, scrubbed or played on the timeline:

- **🔥 Wildfires** (1959 → 2025, then Now): fires flare as they start and leave area-true scar circles; at **Now**, satellite hotspots of the last 24 hours and estimated perimeters.
- **🌫 Smoke & air** (2001 → 2023, then Now): smoke days per year at six air stations; at **Now**, the AQHI at each community and its forecast high.
- **🌪 Tornadoes** (1980 → today, monthly; gap 2010–2016) with tracks.
- **🧊 Hail** (2022 → today): Northern Hail Project storms and radar swaths.
- **🌾 Drought** (Nov 2002 → today, monthly): Canadian Drought Monitor D0–D4.
- **≋ River floods** (1912 → 2025, then Now): river peaks against normal; at **Now**, each gauge's latest flow against its normal peak. **Flood-prone land** is shaded in the 22 communities the Water Security Agency has mapped: the 1:500-year flood extent, with the floodway and flood fringe where drawn.
- Data-driven events: fires over 100,000 ha, F3+ or casualty tornadoes, high-water years, the smokiest and worst drought years.
- A **Right now** block at the top of those three panels (with weather alerts in effect, drawn dashed on the map) and a **Right now** group in the Town Report: the nearest gauge, hotspots within 50 km, the AQHI and alerts covering the place, each with its age. Under it, **Outlooks**: the AQHI forecast, MSC's thunderstorm outlook (May–October), today's CWFIS fire danger and tomorrow's wildfire-smoke forecast, each with when it was issued and what it is valid for.
- **Town Report** hazard rows and Finder criteria: Low wildfire exposure, Fewer smoke days, Fewer tornadoes, Less hail, Fewer drought months.

## How

Turn on a history layer and press play, or set a year; click an event for its panel. River floods, Wildfires and Smoke & air open at **Now**, the right end of their timeline.

## What it cannot tell you

- Fire scars are circles of the right area, not perimeters.
- Smoke days are **borrowed** from the nearest station within 150 km; NAPS has no Saskatchewan rows after 2023 yet.
- Tornado and hail counts depend on who (or what radar) was there; only three summers of hail swaths.
- Drought is a consensus map on a 10 km grid; a town near an edge can read one step off.
- The history is a record, not a forecast, and none of it is an insurance rating. The **Outlooks** are published forecasts, shown with their issue and valid times and dropped once those pass; they never feed the Finder. Flood-prone land is the agency's modelled 1:500-year flood, not this year's risk, and most of the province has no published map: no shading does not mean no risk.
- Live readings refresh about hourly and may be late or stop: each shows its age, greys after 3 hours and is not drawn after 24. A hotspot is heat seen from a satellite, not a confirmed fire. The AQHI is an index, not the smoke-day count, and is borrowed from the nearest community within 150 km. Live readings never feed the Finder.

## Check it

```js
atlas.clearMap(); atlas.focus('fires'); atlas.setTime(2015.6)
atlas.clearMap(); atlas.focus('drought'); atlas.setTime(2021.6)
// live readings: load /?film&now (plain ?film skips them)
atlas.clearMap(); atlas.focus('rivers')   // lands on Now; flood-prone land shaded around mapped towns
atlas.openTown('regina')                   // Right now, then Outlooks
```
