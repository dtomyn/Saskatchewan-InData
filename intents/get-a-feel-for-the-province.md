# Get a feel for the province

**Who:** people who know almost nothing about Saskatchewan: thinking of visiting, and perhaps of moving here later.

**The question:** What is Saskatchewan actually like, what would I come for, and what should I know before I stayed?

## What answers it

- **☾ Light & dark**: June's daylight, the aurora bands, **Sky now** (night's edge and the aurora forecast) and the dark-sky preserves.
- **⛺ Camping & rec**: parks and campgrounds; **Weekend Reach** lights the campfires within a drive of a place.
- **What grows here** played over the farm belt, and **Treaties & reserves** for whose land it is.
- **3D cities**: Saskatoon and Regina's buildings past zoom 12, with the terrain button.
- **Town Report** and **Town Finder** (the New to Saskatchewan preset) for where a newcomer might live.
- The catch, each from its own layer: **Climate normals** (winter), **Wildfires** (Replay the season), **Tornadoes**, **River floods** (the flood extent in 3D), **Crime severity**, and Climate's **Climate twin** for the decades ahead.

The narrative film *Come for the sky* (`video/storyboard_sky.py`, `render.py --film sky`) walks this path as a week's visit.

## How

Start under the sky: Light & dark, then Camping & rec from a city you might fly into. Open a city's report, try Town Finder, then look at the hazard layers and the climate twin for the places you liked.

## What it cannot tell you

- What a place feels like: people, culture, food and events are not in open data.
- Hotspots are not confirmed fires; the aurora is a model's forecast, not a sighting; a climate twin is a model range matched on two numbers, not a forecast; a mapped flood extent says a building touches it, not that it will flood.
- Most of the province's land has no flood mapping, and crime is mapped by police service, not neighbourhood.

## Check it

```js
atlas.clearMap(); atlas.focus('light')   // then the Jun 21, Aurora and Sky now chips (Sky now needs ?film&now)
atlas.clearMap(); atlas.focus('camping') // then Weekend Reach: 4 h, Light the campfires
atlas.map.flyTo({ center: [-106.662, 52.124], zoom: 14.6, pitch: 64 })   // Saskatoon's buildings in 3D
await atlas.replaySeason()               // Wildfires' season replay from the daily record
```
