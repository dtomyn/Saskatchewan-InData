# See how the land is used

**Who:** someone buying farmland or an acreage, a newcomer curious about the prairie, a student, anyone who has driven past a yellow field in July and wondered.

**The question:** What grows around here, and how has it changed?

## What answers it

- **🌱 What grows here** (History on the timeline, 2009 → 2025): Agriculture and Agri-Food Canada's Annual Crop Inventory each year over the farm belt, in ~2 km squares that each show their most common class: cereals, canola, pulses, other crops and fallow, pasture and forage, grassland and shrub, forest, wetland, water, built-up, bare or burned. The panel charts the main classes' shares by year; events mark the year with the most canola and, when it stands out, the year fields were too wet to seed.
- **🚜 Crop yields** (History on the timeline, 1987 → 2025, then a forecast): **A century of harvest**. Each census division's reported yield of spring and durum wheat, canola, barley, oats, peas, lentils and flax rises as a column, tinted by the year against the division's own trend, and plays on the timeline; the crop chips switch crops. 2021's drought collapse is an event that points to the Drought layer; past 2025 AAFC's forecast for the next harvest stands as wire-framed columns between its 10th and 90th percentiles. The panel charts the middle division with the forecast band, Saskatchewan's own yield since 1908 (the Dirty Thirties' 1937 at the bottom) and the 20 crop districts of 1976–2016, each its own series.
- **Town Report** The land around it: the share of the land within 25 km that was cropped in the latest inventory and the first, its three biggest classes and a bar of all of them. The harvest around it: the census division's latest yield and ten-year average for the main crops, and AAFC's forecast range, badged as a model.
- **🔥 Wildfires** outlines show where the boreal north has burned; **🌾 Drought** shows the dry years the crops grew through.

## How

Turn on What grows here and play the timeline, or set a year; hover a square for its class. Open a Town Report and scroll to The land around it. Turn on Crop yields, pick a crop and play from 1987; click a column for its division's every year and forecast.

## What it cannot tell you

- Each ~2 km square is only its **most common class**: small fields, sloughs, shelterbelts and farmyards vanish.
- It is a satellite classification, right for about nine fields in ten; a square can flip class from one year to the next without anything changing on the ground.
- It covers the farm belt only (to about 55–56° N), and cloud leaves gaps. Nothing here says who owns or farms the land or what it is worth.
- Crop yields are for a whole census division, not one farm or a town's own fields, and a division that grows little of a crop often publishes none (missing, never zero). Before 2017 the division figures are AAFC's compilation; Statistics Canada then published crop districts, charted separately. The forecast is a model's range, not a harvest.

## Check it

```js
atlas.clearMap(); atlas.focus('crops'); atlas.setTime(2023.5)
atlas.setTime(2010.5)   // fields too wet to seed
atlas.openTown('weyburn')   // The land around it, and The harvest around it
atlas.clearMap(); atlas.focus('yields'); atlas.setTime(2021.5)   // the drought harvest
atlas.setTime(2026.5)   // AAFC's forecast range, hatched
```
