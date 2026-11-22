# Understand natural hazards

**Who:** buyers, farmers, insurers' customers and the curious who want to know what the land and sky have done to a place over time.

**The question:** How often has fire, smoke, wind, hail, drought or flood reached here, is it changing, and what is happening right now?

## What answers it

The Layer menu's **History on the timeline** group, scrubbed or played on the timeline:

- **🔥 Wildfires** (1959 → 2025, then Now): fires flare as they start and leave scars: the mapped burn outline from the National Burned Area Composite for burns of 200 ha or more (1972–2024), an area-true circle otherwise; at **Now**, satellite hotspots of the last 24 hours and estimated perimeters. **Replay the season** (top of the panel, once a season is in the daily record) plays one season's satellite hotspots from 1 April to 31 October in about 40 seconds: each day's flare, then cool to embers that stay, with the date, that day's count, the count so far and a bar a day filling in beside them.
- **🌫 Smoke & air** (2001 → 2023, then Now): smoke days per year at six air stations; at **Now**, the AQHI at each community and its forecast high.
- **Wind** and **Smoke forecast** chips (live, at the top of the Smoke & air and Wildfires panels): a weather model's wind for the current hour as drifting trails over the hotspots, and its forecast of wildfire smoke as a brown tint, every third hour for up to three days, with a scrubber that plays by itself.
- **🌪 Tornadoes** (1980 → today, monthly; gap 2010–2016) with tracks.
- **🧊 Hail** (2022 → today): Northern Hail Project storms and radar swaths. Its **Under the storm** chip lays each 2023–2024 swath's corridor over that year's crop inventory as the season plays: the hero counts the season's cropland under the swaths and its canola share, the panel lists the five swaths with the most cropland, and a swath's own panel says "it crossed ~X km² of cropland, Y % of it canola" with a bar of what grew there. Three big swaths (Smiley 2023, Webb 2023, Estevan 2024) also have **From space**: Sentinel-2's vegetation index before and after, a slider between them and a Change view. The biggest storms' dollars are on the timeline: IBC's insured damage (Moose Jaw 2016, Saskatoon 2017, the mid-June 2018 storm) and Municipal Hail's crop-hail claims (2023–2025 storm days).
- **🌾 Drought** (Nov 2002 → today, monthly): Canadian Drought Monitor D0–D4.
- **≋ River floods** (1912 → 2025, then Now): river peaks against normal; at **Now**, each gauge's latest flow against its normal peak. **Flood-prone land** is shaded in the 22 communities the Water Security Agency has mapped: the 1:500-year flood extent, with the floodway and flood fringe where drawn. Zoom past 12 in one of them (or Regina or Saskatoon) and buildings rise, the flood lies as water and the buildings it touches are tinted; the panel counts them per community and flies to each. The map's terrain button raises the valleys in those close-ups.
- Data-driven events: fires over 100,000 ha, F3+ or casualty tornadoes, high-water years, the smokiest and worst drought years.
- A **Right now** block at the top of those three panels (with weather alerts in effect, drawn dashed on the map) and a **Right now** group in the Town Report: the nearest gauge, hotspots within 50 km, the AQHI and alerts covering the place, each with its age. Under it, **Outlooks**: the AQHI forecast, MSC's thunderstorm outlook (May–October), today's CWFIS fire danger and tomorrow's wildfire-smoke forecast, each with when it was issued and what it is valid for.
- **Town Report** hazard rows and Finder criteria: Low wildfire exposure, Fewer smoke days, Fewer tornadoes, Less hail, Fewer drought months.

## How

Turn on a history layer and press play, or set a year; click an event for its panel. River floods, Wildfires and Smoke & air open at **Now**, the right end of their timeline.

## What it cannot tell you

