# Understand natural hazards

**Who:** buyers, farmers, insurers' customers and the curious who want to know what the land and sky have done to a place over time.

**The question:** How often has fire, smoke, wind, hail, drought or flood reached here, and is it changing?

## What answers it

The Layer menu's **History on the timeline** group, scrubbed or played on the timeline:

- **🔥 Wildfires** (1959 → 2025): fires flare as they start and leave area-true scar circles.
- **🌫 Smoke & air** (2001 → 2023): smoke days per year at six air stations.
- **🌪 Tornadoes** (1980 → today, monthly; gap 2010–2016) with tracks.
- **🧊 Hail** (2022 → today): Northern Hail Project storms and radar swaths.
- **🌾 Drought** (Nov 2002 → today, monthly): Canadian Drought Monitor D0–D4.
- **≋ River floods** (1912 → 2025): river levels against normal.
- Data-driven events: fires over 100,000 ha, F3+ or casualty tornadoes, high-water years, the smokiest and worst drought years.
- **Town Report** hazard rows and Finder criteria: Low wildfire exposure, Fewer smoke days, Fewer tornadoes, Less hail, Fewer drought months.

## How

Turn on a history layer and press play, or set a year; click an event for its panel.

## What it cannot tell you

- Fire scars are circles of the right area, not perimeters.
- Smoke days are **borrowed** from the nearest station within 150 km; NAPS has no Saskatchewan rows after 2023 yet.
- Tornado and hail counts depend on who (or what radar) was there; only three summers of hail swaths.
- Drought is a consensus map on a 10 km grid; a town near an edge can read one step off.
- None of it is a forecast or an insurance rating.

## Check it

```js
atlas.clearMap(); atlas.focus('fires'); atlas.setTime(2015.6)
atlas.clearMap(); atlas.focus('drought'); atlas.setTime(2021.6)
```
