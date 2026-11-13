# See how the land is used

**Who:** someone buying farmland or an acreage, a newcomer curious about the prairie, a student, anyone who has driven past a yellow field in July and wondered.

**The question:** What grows around here, and how has it changed?

## What answers it

- **🌱 What grows here** (History on the timeline, 2009 → 2025): Agriculture and Agri-Food Canada's Annual Crop Inventory each year over the farm belt, in ~2 km squares that each show their most common class: cereals, canola, pulses, other crops and fallow, pasture and forage, grassland and shrub, forest, wetland, water, built-up, bare or burned. The panel charts the main classes' shares by year; events mark the year with the most canola and, when it stands out, the year fields were too wet to seed.
- **Town Report** The land around it: the share of the land within 25 km that was cropped in the latest inventory and the first, its three biggest classes and a bar of all of them.
- **🔥 Wildfires** outlines show where the boreal north has burned; **🌾 Drought** shows the dry years the crops grew through.

## How

Turn on What grows here and play the timeline, or set a year; hover a square for its class. Open a Town Report and scroll to The land around it.

## What it cannot tell you

- Each ~2 km square is only its **most common class**: small fields, sloughs, shelterbelts and farmyards vanish.
- It is a satellite classification, right for about nine fields in ten; a square can flip class from one year to the next without anything changing on the ground.
- It covers the farm belt only (to about 55–56° N), and cloud leaves gaps. Nothing here says who owns or farms the land, what it yielded or what it is worth.

## Check it

```js
atlas.clearMap(); atlas.focus('crops'); atlas.setTime(2023.5)
atlas.setTime(2010.5)   // fields too wet to seed
atlas.openTown('weyburn')   // The land around it
```