- Only burns of 200 ha or more from 1972 to the composite's latest year have outlines, and those are simplified; every other fire is a circle of the right area, not its shape. The tooltip says which.
- Smoke days are **borrowed** from the nearest station within 150 km; NAPS has no Saskatchewan rows after 2023 yet.
- Tornado and hail counts depend on who (or what radar) was there; only three summers of hail swaths.
- Under the storm is **exposure, not damage**: the crops under a swath that season, not what the hail did to them. The corridor is the atlas's own, as wide as the swath at its widest all along its centre line, so it is an upper bound; the 2022 swaths have no width and no corridor. The dollar figures are one insurer's or one industry body's, each named and linked: Municipal Hail's claims leave out SCIC and the private hail insurers, IBC's often cover several provinces at once. From space is **vegetation change, not damage**: harvest, haying, ripening and growth change it too, which is why the land around the corridor is shown beside it.
- Drought is a consensus map on a 10 km grid; a town near an edge can read one step off.
- The history is a record, not a forecast, and none of it is an insurance rating. The **Outlooks** are published forecasts, shown with their issue and valid times and dropped once those pass; they never feed the Finder. Flood-prone land is the agency's modelled 1:500-year flood, not this year's risk, and most of the province has no published map: no shading does not mean no risk. A tinted building **touches** the mapped extent: that is not "will flood" (floors, basements and defences are not in the data), most buildings have no measured height (drawn one storey), and the footprints are machine-drawn.
- Live readings refresh about hourly and may be late or stop: each shows its age, greys after 3 hours and is not drawn after 24. A hotspot is heat seen from a satellite, not a confirmed fire. The AQHI is an index, not the smoke-day count, and is borrowed from the nearest community within 150 km. Live readings never feed the Finder.
- The season replay shows **hotspots, not fires and not a burned area**: flares and farm burning are in there, the count is of satellite detections, and the record is provisional and never joins the wildfire statistics. A day the hourly run missed is a grey gap, never a zero. Its dashed edges are the atlas's own estimate of where heat has been seen (a 2 km grid), not a mapped perimeter; the National Burned Area Composite's outlines, the official record, are drawn at the end only once it has published that year.
- Wind and Smoke forecast are **model forecasts, not readings**: each shows its model run and the hour it is for and is dropped when that has passed. The trails show the wind's direction and speed and count nothing; the smoke is fine particles from fires only, not the AQHI and not a smoke-day count.

## Check it

```js
// one line at a time: a panel fills a moment after it opens, and a tour replaces one still running
atlas.tour('hazards')    // the guided tour: rivers in 2011, tornadoes, hail, flood-prone land in Moose Jaw
atlas.tour('province')   // once hazards has finished: wildfires played from 1959, the north in 2015, drought in July 2021
document.querySelector('#tour-bar [data-t="exit"]')?.click()   // the tour must be over (or exited) before the next lines, or a later step replaces what they open
// live readings: load /?film&now (plain ?film skips them)
atlas.clearMap(); atlas.focus('rivers')   // lands on Now; flood-prone land shaded around mapped towns
document.querySelector('.bldg-list li[data-area="Prince Albert"]').click()   // once the panel shows; flies in: buildings, the water, 1,441 tinted
atlas.map.querySourceFeatures('bldg', { sourceLayer: 'buildings' }).length   // after the flight and tiles: > 0 past zoom 12; no .pmtiles request further out
atlas.openTown('regina')                   // Right now, then Outlooks
atlas.clearMap(); atlas.focus('hail'); atlas.setTime(2024.7)   // then the Under the storm chip:
document.querySelector('#panel [data-hx]').click()   // corridors in crop colours; hero ~43,720 km² of cropland under the 2024 swaths, 35% canola; top swath near Forget
document.querySelector('#panel [data-hx-i]').click()   // its panel: "it crossed ~6,170 km² of cropland, 39 % of it canola" and a bar of what grew there
atlas.clearMap(); atlas.focus('hail'); atlas.setTime(2022.7)   // the chip stays on and says the 2022 swaths have no width, so no corridor
atlas.setTime(2023.7)    // the 2023 season
[...document.querySelectorAll('#panel [data-hx-i]')].find((li) => li.textContent.includes('Smiley')).click()   // its panel: From space, Sentinel-2 before and after on the map, a slider and a Change chip
atlas.clearMap(); atlas.focus('smoke')    // then the Wind chip: trails drift; Smoke forecast: the scrubber plays
await atlas.replaySeason(2026)             // Wildfires: the season plays to Oct 31; the counter's total is the rows in history/fires/2026-04…10
atlas.leaveReplay()                        // once it has played (about 40 s): back to Wildfires' own timeline
```
